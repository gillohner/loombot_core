// src/middleware/config_ui/mod.ts
// Central wiring for /config. Exposes:
//   - registerConfigUi(composer)   — attaches the /config command + callback handlers
//   - routeConfigTextInput(ctx)    — lets the message router hand off pending input
// No service sandboxing — /config runs inline in the middleware.

import { Composer, type Context } from "grammy";
import { userIsAdmin } from "@middleware/admin.ts";
import { log } from "@core/util/logger.ts";
import { t } from "@core/i18n/mod.ts";
import { editToMainMenu, sendMainMenu } from "@middleware/config_ui/menu.ts";
import { showFeatures, toggleFeature } from "@middleware/config_ui/features.ts";
import {
	handleExternalCalendarInput,
	promptAddExternalCalendar,
	removeExternalCalendar,
	showCalendars,
	toggleCuratedCalendar,
} from "@middleware/config_ui/calendars.ts";
import {
	handleWelcomeInput,
	promptEditWelcome,
	resetWelcome,
	showWelcome,
} from "@middleware/config_ui/welcome.ts";
import {
	handleTimezoneInput,
	promptEditTimezone,
	resetPeriodic,
	setDay,
	setHour,
	setRange,
	showPeriodic,
	toggleEnabled,
	togglePin,
	toggleUnpinPrevious,
	triggerPreview,
} from "@middleware/config_ui/periodic.ts";
import { clearPendingInput, getPendingInput } from "@middleware/config_ui/state.ts";

const CFG_CALLBACK = /^cfg:/;

export function registerConfigUi(composer: Composer<Context>): void {
	composer.callbackQuery(CFG_CALLBACK, async (ctx: Context) => {
		const chatId = String(ctx.chat?.id ?? "");
		const data = ctx.callbackQuery?.data ?? "";

		if (!(await userIsAdmin(ctx))) {
			await ctx.answerCallbackQuery({
				text: t("config_ui.toast.admin_only"),
				show_alert: false,
			});
			return;
		}

		try {
			if (data === "cfg:main") return await editToMainMenu(ctx, chatId);
			if (data === "cfg:close") {
				try {
					await ctx.deleteMessage();
				} catch {
					await ctx.editMessageText(t("config_ui.common.closed_placeholder"));
				}
				await ctx.answerCallbackQuery();
				return;
			}

			if (data === "cfg:feats") {
				await showFeatures(ctx, chatId);
				await ctx.answerCallbackQuery();
				return;
			}

			const featToggle = data.match(/^cfg:feat:toggle:(.+)$/);
			if (featToggle) return await toggleFeature(ctx, chatId, featToggle[1]);

			const calsOpen = data.match(/^cfg:cals:(.+)$/);
			if (calsOpen) {
				await showCalendars(ctx, chatId, calsOpen[1]);
				await ctx.answerCallbackQuery();
				return;
			}

			const calTog = data.match(/^cfg:cal:tog:([^:]+):(.+)$/);
			if (calTog) return await toggleCuratedCalendar(ctx, chatId, calTog[1], calTog[2]);

			const calExtAdd = data.match(/^cfg:cal:ext_add:(.+)$/);
			if (calExtAdd) {
				return await promptAddExternalCalendar(
					ctx,
					chatId,
					String(ctx.from?.id ?? ""),
					calExtAdd[1],
				);
			}

			const calExtRm = data.match(/^cfg:cal:ext_rm:([^:]+):(\d+)$/);
			if (calExtRm) {
				return await removeExternalCalendar(ctx, chatId, calExtRm[1], Number(calExtRm[2]));
			}

			const welcomeOpen = data.match(/^cfg:welcome:(.+)$/);
			if (welcomeOpen) {
				await showWelcome(ctx, chatId, welcomeOpen[1]);
				await ctx.answerCallbackQuery();
				return;
			}
			const welcomeEdit = data.match(/^cfg:welcome_edit:(.+)$/);
			if (welcomeEdit) {
				return await promptEditWelcome(
					ctx,
					chatId,
					String(ctx.from?.id ?? ""),
					welcomeEdit[1],
				);
			}
			const welcomeReset = data.match(/^cfg:welcome_reset:(.+)$/);
			if (welcomeReset) return await resetWelcome(ctx, chatId, welcomeReset[1]);

			// Periodic broadcast sub-menu (meetups-only for now).
			// Note: prefix matches must go in most-specific-first order because
			// `cfg:per:...` also matches `cfg:per:tog:...`, etc.
			const perTog = data.match(/^cfg:per:tog:(.+)$/);
			if (perTog) return await toggleEnabled(ctx, chatId, perTog[1]);

			const perDay = data.match(/^cfg:per:day:([^:]+):(\d+)$/);
			if (perDay) return await setDay(ctx, chatId, perDay[1], Number(perDay[2]));

			const perHour = data.match(/^cfg:per:hour:([^:]+):(\d+)$/);
			if (perHour) return await setHour(ctx, chatId, perHour[1], Number(perHour[2]));

			const perRange = data.match(/^cfg:per:range:([^:]+):([a-z0-9]+)$/);
			if (perRange) return await setRange(ctx, chatId, perRange[1], perRange[2]);

			const perTz = data.match(/^cfg:per:tz:(.+)$/);
			if (perTz) {
				return await promptEditTimezone(
					ctx,
					chatId,
					String(ctx.from?.id ?? ""),
					perTz[1],
				);
			}

			const perPin = data.match(/^cfg:per:pin:(.+)$/);
			if (perPin) return await togglePin(ctx, chatId, perPin[1]);

			const perUnpin = data.match(/^cfg:per:unpin:(.+)$/);
			if (perUnpin) return await toggleUnpinPrevious(ctx, chatId, perUnpin[1]);

			const perPreview = data.match(/^cfg:per:preview:(.+)$/);
			if (perPreview) return await triggerPreview(ctx, chatId, perPreview[1]);

			const perReset = data.match(/^cfg:per:reset:(.+)$/);
			if (perReset) return await resetPeriodic(ctx, chatId, perReset[1]);

			const perOpen = data.match(/^cfg:per:(.+)$/);
			if (perOpen) {
				await showPeriodic(ctx, chatId, perOpen[1]);
				await ctx.answerCallbackQuery();
				return;
			}

			await ctx.answerCallbackQuery({ text: t("config_ui.toast.unknown_action") });
		} catch (err) {
			log.error("config_ui.error", { error: (err as Error).message, data });
			await ctx.answerCallbackQuery({ text: t("config_ui.toast.error") });
		}
	});
}

/**
 * Called from the router's message-text handler before dispatching to services.
 * Returns true if the message was consumed as /config input.
 */
export async function routeConfigTextInput(ctx: Context): Promise<boolean> {
	const chatId = String(ctx.chat?.id ?? "");
	const userId = String(ctx.from?.id ?? "");
	if (!chatId || !userId) return false;
	const pending = getPendingInput(chatId, userId);
	if (!pending) return false;

	const text = ctx.message?.text ?? "";
	if (text === "/cancel" || text.startsWith("/cancel ")) {
		clearPendingInput(chatId, userId);
		await ctx.reply(t("config_ui.toast.cancelled"));
		return true;
	}

	// Any other slash command means the user wants to do something else —
	// drop the pending input so they aren't stuck in the flow, and let the
	// command fall through to the router for normal dispatch.
	if (text.startsWith("/")) {
		clearPendingInput(chatId, userId);
		return false;
	}

	if (pending.kind === "await_external_calendar_uri") {
		await handleExternalCalendarInput(ctx, chatId, userId, text, pending.featureId);
		return true;
	}
	if (pending.kind === "await_welcome_message") {
		await handleWelcomeInput(ctx, chatId, userId, text, pending.featureId);
		return true;
	}
	if (pending.kind === "await_periodic_timezone") {
		await handleTimezoneInput(ctx, chatId, userId, text, pending.featureId);
		return true;
	}
	return false;
}

export { sendMainMenu };
