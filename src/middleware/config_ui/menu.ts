// src/middleware/config_ui/menu.ts
// Renders the top-level /config menu and handles its callbacks.

import type { Context } from "grammy";
import { getOperatorConfig } from "@core/config/runtime.ts";
import { resolveChatConfig } from "@core/config/merge.ts";
import { t } from "@core/i18n/mod.ts";
import type { InlineKeyboard } from "@middleware/config_ui/types.ts";

export function mainMenuText(): string {
	return t("config_ui.menu.title");
}

export function mainMenuKeyboard(chatId: string, chatType?: string): InlineKeyboard {
	const operator = getOperatorConfig();
	const resolved = resolveChatConfig(chatId, { chatType, operatorConfig: operator });
	const rows: InlineKeyboard = [];

	// Features section (always shown)
	rows.push([{ text: t("config_ui.menu.button_features"), callback_data: "cfg:feats" }]);

	// Calendars + Periodic broadcast — only if there's at least one meetups feature.
	const meetups = resolved.features.find((f) => f.service === "meetups");
	if (meetups) {
		rows.push([
			{
				text: t("config_ui.menu.button_calendars"),
				callback_data: `cfg:cals:${meetups.featureId}`,
			},
		]);
		rows.push([
			{
				text: t("config_ui.menu.button_periodic"),
				callback_data: `cfg:per:${meetups.featureId}`,
			},
		]);
	}

	// Welcome message — only if there's a new_member feature
	const newMember = resolved.features.find((f) => f.service === "new_member");
	if (newMember) {
		rows.push([
			{
				text: t("config_ui.menu.button_welcome"),
				callback_data: `cfg:welcome:${newMember.featureId}`,
			},
		]);
	}

	rows.push([{ text: t("config_ui.common.close"), callback_data: "cfg:close" }]);
	return rows;
}

export async function sendMainMenu(ctx: Context, chatId: string): Promise<void> {
	await ctx.reply(mainMenuText(), {
		parse_mode: "HTML",
		reply_markup: { inline_keyboard: mainMenuKeyboard(chatId, ctx.chat?.type) },
	});
}

export async function editToMainMenu(ctx: Context, chatId: string): Promise<void> {
	try {
		await ctx.editMessageText(mainMenuText(), {
			parse_mode: "HTML",
			reply_markup: { inline_keyboard: mainMenuKeyboard(chatId, ctx.chat?.type) },
		});
	} catch {
		// ignore edit failures (message too old, not found, etc.)
	}
}
