// src/core/polls/store.ts
// SQLite-backed store for when2meet availability polls. Polls are group state:
// a single poll row per chat carries the organizer's question, and N option
// rows carry the candidate time slots. Votes are (poll, option, user) rows.
// Polls survive bot restarts because everything lives on disk — a vote clicked
// an hour after a restart still lands correctly.

import { getDb } from "@core/config/store.ts";

export interface Poll {
	id: string;
	chatId: string;
	creatorUserId: string;
	creatorDisplayName: string;
	title: string;
	messageId: number | null;
	status: "open" | "closed";
	createdAt: number;
	closedAt: number | null;
}

export interface PollOption {
	id: string;
	pollId: string;
	startDate: string;
	startTime: string;
	endDate: string;
	endTime: string;
	position: number;
}

export interface PollVote {
	pollId: string;
	optionId: string;
	userId: string;
	displayName: string;
	votedAt: number;
}

export interface PollWithTally {
	poll: Poll;
	options: PollOption[];
	/** Voters keyed by optionId. Each voter appears once per option they selected. */
	votesByOption: Map<string, PollVote[]>;
}

export interface CreatePollParams {
	chatId: string;
	creatorUserId: string;
	creatorDisplayName: string;
	title: string;
	slots: Array<{
		startDate: string;
		startTime: string;
		endDate: string;
		endTime: string;
	}>;
}

export function createPoll(params: CreatePollParams): PollWithTally {
	const db = getDb();
	const id = crypto.randomUUID();
	const now = Date.now();
	db.query(
		`INSERT INTO polls (id, chat_id, creator_user_id, creator_display_name, title, message_id, status, created_at)
		 VALUES (?, ?, ?, ?, ?, NULL, 'open', ?)`,
		[id, params.chatId, params.creatorUserId, params.creatorDisplayName, params.title, now],
	);
	const options: PollOption[] = [];
	for (let i = 0; i < params.slots.length; i++) {
		const slot = params.slots[i];
		const optionId = crypto.randomUUID();
		db.query(
			`INSERT INTO poll_options (id, poll_id, start_date, start_time, end_date, end_time, position)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[optionId, id, slot.startDate, slot.startTime, slot.endDate, slot.endTime, i],
		);
		options.push({
			id: optionId,
			pollId: id,
			startDate: slot.startDate,
			startTime: slot.startTime,
			endDate: slot.endDate,
			endTime: slot.endTime,
			position: i,
		});
	}
	const poll: Poll = {
		id,
		chatId: params.chatId,
		creatorUserId: params.creatorUserId,
		creatorDisplayName: params.creatorDisplayName,
		title: params.title,
		messageId: null,
		status: "open",
		createdAt: now,
		closedAt: null,
	};
	return {
		poll,
		options,
		votesByOption: new Map(options.map((o) => [o.id, []])),
	};
}

export function updateMessageId(pollId: string, messageId: number): void {
	const db = getDb();
	db.query(`UPDATE polls SET message_id = ? WHERE id = ?`, [messageId, pollId]);
}

export function getPoll(pollId: string): Poll | null {
	const db = getDb();
	const row = db
		.query<[string, string, string, string, string, number | null, string, number, number | null]>(
			`SELECT id, chat_id, creator_user_id, creator_display_name, title, message_id, status, created_at, closed_at
			 FROM polls WHERE id = ?`,
			[pollId],
		)
		.at(0);
	if (!row) return null;
	return {
		id: row[0],
		chatId: row[1],
		creatorUserId: row[2],
		creatorDisplayName: row[3],
		title: row[4],
		messageId: row[5],
		status: row[6] === "closed" ? "closed" : "open",
		createdAt: row[7],
		closedAt: row[8],
	};
}

export function getPollWithTally(pollId: string): PollWithTally | null {
	const db = getDb();
	const poll = getPoll(pollId);
	if (!poll) return null;
	const optionRows = db.query<[string, string, string, string, string, string, number]>(
		`SELECT id, poll_id, start_date, start_time, end_date, end_time, position
		 FROM poll_options WHERE poll_id = ? ORDER BY position ASC`,
		[pollId],
	);
	const options: PollOption[] = optionRows.map(([id, pid, sd, st, ed, et, pos]) => ({
		id,
		pollId: pid,
		startDate: sd,
		startTime: st,
		endDate: ed,
		endTime: et,
		position: pos,
	}));
	const voteRows = db.query<[string, string, string, string, number]>(
		`SELECT poll_id, option_id, user_id, display_name, voted_at
		 FROM poll_votes WHERE poll_id = ? ORDER BY voted_at ASC`,
		[pollId],
	);
	const votesByOption = new Map<string, PollVote[]>(options.map((o) => [o.id, []]));
	for (const [pid, oid, uid, name, ts] of voteRows) {
		const list = votesByOption.get(oid);
		if (!list) continue;
		list.push({ pollId: pid, optionId: oid, userId: uid, displayName: name, votedAt: ts });
	}
	return { poll, options, votesByOption };
}

/**
 * Toggle a vote: if the user has already voted for this option, remove it;
 * otherwise add it. Returns the new state ("added" | "removed" | "rejected").
 */
export function toggleVote(params: {
	pollId: string;
	optionId: string;
	userId: string;
	displayName: string;
}): "added" | "removed" | "rejected" {
	const db = getDb();
	const poll = getPoll(params.pollId);
	if (!poll || poll.status !== "open") return "rejected";
	const exists = db
		.query<[number]>(
			`SELECT 1 FROM poll_votes WHERE poll_id = ? AND option_id = ? AND user_id = ? LIMIT 1`,
			[params.pollId, params.optionId, params.userId],
		)
		.at(0);
	if (exists) {
		db.query(
			`DELETE FROM poll_votes WHERE poll_id = ? AND option_id = ? AND user_id = ?`,
			[params.pollId, params.optionId, params.userId],
		);
		return "removed";
	}
	db.query(
		`INSERT INTO poll_votes (poll_id, option_id, user_id, display_name, voted_at)
		 VALUES (?, ?, ?, ?, ?)`,
		[params.pollId, params.optionId, params.userId, params.displayName, Date.now()],
	);
	return "added";
}

export function closePoll(pollId: string): Poll | null {
	const db = getDb();
	const poll = getPoll(pollId);
	if (!poll) return null;
	if (poll.status === "closed") return poll;
	const closedAt = Date.now();
	db.query(`UPDATE polls SET status = 'closed', closed_at = ? WHERE id = ?`, [closedAt, pollId]);
	return { ...poll, status: "closed", closedAt };
}

/**
 * Compute the winning option of a closed poll. Winner = most unique voters;
 * ties broken by earliest start_date + start_time (position as final fallback).
 */
export function getWinningOption(pollId: string): PollOption | null {
	const data = getPollWithTally(pollId);
	if (!data || data.options.length === 0) return null;
	let best: PollOption | null = null;
	let bestCount = -1;
	for (const opt of data.options) {
		const count = data.votesByOption.get(opt.id)?.length ?? 0;
		if (count > bestCount) {
			best = opt;
			bestCount = count;
			continue;
		}
		if (count === bestCount && best) {
			if (slotSortKey(opt) < slotSortKey(best)) best = opt;
		}
	}
	return best;
}

function slotSortKey(o: PollOption): string {
	// DD.MM.YYYY → YYYYMMDD for sortable comparison
	const [dd, mm, yyyy] = o.startDate.split(".");
	return `${yyyy}${mm}${dd}${o.startTime}${String(o.position).padStart(3, "0")}`;
}

/**
 * Does the given chat already have an open poll? Used to reject concurrent
 * polls per chat in v1.
 */
export function hasOpenPoll(chatId: string): boolean {
	const db = getDb();
	const row = db
		.query<[number]>(
			`SELECT 1 FROM polls WHERE chat_id = ? AND status = 'open' LIMIT 1`,
			[chatId],
		)
		.at(0);
	return !!row;
}

export function getOpenPollByMessageId(chatId: string, messageId: number): Poll | null {
	const db = getDb();
	const row = db
		.query<[string, string, string, string, string, number | null, string, number, number | null]>(
			`SELECT id, chat_id, creator_user_id, creator_display_name, title, message_id, status, created_at, closed_at
			 FROM polls WHERE chat_id = ? AND message_id = ?`,
			[chatId, messageId],
		)
		.at(0);
	if (!row) return null;
	return {
		id: row[0],
		chatId: row[1],
		creatorUserId: row[2],
		creatorDisplayName: row[3],
		title: row[4],
		messageId: row[5],
		status: row[6] === "closed" ? "closed" : "open",
		createdAt: row[7],
		closedAt: row[8],
	};
}
