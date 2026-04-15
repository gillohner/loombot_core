// src/core/polls/renderer.ts
// Renders the when2meet poll message (text + inline keyboard) from a poll
// state snapshot. Used both when the poll is first posted (Telegram adapter)
// and on every vote click (host-side router handler).

import { escapeHtml } from "@sdk/mod.ts";
import type { Poll, PollOption, PollVote, PollWithTally } from "./store.ts";

export interface RenderedPoll {
	text: string;
	replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
}

const POLL_T = {
	en: {
		header: "📅 <b>When can we meet?</b>",
		pick: "Tap a slot to mark yourself available (tap again to remove):",
		close_button: "✅ Close vote",
		closed_header: "✅ <b>Vote closed</b>",
		winner_line: "🏆 <b>Winning slot:</b> {{slot}}",
		no_votes: "No votes were cast.",
		create_event_button: "📝 Create event with this slot",
		no_voters: "— no one yet",
	},
	de: {
		header: "📅 <b>Wann können wir uns treffen?</b>",
		pick: "Tippe auf einen Slot, um dich einzutragen (nochmal tippen zum Entfernen):",
		close_button: "✅ Abstimmung schliessen",
		closed_header: "✅ <b>Abstimmung beendet</b>",
		winner_line: "🏆 <b>Gewinner-Slot:</b> {{slot}}",
		no_votes: "Es wurden keine Stimmen abgegeben.",
		create_event_button: "📝 Event mit diesem Slot erstellen",
		no_voters: "— noch niemand",
	},
} as const;

type PollLocale = keyof typeof POLL_T;

function pickLocale(locale: string | undefined): PollLocale {
	return locale === "de" ? "de" : "en";
}

function tr(
	locale: PollLocale,
	key: keyof typeof POLL_T["en"],
	params?: Record<string, string>,
): string {
	let txt: string = POLL_T[locale][key];
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			txt = txt.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
		}
	}
	return txt;
}

/**
 * Format a slot like "Thu 23.04.2026 19:00–22:00".
 */
export function formatSlot(opt: PollOption, locale: string | undefined): string {
	const sameDay = opt.startDate === opt.endDate;
	if (sameDay) {
		return `${formatDateShort(opt.startDate, locale)} ${opt.startTime}–${opt.endTime}`;
	}
	return `${formatDateShort(opt.startDate, locale)} ${opt.startTime} → ${
		formatDateShort(opt.endDate, locale)
	} ${opt.endTime}`;
}

function formatDateShort(ddmmyyyy: string, locale: string | undefined): string {
	const [dd, mm, yyyy] = ddmmyyyy.split(".");
	if (!dd || !mm || !yyyy) return ddmmyyyy;
	// Render a weekday label without requiring Intl locale data; fall back to
	// the plain date string if Date parsing fails.
	try {
		const date = new Date(`${yyyy}-${mm}-${dd}T12:00:00`);
		if (isNaN(date.getTime())) return ddmmyyyy;
		const wd = date.toLocaleDateString(locale === "de" ? "de-DE" : "en-US", { weekday: "short" });
		return `${wd} ${ddmmyyyy}`;
	} catch {
		return ddmmyyyy;
	}
}

function shortButtonLabel(opt: PollOption, locale: string | undefined): string {
	const [dd, mm] = opt.startDate.split(".");
	return `${formatWeekday(opt.startDate, locale)} ${dd}.${mm} ${opt.startTime}`;
}

function formatWeekday(ddmmyyyy: string, locale: string | undefined): string {
	const [dd, mm, yyyy] = ddmmyyyy.split(".");
	if (!dd || !mm || !yyyy) return "";
	try {
		const date = new Date(`${yyyy}-${mm}-${dd}T12:00:00`);
		if (isNaN(date.getTime())) return "";
		return date.toLocaleDateString(locale === "de" ? "de-DE" : "en-US", { weekday: "short" });
	} catch {
		return "";
	}
}

/**
 * Render an open poll: question title, each slot with vote count + voter names,
 * one button per slot, plus a close-vote button.
 */
export function renderOpenPoll(
	data: PollWithTally,
	locale: string | undefined,
): RenderedPoll {
	const loc = pickLocale(locale);
	const { poll, options, votesByOption } = data;
	const lines: string[] = [
		tr(loc, "header"),
		"",
		`<b>${escapeHtml(poll.title)}</b>`,
		"",
		tr(loc, "pick"),
		"",
	];
	for (const opt of options) {
		const voters = votesByOption.get(opt.id) ?? [];
		const slotText = formatSlot(opt, locale);
		const count = voters.length;
		const names = voters.length > 0
			? voters.map((v) => escapeHtml(v.displayName)).join(", ")
			: `<i>${tr(loc, "no_voters")}</i>`;
		lines.push(`▪ ${escapeHtml(slotText)}  <b>(${count})</b>`);
		lines.push(`   ${names}`);
	}
	const text = lines.join("\n");

	const keyboardRows: Array<Array<{ text: string; callback_data: string }>> = [];
	for (const opt of options) {
		const voters = votesByOption.get(opt.id) ?? [];
		keyboardRows.push([
			{
				text: `${shortButtonLabel(opt, locale)} (${voters.length})`,
				callback_data: `w2m:vote:${poll.id}:${opt.id}`,
			},
		]);
	}
	keyboardRows.push([
		{
			text: tr(loc, "close_button"),
			callback_data: `w2m:close:${poll.id}`,
		},
	]);
	return {
		text,
		replyMarkup: { inline_keyboard: keyboardRows },
	};
}

/**
 * Render a closed poll: shows final tally, winner line, and a "create event"
 * button (only if at least one vote was cast).
 */
export function renderClosedPoll(
	data: PollWithTally,
	winner: PollOption | null,
	locale: string | undefined,
): RenderedPoll {
	const loc = pickLocale(locale);
	const { poll, options, votesByOption } = data;
	const lines: string[] = [
		tr(loc, "closed_header"),
		"",
		`<b>${escapeHtml(poll.title)}</b>`,
		"",
	];
	for (const opt of options) {
		const voters = votesByOption.get(opt.id) ?? [];
		const marker = winner && opt.id === winner.id ? "🏆" : "▪";
		const slotText = formatSlot(opt, locale);
		lines.push(
			`${marker} ${escapeHtml(slotText)}  <b>(${voters.length})</b>  ${
				voters.length > 0 ? voters.map((v) => escapeHtml(v.displayName)).join(", ") : ""
			}`.trimEnd(),
		);
	}
	lines.push("");
	if (winner && (votesByOption.get(winner.id)?.length ?? 0) > 0) {
		lines.push(tr(loc, "winner_line", { slot: escapeHtml(formatSlot(winner, locale)) }));
	} else {
		lines.push(tr(loc, "no_votes"));
	}

	const keyboardRows: Array<Array<{ text: string; callback_data: string }>> = [];
	if (winner && (votesByOption.get(winner.id)?.length ?? 0) > 0) {
		keyboardRows.push([
			{
				text: tr(loc, "create_event_button"),
				callback_data: `w2m:new_event:${poll.id}`,
			},
		]);
	}
	return {
		text: lines.join("\n"),
		replyMarkup: { inline_keyboard: keyboardRows },
	};
}

/**
 * Convenience: render the initial poll message right after creation (the poll
 * has zero votes). Takes a plain Poll + options list instead of a tally.
 */
export function renderFreshPoll(
	poll: Poll,
	options: PollOption[],
	locale: string | undefined,
): RenderedPoll {
	const votesByOption = new Map<string, PollVote[]>(options.map((o) => [o.id, []]));
	return renderOpenPoll({ poll, options, votesByOption }, locale);
}
