// src/middleware/config_ui/calendars.ts
// The "Calendars" view: pick which meetups calendars are shown in this chat.
// Chat admins can toggle any of the operator-curated calendars and, if the
// operator allowed it, add a freeform external URI.

import type { Context } from "grammy";
import { getOperatorConfig } from "@core/config/runtime.ts";
import { getChatFeatureOverride, setChatFeatureOverride } from "@core/config/store.ts";
import { fetchCalendarMeta, isValidCalendarUri } from "@core/pubky/calendar_meta.ts";
import { clearPendingInput, setPendingInput } from "@middleware/config_ui/state.ts";
import { t } from "@core/i18n/mod.ts";
import type { InlineKeyboard } from "@middleware/config_ui/types.ts";

interface CuratedCalendar {
	id: string;
	name: string;
	uri: string;
}

function getCuratedCalendars(featureId: string): {
	feature: { allow_external: boolean; calendars: CuratedCalendar[] };
} | undefined {
	const operator = getOperatorConfig();
	const feature = operator.features[featureId];
	if (!feature || feature.service !== "meetups") return undefined;
	const raw = feature.config.calendars as CuratedCalendar[] | undefined;
	return {
		feature: {
			allow_external: feature.allow_external_calendars === true,
			calendars: Array.isArray(raw) ? raw : [],
		},
	};
}

function getSelection(chatId: string, featureId: string): {
	selected: Set<string>;
	external: string[];
	usingDefaults: boolean;
} {
	const override = getChatFeatureOverride(chatId, featureId);
	const data = override?.data ?? {};
	const selectedIds = Array.isArray(data.selected_calendar_ids)
		? data.selected_calendar_ids as string[]
		: undefined;
	const external = Array.isArray(data.external_calendars)
		? (data.external_calendars as string[])
		: [];
	return {
		selected: new Set(selectedIds ?? []),
		external,
		usingDefaults: selectedIds === undefined,
	};
}

export function calendarsText(featureId: string): string {
	return t("config_ui.calendars.title", { featureId });
}

export function calendarsKeyboard(
	chatId: string,
	featureId: string,
): InlineKeyboard {
	const curated = getCuratedCalendars(featureId);
	if (!curated) return [[{ text: t("config_ui.common.back"), callback_data: "cfg:main" }]];

	const { selected, external, usingDefaults } = getSelection(chatId, featureId);
	const rows: InlineKeyboard = [];

	for (const cal of curated.feature.calendars) {
		// When "usingDefaults" is true (no selection row yet), assume all curated are on.
		const on = usingDefaults || selected.has(cal.id);
		rows.push([{
			text: `${on ? "✅" : "❌"} ${cal.name}`,
			callback_data: `cfg:cal:tog:${featureId}:${cal.id}`,
		}]);
	}

	const extPrefix = t("config_ui.calendars.external_prefix");
	external.forEach((uri, idx) => {
		// Truncate for display.
		const display = uri.length > 40 ? uri.slice(0, 20) + "…" + uri.slice(-15) : uri;
		rows.push([{
			text: `✅ ${extPrefix} ${display}`,
			callback_data: `cfg:cal:ext_rm:${featureId}:${idx}`,
		}]);
	});

	if (curated.feature.allow_external) {
		rows.push([{
			text: t("config_ui.calendars.add_external"),
			callback_data: `cfg:cal:ext_add:${featureId}`,
		}]);
	}

	rows.push([{ text: t("config_ui.common.back"), callback_data: "cfg:main" }]);
	return rows;
}

export async function showCalendars(
	ctx: Context,
	chatId: string,
	featureId: string,
): Promise<void> {
	try {
		await ctx.editMessageText(calendarsText(featureId), {
			parse_mode: "HTML",
			reply_markup: { inline_keyboard: calendarsKeyboard(chatId, featureId) },
		});
	} catch {
		// ignore
	}
}

export async function toggleCuratedCalendar(
	ctx: Context,
	chatId: string,
	featureId: string,
	calendarId: string,
): Promise<void> {
	const curated = getCuratedCalendars(featureId);
	if (!curated) return;
	const { selected, usingDefaults, external } = getSelection(chatId, featureId);

	// First toggle: seed selected with all curated ids so `usingDefaults` becomes explicit.
	if (usingDefaults) {
		for (const cal of curated.feature.calendars) selected.add(cal.id);
	}
	if (selected.has(calendarId)) selected.delete(calendarId);
	else selected.add(calendarId);

	setChatFeatureOverride(chatId, featureId, {
		data: {
			selected_calendar_ids: Array.from(selected),
			external_calendars: external,
		},
	});
	await showCalendars(ctx, chatId, featureId);
	await ctx.answerCallbackQuery();
}

export async function removeExternalCalendar(
	ctx: Context,
	chatId: string,
	featureId: string,
	index: number,
): Promise<void> {
	const { selected, external, usingDefaults } = getSelection(chatId, featureId);
	const next = external.filter((_, i) => i !== index);
	setChatFeatureOverride(chatId, featureId, {
		data: {
			selected_calendar_ids: usingDefaults ? undefined : Array.from(selected),
			external_calendars: next,
		},
	});
	await showCalendars(ctx, chatId, featureId);
	await ctx.answerCallbackQuery({ text: t("config_ui.calendars.removed_toast") });
}

export async function promptAddExternalCalendar(
	ctx: Context,
	chatId: string,
	userId: string,
	featureId: string,
): Promise<void> {
	const curated = getCuratedCalendars(featureId);
	if (!curated?.feature.allow_external) {
		await ctx.answerCallbackQuery({ text: t("config_ui.calendars.not_allowed_toast") });
		return;
	}
	const menuMessageId = ctx.callbackQuery?.message?.message_id;
	setPendingInput(chatId, userId, {
		kind: "await_external_calendar_uri",
		chatId,
		featureId,
		menuMessageId,
	});
	await ctx.answerCallbackQuery();
	await ctx.reply(t("config_ui.calendars.prompt_html"), { parse_mode: "HTML" });
}

// Called from the text handler in router.ts when a user has a pending input.
export async function handleExternalCalendarInput(
	ctx: Context,
	chatId: string,
	userId: string,
	text: string,
	featureId: string,
): Promise<void> {
	const trimmed = text.trim();
	if (!isValidCalendarUri(trimmed)) {
		await ctx.reply(t("config_ui.calendars.invalid_uri_html"), { parse_mode: "HTML" });
		return;
	}

	const meta = await fetchCalendarMeta(trimmed);
	if (!meta) {
		await ctx.reply(t("config_ui.calendars.fetch_failed"));
		return;
	}

	const { selected, external, usingDefaults } = getSelection(chatId, featureId);
	if (external.includes(meta.uri)) {
		await ctx.reply(t("config_ui.calendars.already_added"));
		clearPendingInput(chatId, userId);
		return;
	}
	setChatFeatureOverride(chatId, featureId, {
		data: {
			selected_calendar_ids: usingDefaults ? undefined : Array.from(selected),
			external_calendars: [...external, meta.uri],
		},
	});
	clearPendingInput(chatId, userId);
	const label = meta.name
		? t("config_ui.calendars.label_named", { name: meta.name })
		: t("config_ui.calendars.label_unnamed");
	await ctx.reply(t("config_ui.calendars.added_toast", { label }), { parse_mode: "HTML" });
}
