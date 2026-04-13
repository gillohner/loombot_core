// src/core/pubky/writer_store.ts
// SQLite-backed storage for pending Pubky write requests.

import { DB } from "sqlite";

let db: DB | null = null;

export interface PendingWrite {
	id: string;
	path: string;
	data: unknown;
	preview: string;
	serviceId: string;
	userId: string;
	chatId: string;
	createdAt: number;
	expiresAt: number;
	status: "pending" | "approved" | "rejected" | "written" | "failed" | "expired";
	onApproval?: {
		chatId: string;
		message: string;
	};
	onRejection?: {
		chatId: string;
		message: string;
	};
	adminMessageId?: number;
	approvedBy?: string;
	approvedAt?: number;
	error?: string;
}

export interface PendingWriteRecord {
	id: string;
	path: string;
	data: string; // JSON
	preview: string;
	service_id: string;
	user_id: string;
	chat_id: string;
	created_at: number;
	expires_at: number;
	status: string;
	on_approval: string | null; // JSON
	admin_message_id: number | null;
	approved_by: string | null;
	approved_at: number | null;
	error: string | null;
}

// ---------------------------------------------------------------------------
// Initialization (reuses the main bot database)
// ---------------------------------------------------------------------------
export function setWriterDb(database: DB): void {
	db = database;
}

function ensureDb(): DB {
	if (!db) throw new Error("Writer database not initialized. Call setWriterDb first.");
	return db;
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

export function savePendingWrite(write: PendingWrite): void {
	const database = ensureDb();
	database.query(
		`INSERT INTO pending_writes (
			id, path, data, preview, service_id, user_id, chat_id,
			created_at, expires_at, status, on_approval, on_rejection, admin_message_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			path=excluded.path,
			data=excluded.data,
			preview=excluded.preview,
			status=excluded.status,
			on_approval=excluded.on_approval,
			on_rejection=excluded.on_rejection,
			admin_message_id=excluded.admin_message_id`,
		[
			write.id,
			write.path,
			JSON.stringify(write.data),
			write.preview,
			write.serviceId,
			write.userId,
			write.chatId,
			write.createdAt,
			write.expiresAt,
			write.status,
			write.onApproval ? JSON.stringify(write.onApproval) : null,
			write.onRejection ? JSON.stringify(write.onRejection) : null,
			write.adminMessageId ?? null,
		],
	);
}

type PendingWriteRow = [
	string, // id
	string, // path
	string, // data (json)
	string, // preview
	string, // service_id
	string, // user_id
	string, // chat_id
	number, // created_at
	number, // expires_at
	string, // status
	string | null, // on_approval (json)
	string | null, // on_rejection (json)
	number | null, // admin_message_id
	string | null, // approved_by
	number | null, // approved_at
	string | null, // error
];

const PENDING_SELECT = `SELECT id, path, data, preview, service_id, user_id, chat_id,
	created_at, expires_at, status, on_approval, on_rejection, admin_message_id,
	approved_by, approved_at, error
FROM pending_writes`;

function rowToPending(row: PendingWriteRow): PendingWrite {
	const [
		id,
		path,
		data,
		preview,
		serviceId,
		userId,
		chatId,
		createdAt,
		expiresAt,
		status,
		onApproval,
		onRejection,
		adminMessageId,
		approvedBy,
		approvedAt,
		error,
	] = row;
	return {
		id,
		path,
		data: JSON.parse(data),
		preview,
		serviceId,
		userId,
		chatId,
		createdAt,
		expiresAt,
		status: status as PendingWrite["status"],
		onApproval: onApproval ? JSON.parse(onApproval) : undefined,
		onRejection: onRejection ? JSON.parse(onRejection) : undefined,
		adminMessageId: adminMessageId ?? undefined,
		approvedBy: approvedBy ?? undefined,
		approvedAt: approvedAt ?? undefined,
		error: error ?? undefined,
	};
}

export function getPendingWrite(id: string): PendingWrite | undefined {
	const database = ensureDb();
	const row = database
		.query<PendingWriteRow>(`${PENDING_SELECT} WHERE id = ?`, [id])
		.at(0);
	if (!row) return undefined;
	return rowToPending(row);
}

export function updatePendingWriteStatus(
	id: string,
	status: PendingWrite["status"],
	extra?: {
		approvedBy?: string;
		approvedAt?: number;
		error?: string;
		adminMessageId?: number;
	},
): void {
	const database = ensureDb();

	if (extra) {
		database.query(
			`UPDATE pending_writes SET
				status = ?,
				approved_by = COALESCE(?, approved_by),
				approved_at = COALESCE(?, approved_at),
				error = COALESCE(?, error),
				admin_message_id = COALESCE(?, admin_message_id)
			WHERE id = ?`,
			[
				status,
				extra.approvedBy ?? null,
				extra.approvedAt ?? null,
				extra.error ?? null,
				extra.adminMessageId ?? null,
				id,
			],
		);
	} else {
		database.query(`UPDATE pending_writes SET status = ? WHERE id = ?`, [status, id]);
	}
}

export function getExpiredPendingWrites(): PendingWrite[] {
	const database = ensureDb();
	const now = Date.now();
	const rows = database.query<PendingWriteRow>(
		`${PENDING_SELECT} WHERE status = 'pending' AND expires_at < ?`,
		[now],
	);
	return rows.map(rowToPending);
}

export function getPendingWritesByStatus(status: PendingWrite["status"]): PendingWrite[] {
	const database = ensureDb();
	const rows = database.query<PendingWriteRow>(
		`${PENDING_SELECT} WHERE status = ? ORDER BY created_at DESC`,
		[status],
	);
	return rows.map(rowToPending);
}

export function deletePendingWrite(id: string): void {
	const database = ensureDb();
	database.query(`DELETE FROM pending_writes WHERE id = ?`, [id]);
}

export function countPendingWritesByUser(userId: string, status?: PendingWrite["status"]): number {
	const database = ensureDb();
	if (status) {
		const row = database
			.query<[number]>(
				`SELECT COUNT(*) FROM pending_writes WHERE user_id = ? AND status = ?`,
				[userId, status],
			)
			.at(0);
		return row?.[0] ?? 0;
	}
	const row = database
		.query<[number]>(`SELECT COUNT(*) FROM pending_writes WHERE user_id = ?`, [userId])
		.at(0);
	return row?.[0] ?? 0;
}
