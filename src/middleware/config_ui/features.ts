// src/middleware/config_ui/features.ts
// The "Features" view: one button per toggleable feature. Tapping flips the
// per-chat enabled override.

import type { Context } from "grammy";
import { getOperatorConfig } from "@core/config/runtime.ts";
import { resolveChatConfig, type ResolvedFeature } from "@core/config/merge.ts";
import { setChatFeatureOverride } from "@core/config/store.ts";
import { t } from "@core/i18n/mod.ts";
import type { InlineKeyboard } from "@middleware/config_ui/types.ts";

function prettyLabel(feature: ResolvedFeature): string {
	const check = feature.enabled ? "✅" : "❌";
	// Use featureId as the human label; operators can pick readable ids in config.yaml.
	const kindSuffix = feature.kind === "listener" ? "" : ` (/${feature.command})`;
	return `${check} ${feature.featureId}${kindSuffix}`;
}

export function featuresKeyboard(chatId: string, chatType?: string): InlineKeyboard {
	const resolved = resolveChatConfig(chatId, {
		chatType,
		operatorConfig: getOperatorConfig(),
	});
	const rows: InlineKeyboard = [];
	for (const feature of resolved.features) {
		if (feature.lock) continue;
		rows.push([
			{
				text: prettyLabel(feature),
				callback_data: `cfg:feat:toggle:${feature.featureId}`,
			},
		]);
	}
	if (rows.length === 0) {
		rows.push([{ text: t("config_ui.features.empty"), callback_data: "cfg:feats" }]);
	}
	rows.push([{ text: t("config_ui.common.back"), callback_data: "cfg:main" }]);
	return rows;
}

export function featuresText(): string {
	return t("config_ui.features.title");
}

export async function showFeatures(ctx: Context, chatId: string): Promise<void> {
	try {
		await ctx.editMessageText(featuresText(), {
			parse_mode: "HTML",
			reply_markup: { inline_keyboard: featuresKeyboard(chatId, ctx.chat?.type) },
		});
	} catch {
		// ignore
	}
}

export async function toggleFeature(
	ctx: Context,
	chatId: string,
	featureId: string,
): Promise<void> {
	const resolved = resolveChatConfig(chatId, {
		chatType: ctx.chat?.type,
		operatorConfig: getOperatorConfig(),
	});
	const feature = resolved.features.find((f) => f.featureId === featureId);
	if (!feature || feature.lock) {
		await ctx.answerCallbackQuery({
			text: t("config_ui.features.locked_by_operator"),
			show_alert: false,
		});
		return;
	}
	setChatFeatureOverride(chatId, featureId, { enabled: !feature.enabled });
	await showFeatures(ctx, chatId);
	await ctx.answerCallbackQuery({
		text: !feature.enabled
			? t("config_ui.features.toggle_enabled", { featureId })
			: t("config_ui.features.toggle_disabled", { featureId }),
	});
}
