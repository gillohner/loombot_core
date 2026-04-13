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
			db.execute(`CREATE TABLE IF NOT EXISTS chat_configs (
            chat_id TEXT PRIMARY KEY,
            config_id TEXT NOT NULL,
            config_json TEXT NOT NULL,
            config_hash TEXT,
            updated_at INTEGER NOT NULL
        );`);
			db.execute(`CREATE TABLE IF NOT EXISTS snapshots (
            chat_id TEXT PRIMARY KEY,
            snapshot_json TEXT NOT NULL,
            built_at INTEGER NOT NULL,
            integrity_hash TEXT NOT NULL
        );`);
			db.execute(`CREATE TABLE IF NOT EXISTS snapshots_by_config (
            config_hash TEXT PRIMARY KEY,
            snapshot_json TEXT NOT NULL,
            built_at INTEGER NOT NULL,
            integrity_hash TEXT NOT NULL
        );`);
			db.execute(`CREATE TABLE IF NOT EXISTS service_bundles (
            bundle_hash TEXT PRIMARY KEY,
            data_url TEXT NOT NULL,
            code TEXT NOT NULL,
            created_at INTEGER NOT NULL
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
		up: (db: DB) => {
			// Add has_npm column to service_bundles table
			// Default 0 for existing bundles (they were created before npm support)
			try {
				db.execute(`ALTER TABLE service_bundles ADD COLUMN has_npm INTEGER NOT NULL DEFAULT 0;`);
			} catch (_err) {
				// Column might already exist
			}
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
