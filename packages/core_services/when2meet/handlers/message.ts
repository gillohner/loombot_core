// packages/core_services/when2meet/handlers/message.ts
// Routes text input to the right phase of the organizer flow. Each picker
// phase has a corresponding typed-fallback handler so the flow still works
// if the user types instead of tapping a button.

import { type MessageEvent, reply, state } from "@sdk/mod.ts";
import type { When2meetState } from "../types.ts";
import {
	handleDateText,
	handleDurationText,
	handleEndDateText,
	handleEndTimeText,
	handleTimeText,
	handleTitleInput,
	showReviewMenu,
} from "../flows/propose.ts";
import { DEFAULT_COMMAND } from "../constants.ts";
import { tev } from "../utils/i18n.ts";

export function handleMessage(ev: MessageEvent) {
	const st = (ev.state ?? {}) as When2meetState;
	const text = (ev.message as { text?: string })?.text ?? "";

	switch (st.phase) {
		case "title":
			return handleTitleInput(text, st, ev);
		case "slot_date_pick":
			return handleDateText(text, st, ev);
		case "slot_time_pick":
			return handleTimeText(text, st, ev);
		case "slot_duration_pick":
			return handleDurationText(text, st, ev);
		case "slot_end_date_text":
			return handleEndDateText(text, st, ev);
		case "slot_end_time_text":
			return handleEndTimeText(text, st, ev);
		case "review":
			return showReviewMenu(st, ev);
		default:
			return reply(tev(ev, "menu.start_first", { command: DEFAULT_COMMAND }), {
				state: state.clear(),
			});
	}
}
