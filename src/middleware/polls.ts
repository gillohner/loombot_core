// src/middleware/polls.ts
// Host-side callback handler for when2meet polls. Registered in router.ts
// alongside the existing pubky: and cfg: intercepts; sits in front of the
// generic service dispatch so vote/close/new_event buttons never touch the
// sandbox.
//
// Callback data format:
//   w2m:vote:<pollId>:<optionId>    — toggle a user's vote on an option
//   w2m:close:<pollId>              — close the poll (organizer/admin only)
//   w2m:new_event:<pollId>          — seed event_creator with the winning slot

import type { Composer, Context } from "grammy";
import { log } from "@core/util/logger.ts";
import { getLocale, t } from "@core/i18n/mod.ts";
import {
	closePoll,
	getPoll,
	getPollWithTally,
	getWinningOption,
	toggleVote,
} from "@core/polls/store.ts";
import { renderClosedPoll, renderOpenPoll } from "@core/polls/renderer.ts";
import { buildSnapshot } from "@core/snapshot/snapshot.ts";
import { setActiveFlow, setServiceState } from "@core/state/state.ts";
import { userIsAdmin } from "@middleware/admin.ts";

const W2M_PREFIX = "w2m:";

function displayNameOf(ctx: Context): string {
	const f = ctx.from;
	if (!f) return "?";
	const parts = [f.first_name, f.last_name].filter(Boolean);
	const joined = parts.join(" ").trim();
	return joined || f.username || String(f.id);
}

async function handleVote(ctx: Context, pollId: string, optionId: string): Promise<void> {
	const userId = String(ctx.from?.id ?? "");
	const name = displayNameOf(ctx);
	const result = toggleVote({ pollId, optionId, userId, displayName: name });
	if (result === "rejected") {
		await ctx.answerCallbackQuery({ text: t("polls.vote_rejected_closed") });
		return;
	}
	const data = getPollWithTally(pollId);
	if (!data) {
		await ctx.answerCallbackQuery({ text: t("polls.poll_not_found") });
		return;
	}
	const rendered = renderOpenPoll(data, getLocale());
	try {
		await ctx.editMessageText(rendered.text, {
			parse_mode: "HTML",
			// @ts-ignore grammy reply_markup type is strict
			reply_markup: rendered.replyMarkup,
		});
	} catch (err) {
		// "message is not modified" can happen if two users click the same
		// button in rapid succession — ignore.
		const desc = (err as { description?: string }).description ?? (err as Error).message ?? "";
		if (!/message is not modified/i.test(desc)) {
			log.warn("w2m.vote.edit_failed", { error: desc });
		}
	}
	await ctx.answerCallbackQuery();
}

async function handleClose(ctx: Context, pollId: string): Promise<void> {
	const poll = getPoll(pollId);
	if (!poll) {
		await ctx.answerCallbackQuery({ text: t("polls.poll_not_found") });
		return;
	}
	const userId = String(ctx.from?.id ?? "");
	const isOrganizer = userId === poll.creatorUserId;
	const isAdmin = await userIsAdmin(ctx);
	if (!isOrganizer && !isAdmin) {
		await ctx.answerCallbackQuery({ text: t("polls.close_not_authorized") });
		return;
	}
	closePoll(pollId);
	const data = getPollWithTally(pollId);
	if (!data) {
		await ctx.answerCallbackQuery({ text: t("polls.poll_not_found") });
		return;
	}
	const winner = getWinningOption(pollId);
	const rendered = renderClosedPoll(data, winner, getLocale());
	try {
		await ctx.editMessageText(rendered.text, {
			parse_mode: "HTML",
			// @ts-ignore grammy reply_markup type is strict
			reply_markup: rendered.replyMarkup,
		});
	} catch (err) {
		const desc = (err as { description?: string }).description ?? (err as Error).message ?? "";
		if (!/message is not modified/i.test(desc)) {
			log.warn("w2m.close.edit_failed", { error: desc });
		}
	}
	await ctx.answerCallbackQuery({ text: t("polls.closed_toast") });
}

async function handleNewEvent(ctx: Context, pollId: string): Promise<void> {
	const data = getPollWithTally(pollId);
	if (!data) {
		await ctx.answerCallbackQuery({ text: t("polls.poll_not_found") });
		return;
	}
	const winner = getWinningOption(pollId);
	if (!winner) {
		await ctx.answerCallbackQuery({ text: t("polls.poll_not_found") });
		return;
	}
	const chatId = String(ctx.chat?.id ?? "");
	const userId = String(ctx.from?.id ?? "");
	const snapshot = await buildSnapshot(chatId, { chatType: ctx.chat?.type });
	// Look up the feature id that runs event_creator in this chat.
	// Operators can rename the feature (e.g. "meetup_erstellen"), so we match
	// on manifestServiceId.
	const route = Object.values(snapshot.commands).find(
		(r) => r.manifestServiceId === "event_creator" && r.kind === "command_flow",
	);
	if (!route) {
		await ctx.answerCallbackQuery({ text: t("polls.event_creator_unavailable") });
		return;
	}
	// Seed event_creator state directly: the next message the user sends will
	// be dispatched through the normal active-flow path, landing in
	// event_creator's message handler which will accept the title and (because
	// startDate/startTime are seeded) skip straight to the optional menu.
	setServiceState(
		{ chatId, userId, serviceId: route.serviceId },
		{
			phase: "required",
			requirementStep: 1, // REQ_STEP_TITLE
			startDate: winner.startDate,
			startTime: winner.startTime,
			endDate: winner.endDate,
			endTime: winner.endTime,
			__seededFromPoll: pollId,
		},
	);
	setActiveFlow(chatId, userId, route.serviceId);
	try {
		await ctx.reply(t("polls.event_seed_prompt"));
	} catch (err) {
		log.warn("w2m.new_event.reply_failed", { error: (err as Error).message });
	}
	await ctx.answerCallbackQuery();
}

export function registerW2MCallbacks(composer: Composer<Context>): void {
	composer.callbackQuery(/^w2m:/, async (ctx: Context) => {
		const data = ctx.callbackQuery?.data ?? "";
		if (!data.startsWith(W2M_PREFIX)) {
			await ctx.answerCallbackQuery();
			return;
		}
		const rest = data.slice(W2M_PREFIX.length);
		// vote:<pollId>:<optionId>
		if (rest.startsWith("vote:")) {
			const parts = rest.slice("vote:".length).split(":");
			const pollId = parts[0];
			const optionId = parts.slice(1).join(":");
			if (!pollId || !optionId) {
				await ctx.answerCallbackQuery({ text: t("polls.poll_not_found") });
				return;
			}
			await handleVote(ctx, pollId, optionId);
			return;
		}
		if (rest.startsWith("close:")) {
			const pollId = rest.slice("close:".length);
			if (!pollId) {
				await ctx.answerCallbackQuery({ text: t("polls.poll_not_found") });
				return;
			}
			await handleClose(ctx, pollId);
			return;
		}
		if (rest.startsWith("new_event:")) {
			const pollId = rest.slice("new_event:".length);
			if (!pollId) {
				await ctx.answerCallbackQuery({ text: t("polls.poll_not_found") });
				return;
			}
			await handleNewEvent(ctx, pollId);
			return;
		}
		log.debug("w2m.callback.unknown", { data });
		await ctx.answerCallbackQuery();
	});
}
