// packages/core_services/event-creator/flows/required.ts
// Required field collection flow (title, date, time)

import { type MessageEvent, reply, state } from "@sdk/mod.ts";
import { REQ_STEP_DATE, REQ_STEP_TIME, REQ_STEP_TITLE } from "../constants.ts";
import type { EventCreatorState } from "../types.ts";
import { escapeHtml } from "../utils/formatting.ts";
import { normalizeDate, validateDate, validateTime, validateTitle } from "../utils/validation.ts";
import { tev } from "../utils/i18n.ts";
import { showOptionalMenu } from "./optional_menu.ts";

export function handleRequiredFieldInput(ev: MessageEvent) {
	const st = (ev.state ?? {}) as EventCreatorState;
	const text = (ev.message as { text?: string })?.text?.trim() ?? "";
	const step = st.requirementStep ?? REQ_STEP_TITLE;

	switch (step) {
		case REQ_STEP_TITLE:
			return handleTitleInput(text, st, ev);

		case REQ_STEP_DATE:
			return handleDateInput(text, st, ev);

		case REQ_STEP_TIME:
			return handleTimeInput(text, st, ev);

		default:
			return reply(tev(ev, "required.something_wrong"), {
				state: state.clear(),
			});
	}
}

function handleTitleInput(text: string, st: EventCreatorState, ev: MessageEvent) {
	const validation = validateTitle(text, ev.language);
	if (!validation.valid) {
		return reply(validation.error!);
	}

	// Seeded from when2meet: startDate + startTime are already populated
	// (and optionally endDate/endTime). After accepting the title, skip the
	// date/time prompts and jump straight to the optional menu.
	if (st.startDate && st.startTime) {
		const updated: EventCreatorState = {
			...st,
			title: text,
			phase: "optional_menu",
			requirementStep: undefined,
		};
		return showOptionalMenu(updated, ev);
	}

	return reply(
		tev(ev, "required.title_ok", { title: escapeHtml(text) }) +
			"\n\n" +
			tev(ev, "required.step_date") +
			"\n\n" +
			tev(ev, "required.step_date_example"),
		{
			state: state.merge({
				requirementStep: REQ_STEP_DATE,
				title: text,
			}),
			options: { parse_mode: "HTML" },
		},
	);
}

function handleDateInput(text: string, _st: EventCreatorState, ev: MessageEvent) {
	const validation = validateDate(text, ev.language);
	if (!validation.valid) {
		return reply(validation.error!);
	}

	const normalized = normalizeDate(text) ?? text;

	return reply(
		tev(ev, "required.date_ok", { date: escapeHtml(normalized) }) +
			"\n\n" +
			tev(ev, "required.step_time") +
			"\n\n" +
			tev(ev, "required.step_time_example"),
		{
			state: state.merge({
				requirementStep: REQ_STEP_TIME,
				startDate: normalized,
			}),
			options: { parse_mode: "HTML" },
		},
	);
}

function handleTimeInput(text: string, st: EventCreatorState, ev: MessageEvent) {
	const validation = validateTime(text, ev.language);
	if (!validation.valid) {
		return reply(validation.error!);
	}

	// Required fields complete - transition to optional menu
	const updatedState: EventCreatorState = {
		...st,
		startTime: text,
		phase: "optional_menu",
		requirementStep: undefined,
	};

	return showOptionalMenu(updatedState, ev);
}
