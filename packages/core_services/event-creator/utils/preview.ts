// packages/core_services/event-creator/utils/preview.ts
// Preview generation for admin approval

import type { PubkyAppEvent } from "@eventky/mod.ts";
import type { EventCreatorConfig, EventCreatorState } from "../types.ts";
import { escapeHtml, truncate } from "./formatting.ts";
import { getAllCalendarUris, getCalendarName } from "./calendar.ts";
import { tfor } from "./i18n.ts";

/**
 * Build admin preview message for approval flow.
 * Admin-facing; localized to the operator language.
 */
export function buildAdminPreview(
	event: PubkyAppEvent,
	state: EventCreatorState,
	config: EventCreatorConfig,
	locale?: string,
): string {
	const t = tfor(locale);
	const lines: string[] = [
		`📅 *${event.summary}*`,
	];

	if (event.description) {
		lines.push(`\n${truncate(event.description, 200)}`);
	}

	lines.push(`\n📆 ${state.startDate} at ${state.startTime}`);

	if (state.endDate && state.endTime) {
		lines.push(t("preview.until", { date: state.endDate, time: state.endTime }));
	}

	if (event.dtstart_tzid) {
		lines.push(`🌍 ${event.dtstart_tzid}`);
	}

	if (state.location?.name) {
		const icon = state.location.location_type === "ONLINE" ? "💻" : "📍";
		lines.push(`${icon} ${state.location.name}`);
		if (state.location.structured_data) {
			lines.push(`   🔗 ${state.location.structured_data}`);
		}
	}

	if (state.imageFileId) {
		lines.push(t("preview.image_included"));
	}

	// Calendar list
	const calendars = getAllCalendarUris(state, config);
	if (calendars.length > 0) {
		lines.push(`\n${t("preview.calendars_header")}`);
		for (const uri of calendars) {
			const name = getCalendarName(uri, config);
			lines.push(`  • ${name}`);
		}
	}

	return lines.join("\n");
}

/**
 * Build event summary for optional menu display
 */
export function buildEventSummary(
	state: EventCreatorState,
	config: EventCreatorConfig,
	locale?: string,
): string {
	const t = tfor(locale);
	const req = (field: string) => {
		const map: Record<string, keyof EventCreatorConfig> = {
			location: "requireLocation",
			image: "requireImage",
			endTime: "requireEndTime",
		};
		const key = map[field];
		return key && config[key] ? " ❗" : "";
	};

	const lines: string[] = [
		t("menu.header"),
		"",
		t("menu.label_title", { value: escapeHtml(state.title || "") }),
		t("menu.label_date", { value: escapeHtml(state.startDate || "") }),
		t("menu.label_time", { value: escapeHtml(state.startTime || "") }),
	];

	// Optional fields
	if (state.description) {
		lines.push(
			t("menu.label_description", { value: escapeHtml(truncate(state.description, 100)) }),
		);
	} else {
		lines.push(t("menu.label_description_empty"));
	}

	if (state.endDate && state.endTime) {
		lines.push(t("menu.label_end_with", {
			required: req("endTime"),
			date: escapeHtml(state.endDate),
			time: escapeHtml(state.endTime),
		}));
	} else {
		lines.push(t("menu.label_end_empty", { required: req("endTime") }));
	}

	if (state.location?.name) {
		const isOnline = state.location.location_type === "ONLINE";
		const locText = isOnline
			? state.location.structured_data || state.location.name
			: truncate(state.location.name, 50);
		const key = isOnline ? "menu.label_location_online" : "menu.label_location_physical";
		lines.push(t(key, { required: req("location"), value: escapeHtml(locText) }));
	} else {
		lines.push(t("menu.label_location_empty", { required: req("location") }));
	}

	if (state.imageFileId) {
		lines.push(t("menu.label_image_attached", { required: req("image") }));
	} else {
		lines.push(t("menu.label_image_empty", { required: req("image") }));
	}

	// Calendar status
	const calendars = getAllCalendarUris(state, config);
	if (calendars.length > 0) {
		const calNames = calendars.map((uri) => escapeHtml(getCalendarName(uri, config)));
		lines.push("");
		lines.push(t("menu.label_calendars", { list: calNames.join(", ") }));
	}

	return lines.join("\n");
}
