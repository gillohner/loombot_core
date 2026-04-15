// src/core/config/migrations.ts
// Simple SQLite migration framework: tracks applied migrations in migrations table.
// Each migration has an id (monotonic increasing integer) and up() function.
import { DB } from "sqlite";
import { log } from "@core/util/logger.ts";

export interface Migration {
	id: number; // increasing integer
	name: string; // descriptive label
	up: (db: DB) => void | Promise<void>;
}

// Register migrations here in ascending id order. Idempotency: each migration should be safe to run once only.
// Baseline migration (id 1) ensures required tables exist (mirrors existing init schema) so we can evolve forward.
export const migrations: Migration[] = [
	{
		id: 1,
		name: "baseline_schema",
		up: (db: DB) => {
			// Historical note: this migration used to also create `chat_configs`
			// (dropped in migration 8), `snapshots` (dropped in migration 2), and
			// `service_bundles` (dropped in migration 9). Those are gone — new
			// installs go straight to the current schema via later migrations;
			// existing installs hit the drop migrations in sequence.
			//
			// The `integrity_hash` column is created here (as NOT NULL) for
			// backwards compatibility with existing installs; migration 10 makes
			// it optional on fresh installs via the DROP COLUMN path. Either way
			// the column is never read anymore.
			db.execute(`CREATE TABLE IF NOT EXISTS snapshots_by_config (
            config_hash TEXT PRIMARY KEY,
            snapshot_json TEXT NOT NULL,
            built_at INTEGER NOT NULL,
            integrity_hash TEXT NOT NULL DEFAULT ''
        );`);
		},
	},
	{
		id: 2,
		name: "drop_chat_snapshots_table",
		up: (db: DB) => {
			// If table exists, drop it. Safe because we are deprecating per-chat snapshots.
			try {
				db.execute(`DROP TABLE IF EXISTS snapshots;`);
			} catch (_err) {
				// ignore
			}
		},
	},
	{
		id: 3,
		name: "add_pending_writes_table",
		up: (db: DB) => {
			db.execute(`CREATE TABLE IF NOT EXISTS pending_writes (
				id TEXT PRIMARY KEY,
				path TEXT NOT NULL,
				data TEXT NOT NULL,
				preview TEXT NOT NULL,
				service_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				chat_id TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL,
				status TEXT NOT NULL DEFAULT 'pending',
				on_approval TEXT,
				admin_message_id INTEGER,
				approved_by TEXT,
				approved_at INTEGER,
				error TEXT
			);`);
			db.execute(`CREATE INDEX IF NOT EXISTS idx_pending_writes_status ON pending_writes(status);`);
			db.execute(
				`CREATE INDEX IF NOT EXISTS idx_pending_writes_expires ON pending_writes(expires_at);`,
			);
		},
	},
	{
		id: 4,
		name: "add_service_bundles_has_npm",
		up: (_db: DB) => {
			// No-op now: the `service_bundles` table is dropped entirely in
			// migration 9. Kept as a numbered slot so existing installs still
			// advance through the migration sequence monotonically.
		},
	},
	{
		id: 5,
		name: "add_chat_feature_overrides",
		up: (db: DB) => {
			db.execute(`CREATE TABLE IF NOT EXISTS chat_feature_overrides (
				chat_id TEXT NOT NULL,
				feature_id TEXT NOT NULL,
				enabled INTEGER,
				data TEXT NOT NULL DEFAULT '{}',
				updated_at INTEGER NOT NULL,
				PRIMARY KEY (chat_id, feature_id)
			);`);
		},
	},
	{
		id: 6,
		name: "add_periodic_pin_state",
		up: (db: DB) => {
			// Tracks the most recent pinned periodic broadcast message per chat
			// (so the next broadcast can unpin it) and the last-fired time slot
			// (so a restart within the same slot doesn't double-fire).
			db.execute(`CREATE TABLE IF NOT EXISTS periodic_pin_state (
				chat_id TEXT PRIMARY KEY,
				pinned_message_id INTEGER,
				last_fired_slot TEXT,
				updated_at INTEGER NOT NULL
			);`);
		},
	},
	{
		id: 7,
		name: "add_pending_writes_on_rejection",
		up: (db: DB) => {
			// Services can pass an onRejectionMessage with pubkyWrite() to get
			// a courtesy "your submission was rejected" sent to the originating
			// user when an admin rejects.
			try {
				db.execute(`ALTER TABLE pending_writes ADD COLUMN on_rejection TEXT;`);
			} catch (_err) {
				// Column might already exist
			}
		},
	},
	{
		id: 8,
		name: "drop_chat_configs_table",
		up: (db: DB) => {
			// chat_configs was the persistence layer for the old /setconfig
			// template-selection command. The new architecture is a single
			// operator-owned config.yaml + per-chat overrides in
			// chat_feature_overrides. Nothing writes to chat_configs anymore,
			// and keeping it around was fooling the scheduler's chat enumeration.
			try {
				db.execute(`DROP TABLE IF EXISTS chat_configs;`);
			} catch (_err) {
				// ignore
			}
		},
	},
	{
		id: 9,
		name: "drop_service_bundles_table",
		up: (db: DB) => {
			// Services now run from their source path directly — the sandbox
			// subprocess resolves @sdk/ / @eventky/ / npm: imports via the
			// project's deno.json import map. No bundler, no content-addressed
			// blob cache, no service_bundles row per snapshot. Also clear any
			// persisted snapshots so stale routes (pointing at dead bundle
			// hashes) don't survive the upgrade.
			try {
				db.execute(`DROP TABLE IF EXISTS service_bundles;`);
			} catch (_err) {
				// ignore
			}
			try {
				db.execute(`DELETE FROM snapshots_by_config;`);
			} catch (_err) {
				// ignore
			}
		},
	},
	{
		id: 10,
		name: "drop_snapshots_integrity_hash",
		up: (db: DB) => {
			// `integrity_hash` was written on every snapshot save but never
			// read — it was part of an old integrity check that got removed.
			// Drop the column via table-rebuild (SQLite ALTER TABLE DROP COLUMN
			// requires 3.35+, which the deno.land/x/sqlite bundle may not have).
			try {
				db.execute(
					`CREATE TABLE snapshots_by_config_new (
					config_hash TEXT PRIMARY KEY,
					snapshot_json TEXT NOT NULL,
					built_at INTEGER NOT NULL
				);`,
				);
				db.execute(
					`INSERT INTO snapshots_by_config_new (config_hash, snapshot_json, built_at)
					 SELECT config_hash, snapshot_json, built_at FROM snapshots_by_config;`,
				);
				db.execute(`DROP TABLE snapshots_by_config;`);
				db.execute(`ALTER TABLE snapshots_by_config_new RENAME TO snapshots_by_config;`);
			} catch (_err) {
				// ignore — either the rebuild already happened or the table is
				// in an unexpected state; either way the column is never read.
			}
		},
	},
	{
		id: 11,
		name: "add_polls_tables",
		up: (db: DB) => {
			db.execute(`CREATE TABLE IF NOT EXISTS polls (
				id TEXT PRIMARY KEY,
				chat_id TEXT NOT NULL,
				creator_user_id TEXT NOT NULL,
				creator_display_name TEXT NOT NULL,
				title TEXT NOT NULL,
				message_id INTEGER,
				status TEXT NOT NULL DEFAULT 'open',
				created_at INTEGER NOT NULL,
				closed_at INTEGER
			);`);
			db.execute(`CREATE TABLE IF NOT EXISTS poll_options (
				id TEXT PRIMARY KEY,
				poll_id TEXT NOT NULL,
				start_date TEXT NOT NULL,
				start_time TEXT NOT NULL,
				end_date TEXT NOT NULL,
				end_time TEXT NOT NULL,
				position INTEGER NOT NULL
			);`);
			db.execute(`CREATE TABLE IF NOT EXISTS poll_votes (
				poll_id TEXT NOT NULL,
				option_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				display_name TEXT NOT NULL,
				voted_at INTEGER NOT NULL,
				PRIMARY KEY (poll_id, option_id, user_id)
			);`);
			db.execute(
				`CREATE INDEX IF NOT EXISTS idx_polls_chat_status ON polls(chat_id, status);`,
			);
			db.execute(`CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options(poll_id);`);
			db.execute(`CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id);`);
		},
	},
];

export function runMigrations(db: DB): void {
	db.execute(`CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
    );`);
	const appliedRows = db.query<[number]>(`SELECT id FROM migrations ORDER BY id ASC`);
	const applied = new Set(appliedRows.map((r) => r[0]));
	for (const m of migrations) {
		if (applied.has(m.id)) continue;
		const start = Date.now();
		try {
			m.up(db);
			db.query(`INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)`, [
				m.id,
				m.name,
				Date.now(),
			]);
			log.info("migration.applied", { id: m.id, name: m.name, ms: Date.now() - start });
		} catch (err) {
			log.error("migration.failed", { id: m.id, name: m.name, error: (err as Error).message });
			throw err; // stop further migrations
		}
	}
}
