// src/middleware/config_ui/welcome.ts
// The "Welcome message" view: edit or reset the new_member welcome text for
// this chat.

import type { Context } from "grammy";
import { getOperatorConfig } from "@core/config/runtime.ts";
import { getChatFeatureOverride, setChatFeatureOverride } from "@core/config/store.ts";
import { clearPendingInput, setPendingInput } from "@middleware/config_ui/state.ts";
import { t } from "@core/i18n/mod.ts";
import type { InlineKeyboard } from "@middleware/config_ui/types.ts";

function currentWelcome(chatId: string, featureId: string): {
	effective: string;
	isOverride: boolean;
	defaultMessage: string;
} {
	const operator = getOperatorConfig();
	const feature = operator.features[featureId];
	const defaultMessage = (feature?.config?.message as string) ?? "";
	const override = getChatFeatureOverride(chatId, featureId);
	const custom = override?.data?.welcome_override;
	if (typeof custom === "string" && custom.length > 0) {
		return { effective: custom, isOverride: true, defaultMessage };
	}
	return { effective: defaultMessage, isOverride: false, defaultMessage };
}

export function welcomeText(chatId: string, featureId: string): string {
	const { effective, isOverride, defaultMessage } = currentWelcome(chatId, featureId);
	const state = isOverride
		? t("config_ui.welcome.status_custom")
		: t("config_ui.welcome.status_default");
	const statusLine = t("config_ui.welcome.status_line", { state });
	const body = isOverride
		? t("config_ui.welcome.body_custom", { defaultMessage: escapeHtml(defaultMessage) })
		: t("config_ui.welcome.body_default");
	return `${t("config_ui.welcome.title")}\n\n${statusLine}\n\n<pre>${
		escapeHtml(effective)
	}</pre>\n\n${body}`;
}

export function welcomeKeyboard(
	chatId: string,
	featureId: string,
): InlineKeyboard {
	const { isOverride } = currentWelcome(chatId, featureId);
	const rows: InlineKeyboard = [
		[{ text: t("config_ui.welcome.edit_button"), callback_data: `cfg:welcome_edit:${featureId}` }],
	];
	if (isOverride) {
		rows.push([{
			text: t("config_ui.welcome.reset_button"),
			callback_data: `cfg:welcome_reset:${featureId}`,
		}]);
	}
	rows.push([{ text: t("config_ui.common.back"), callback_data: "cfg:main" }]);
	return rows;
}

export async function showWelcome(
	ctx: Context,
	chatId: string,
	featureId: string,
): Promise<void> {
	try {
		await ctx.editMessageText(welcomeText(chatId, featureId), {
			parse_mode: "HTML",
			reply_markup: { inline_keyboard: welcomeKeyboard(chatId, featureId) },
		});
	} catch {
		// ignore
	}
}

export async function promptEditWelcome(
	ctx: Context,
	chatId: string,
	userId: string,
	featureId: string,
): Promise<void> {
	const menuMessageId = ctx.callbackQuery?.message?.message_id;
	setPendingInput(chatId, userId, {
		kind: "await_welcome_message",
		chatId,
		featureId,
		menuMessageId,
	});
	await ctx.answerCallbackQuery();
	await ctx.reply(t("config_ui.welcome.prompt_html"), { parse_mode: "HTML" });
}

export async function resetWelcome(
	ctx: Context,
	chatId: string,
	featureId: string,
): Promise<void> {
	setChatFeatureOverride(chatId, featureId, {
		data: { welcome_override: undefined },
	});
	await showWelcome(ctx, chatId, featureId);
	await ctx.answerCallbackQuery({ text: t("config_ui.welcome.reset_toast") });
}

export async function handleWelcomeInput(
	ctx: Context,
	chatId: string,
	userId: string,
	text: string,
	featureId: string,
): Promise<void> {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		await ctx.reply(t("config_ui.welcome.empty"));
		return;
	}
	if (trimmed.length > 2000) {
		await ctx.reply(t("config_ui.welcome.too_long", { max: 2000, length: trimmed.length }));
		return;
	}
	setChatFeatureOverride(chatId, featureId, {
		data: { welcome_override: trimmed },
	});
	clearPendingInput(chatId, userId);
	await ctx.reply(t("config_ui.welcome.updated"));
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}
