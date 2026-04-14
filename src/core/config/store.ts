// src/core/config/store.ts
// SQLite-backed storage for routing snapshots, per-chat feature overrides,
// pending Pubky writes, and the periodic pin state. Flow/session state stays
// in memory.
//
// Schema (managed via migrations):
// chat_feature_overrides(chat_id, feature_id PK, enabled, data, updated_at)
// snapshots_by_config(config_hash TEXT PK, snapshot_json, built_at)
// pending_writes(id TEXT PK, ..., on_approval, on_rejection)
// periodic_pin_state(chat_id TEXT PK, pinned_message_id, last_fired_slot, updated_at)
//
// NOTE: Historical tables dropped by migrations: `snapshots` (2), `chat_configs`
// (8), `service_bundles` (9) — services now execute from source paths directly
// instead of pre-bundled content-addressed blobs. Migration 10 drops the
// `integrity_hash` column from `snapshots_by_config` (it was never actually
// validated anywhere).

import { DB } from "sqlite";
import { runMigrations } from "@core/config/migrations.ts";
import type { RoutingSnapshot } from "@schema/routing.ts";

let db: DB | null = null;

export interface SnapshotRecord {
	config_hash: string;
	snapshot_json: string;
	built_at: number;
}

// ---------------------------------------------------------------------------
// Initialization & helpers
// ---------------------------------------------------------------------------
export function initDb(path = Deno.env.get("LOCAL_DB_URL") || "./bot.sqlite"): void {
	if (db) return;
	db = new DB(path);
	db.execute(`PRAGMA journal_mode = WAL;`);
	db.execute(`PRAGMA synchronous = NORMAL;`);
	runMigrations(db);
}

export function getDb(): DB {
	if (!db) throw new Error("Database not initialized");
	return db;
}

function ensureDb(): DB {
	if (!db) throw new Error("Database not initialized");
	return db;
}

// ---------------------------------------------------------------------------
// Known chats
// ---------------------------------------------------------------------------
// "Known" = has at least one row in chat_feature_overrides, meaning an admin
// has opened /config at least once in that chat. The scheduler uses this to
// decide which chats to walk when considering periodic broadcasts.

export function listKnownChatIds(): string[] {
	const database = ensureDb();
	const rows = database.query<[string]>(
		`SELECT DISTINCT chat_id FROM chat_feature_overrides`,
	);
	return rows.map((r) => r[0]);
}

/**
 * Mark a chat as "seen" by the bot so the scheduler's `listKnownChatIds()`
 * picks it up even if no admin has ever touched `/config` in it. Upserts a
 * sentinel row (`feature_id = "__seen__"`, `enabled = NULL`, `data = {}`).
 * `resolveChatConfig()` in merge.ts ignores feature ids that don't exist in
 * the operator config, so the sentinel has no other effect.
 *
 * Called from the router on every incoming message / command / callback.
 */
export function rememberChat(chatId: string): void {
	if (!chatId) return;
	const database = ensureDb();
	database.query(
		`INSERT INTO chat_feature_overrides (chat_id, feature_id, enabled, data, updated_at)
		 VALUES (?, '__seen__', NULL, '{}', ?)
		 ON CONFLICT(chat_id, feature_id) DO NOTHING`,
		[chatId, Date.now()],
	);
}

// ---------------------------------------------------------------------------
// Per-chat feature overrides
// ---------------------------------------------------------------------------
// Layered on top of config.yaml. `enabled = NULL` means "inherit the operator
// default for this chat type". `data` is a feature-specific JSON blob (e.g.
// selected calendar ids for meetups, override welcome text for new_member).

export interface ChatFeatureOverride {
	chat_id: string;
	feature_id: string;
	enabled: boolean | null;
	data: Record<string, unknown>;
	updated_at: number;
}

export function getChatFeatureOverrides(chatId: string): ChatFeatureOverride[] {
	const database = ensureDb();
	const rows = database.query<[string, string, number | null, string, number]>(
		`SELECT chat_id, feature_id, enabled, data, updated_at
		 FROM chat_feature_overrides WHERE chat_id = ?`,
		[chatId],
	);
	return rows.map(([cid, fid, en, dataJson, updated]) => ({
		chat_id: cid,
		feature_id: fid,
		enabled: en === null ? null : en === 1,
		data: parseJsonSafe(dataJson),
		updated_at: updated,
	}));
}

export function getChatFeatureOverride(
	chatId: string,
	featureId: string,
): ChatFeatureOverride | undefined {
	const database = ensureDb();
	const row = database
		.query<[string, string, number | null, string, number]>(
			`SELECT chat_id, feature_id, enabled, data, updated_at
			 FROM chat_feature_overrides WHERE chat_id = ? AND feature_id = ?`,
			[chatId, featureId],
		)
		.at(0);
	if (!row) return undefined;
	const [cid, fid, en, dataJson, updated] = row;
	return {
		chat_id: cid,
		feature_id: fid,
		enabled: en === null ? null : en === 1,
		data: parseJsonSafe(dataJson),
		updated_at: updated,
	};
}

export function setChatFeatureOverride(
	chatId: string,
	featureId: string,
	patch: { enabled?: boolean | null; data?: Record<string, unknown> },
): void {
	const database = ensureDb();
	const existing = getChatFeatureOverride(chatId, featureId);
	const mergedEnabled = patch.enabled === undefined ? (existing?.enabled ?? null) : patch.enabled;
	const mergedData = { ...(existing?.data ?? {}), ...(patch.data ?? {}) };
	const enabledInt = mergedEnabled === null ? null : mergedEnabled ? 1 : 0;
	database.query(
		`INSERT INTO chat_feature_overrides (chat_id, feature_id, enabled, data, updated_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(chat_id, feature_id) DO UPDATE SET
		   enabled = excluded.enabled,
		   data = excluded.data,
		   updated_at = excluded.updated_at`,
		[chatId, featureId, enabledInt, JSON.stringify(mergedData), Date.now()],
	);
}

export function clearChatFeatureOverride(chatId: string, featureId: string): void {
	const database = ensureDb();
	database.query(
		`DELETE FROM chat_feature_overrides WHERE chat_id = ? AND feature_id = ?`,
		[chatId, featureId],
	);
}

export function clearAllChatFeatureOverrides(chatId: string): void {
	const database = ensureDb();
	database.query(`DELETE FROM chat_feature_overrides WHERE chat_id = ?`, [chatId]);
}

function parseJsonSafe(s: string): Record<string, unknown> {
	try {
		const v = JSON.parse(s);
		return v && typeof v === "object" ? v as Record<string, unknown> : {};
	} catch {
		return {};
	}
}

// ---------------------------------------------------------------------------
// Snapshots keyed by config hash (primary reuse mechanism)
// ---------------------------------------------------------------------------
export function saveSnapshotByConfigHash(configHash: string, snapshot: RoutingSnapshot): void {
	const database = ensureDb();
	const json = JSON.stringify(snapshot);
	database.query(
		`INSERT INTO snapshots_by_config (config_hash, snapshot_json, built_at)
         VALUES (?, ?, ?)
         ON CONFLICT(config_hash) DO UPDATE SET
           snapshot_json=excluded.snapshot_json,
           built_at=excluded.built_at`,
		[configHash, json, snapshot.builtAt ?? Date.now()],
	);
}

export function loadSnapshotByConfigHash(configHash: string): SnapshotRecord | undefined {
	const database = ensureDb();
	const row = database
		.query<[string, string, number]>(
			`SELECT config_hash, snapshot_json, built_at
             FROM snapshots_by_config WHERE config_hash = ?`,
			[configHash],
		)
		.at(0);
	if (!row) return undefined;
	const [chash, json, builtAt] = row;
	return {
		config_hash: chash,
		snapshot_json: json,
		built_at: builtAt,
	};
}

export function deleteSnapshotByConfigHash(configHash: string): void {
	const database = ensureDb();
	database.query(`DELETE FROM snapshots_by_config WHERE config_hash = ?`, [configHash]);
}

/**
 * Clear all persisted snapshots. Called on process startup so that
 * code changes (--watch restart) or edits to config.yaml are always
 * picked up on the first request, without any manual intervention.
 */
export function clearAllSnapshots(): void {
	const database = ensureDb();
	database.query(`DELETE FROM snapshots_by_config`);
}

// ---------------------------------------------------------------------------
// Close
// ---------------------------------------------------------------------------
export function closeDb(): void {
	if (db) {
		db.close();
		db = null;
	}
}

// ---------------------------------------------------------------------------
// Periodic pin state (scheduler)
// ---------------------------------------------------------------------------
// Per-chat: which message was pinned by the last periodic broadcast (so the
// next fire can unpin it), and the time-slot we last fired in (so a restart
// within the same slot doesn't double-send).

export function getPeriodicPinnedMessage(chatId: string): number | null {
	const database = ensureDb();
	const row = database
		.query<[number | null]>(
			`SELECT pinned_message_id FROM periodic_pin_state WHERE chat_id = ?`,
			[chatId],
		)
		.at(0);
	if (!row) return null;
	return row[0] ?? null;
}

export function setPeriodicPinnedMessage(chatId: string, messageId: number | null): void {
	const database = ensureDb();
	database.query(
		`INSERT INTO periodic_pin_state (chat_id, pinned_message_id, updated_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(chat_id) DO UPDATE SET
		   pinned_message_id = excluded.pinned_message_id,
		   updated_at = excluded.updated_at`,
		[chatId, messageId, Date.now()],
	);
}

export function getPeriodicLastFired(chatId: string): string | null {
	const database = ensureDb();
	const row = database
		.query<[string | null]>(
			`SELECT last_fired_slot FROM periodic_pin_state WHERE chat_id = ?`,
			[chatId],
		)
		.at(0);
	if (!row) return null;
	return row[0] ?? null;
}

export function setPeriodicLastFired(chatId: string, slot: string): void {
	const database = ensureDb();
	database.query(
		`INSERT INTO periodic_pin_state (chat_id, last_fired_slot, updated_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(chat_id) DO UPDATE SET
		   last_fired_slot = excluded.last_fired_slot,
		   updated_at = excluded.updated_at`,
		[chatId, slot, Date.now()],
	);
}

// ---------------------------------------------------------------------------
// Hash utilities
// ---------------------------------------------------------------------------
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
	// TextEncoder output is backed by a plain ArrayBuffer (not SharedArrayBuffer),
	// so it can be fed directly to subtle.digest.
	const data = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
	const digest = await crypto.subtle.digest("SHA-256", data);
	const bytes = new Uint8Array(digest);
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
