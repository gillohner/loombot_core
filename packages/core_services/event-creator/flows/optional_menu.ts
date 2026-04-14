// packages/core_services/event-creator/flows/optional_menu.ts
// Optional menu display and field addition handlers

import {
	type CallbackEvent,
	type MessageEvent,
	reply,
	state,
	UIBuilder,
	uiKeyboard,
} from "@sdk/mod.ts";
import { MENU_REPLACE_GROUP, SERVICE_ID } from "../constants.ts";
import type { EventCreatorConfig, EventCreatorState } from "../types.ts";
import { isCalendarSelectionEnabled } from "../utils/calendar.ts";
import { escapeHtml } from "../utils/formatting.ts";
import { buildEventSummary } from "../utils/preview.ts";
import { tev, tfor } from "../utils/i18n.ts";
import {
	normalizeDate,
	parseDateParts,
	validateDate,
	validateDescription,
	validateEndTime,
	validateLocationName,
	validateTime,
} from "../utils/validation.ts";
import {
	handleLocationSearchInput,
	handleOnlineUrlInput,
	showLocationTypeMenu,
} from "./location.ts";

export function showOptionalMenu(
	st: EventCreatorState,
	ev: CallbackEvent | MessageEvent,
	extraOpts?: Record<string, unknown>,
) {
	const config = (ev.serviceConfig ?? {}) as EventCreatorConfig;
	const t = tfor(ev.language);

	const reqMark = (field: string) => {
		const map: Record<string, keyof typeof config> = {
			location: "requireLocation",
			image: "requireImage",
			endtime: "requireEndTime",
		};
		const key = map[field];
		return key && config[key] ? " ❗" : "";
	};

	const keyboard = UIBuilder.keyboard()
		.namespace(SERVICE_ID)
		.callback(t("menu.button_description"), "menu:description")
		.row()
		.callback(t("menu.button_image", { required: reqMark("image") }), "menu:image")
		.row()
		.callback(t("menu.button_location", { required: reqMark("location") }), "menu:location")
		.row()
		.callback(t("menu.button_endtime", { required: reqMark("endtime") }), "menu:endtime")
		.row();

	// Show calendar selector only if multiple calendars configured
	if (isCalendarSelectionEnabled(config)) {
		keyboard.callback(t("menu.button_calendars"), "menu:calendars").row();
	}

	keyboard
		.callback(t("menu.button_edit"), "menu:edit")
		.row()
		.callback(t("menu.button_submit"), "menu:submit", "primary")
		.callback(t("menu.button_cancel"), "menu:cancel", "danger");

	const summary = buildEventSummary(st, config, ev.language);
	const message = `${summary}\n\n${t("menu.what_next")}`;

	return uiKeyboard(keyboard.build(), message, {
		state: state.replace(st),
		options: { ...extraOpts, replaceGroup: MENU_REPLACE_GROUP },
	});
}

export function handleOptionalMenuAction(
	ev: CallbackEvent | MessageEvent,
	action: string,
) {
	const st = (ev.state ?? {}) as EventCreatorState;

	switch (action) {
		case "description":
			return reply(
				tev(ev, "optional.description_title") + "\n\n" + tev(ev, "optional.description_prompt"),
				{
					state: state.merge({ waitingFor: "description" }),
					options: { parse_mode: "HTML", cleanupGroup: MENU_REPLACE_GROUP },
				},
			);

		case "image":
			return reply(
				tev(ev, "optional.image_title") + "\n\n" + tev(ev, "optional.image_prompt"),
				{
					state: state.merge({ waitingFor: "image" }),
					options: { parse_mode: "HTML", cleanupGroup: MENU_REPLACE_GROUP },
				},
			);

		case "location":
			return showLocationTypeMenu(st, ev);

		case "endtime":
			return reply(
				tev(ev, "optional.endtime_title") + "\n\n" + tev(ev, "optional.endtime_prompt"),
				{
					state: state.merge({ waitingFor: "endDate" }),
					options: { parse_mode: "HTML", cleanupGroup: MENU_REPLACE_GROUP },
				},
			);

		case "back":
			// Return to menu
			return showOptionalMenu(st, ev);

		default:
			return showOptionalMenu(st, ev);
	}
}

export function handleOptionalFieldInput(ev: MessageEvent) {
	const st = (ev.state ?? {}) as EventCreatorState;
	const message = ev.message as Record<string, unknown>;
	const text = (message.text as string)?.trim() ?? "";
	const waitingFor = (st as Record<string, unknown>).waitingFor as string | undefined;

	// Handle photo/document uploads
	if (waitingFor === "image") {
		let fileId: string | undefined;

		if (message.photo) {
			// Compressed image sent as photo
			const photos = message.photo as Array<{ file_id: string }>;
			fileId = photos[photos.length - 1]?.file_id;
		} else if (message.document) {
			// Uncompressed image sent as document/file
			const doc = message.document as { file_id: string; mime_type?: string };
			if (doc.mime_type?.startsWith("image/")) {
				fileId = doc.file_id;
			}
		}

		if (fileId) {
			const updatedState = {
				...st,
				imageFileId: fileId,
				waitingFor: undefined,
			};
			delete (updatedState as Record<string, unknown>).waitingFor;
			return showOptionalMenu(updatedState, ev);
		}

		// If document is not an image, tell the user
		if (message.document) {
			return reply(tev(ev, "optional.not_image"));
		}
	}

	// Handle text input
	if (!waitingFor) {
		return showOptionalMenu(st, ev);
	}

	if (text.toLowerCase() === "skip") {
		const cleaned = { ...st };
		delete (cleaned as Record<string, unknown>).waitingFor;
		return showOptionalMenu(cleaned, ev);
	}

	switch (waitingFor) {
		case "description":
			return handleDescriptionInput(text, st, ev);

		case "location":
			return handleLocationInput(text, st, ev);

		case "location_search":
			return handleLocationSearchInput(text, st, ev);

		case "location_online_url":
			return handleOnlineUrlInput(text, st, ev);

		case "endDate":
			return handleEndDateInput(text, st, ev);

		case "endTime":
			return handleEndTimeInput(text, st, ev);

		default:
			return showOptionalMenu(st, ev);
	}
}

function handleDescriptionInput(text: string, st: EventCreatorState, ev: MessageEvent) {
	const validation = validateDescription(text, ev.language);
	if (!validation.valid) {
		return reply(validation.error!);
	}

	const updatedState = {
		...st,
		description: text,
	};
	delete (updatedState as Record<string, unknown>).waitingFor;

	return showOptionalMenu(updatedState, ev);
}

function handleLocationInput(text: string, st: EventCreatorState, ev: MessageEvent) {
	const validation = validateLocationName(text, ev.language);
	if (!validation.valid) {
		return reply(validation.error!);
	}

	const updatedState = {
		...st,
		location: { name: text },
	};
	delete (updatedState as Record<string, unknown>).waitingFor;

	return showOptionalMenu(updatedState, ev);
}

function handleEndDateInput(text: string, st: EventCreatorState, ev: MessageEvent) {
	const validation = validateDate(text, ev.language);
	if (!validation.valid) {
		return reply(validation.error!);
	}

	const normalized = normalizeDate(text) ?? text;

	// Validate end date is not before start date
	if (st.startDate) {
		const startParts = parseDateParts(st.startDate);
		const endParts = parseDateParts(normalized);
		if (startParts && endParts) {
			const startVal = startParts.year * 10000 + startParts.month * 100 + startParts.day;
			const endVal = endParts.year * 10000 + endParts.month * 100 + endParts.day;
			if (endVal < startVal) {
				return reply(
					tev(ev, "optional.end_before_start", { end: normalized, start: st.startDate }) +
						"\n\n" +
						tev(ev, "optional.end_before_start_hint"),
				);
			}
		}
	}

	return reply(
		tev(ev, "optional.end_date_ok", { date: escapeHtml(normalized) }) +
			"\n\n" +
			tev(ev, "optional.end_time_prompt"),
		{
			state: state.merge({
				endDate: normalized,
				waitingFor: "endTime",
			}),
			options: { parse_mode: "HTML" },
		},
	);
}

function handleEndTimeInput(text: string, st: EventCreatorState, ev: MessageEvent) {
	const timeValidation = validateTime(text, ev.language);
	if (!timeValidation.valid) {
		return reply(timeValidation.error!);
	}

	// Validate end is after start
	const endValidation = validateEndTime(
		st.startDate!,
		st.startTime!,
		st.endDate!,
		text,
		ev.language,
	);
	if (!endValidation.valid) {
		return reply(endValidation.error!);
	}

	const updatedState = {
		...st,
		endTime: text,
	};
	delete (updatedState as Record<string, unknown>).waitingFor;

	return showOptionalMenu(updatedState, ev);
}
