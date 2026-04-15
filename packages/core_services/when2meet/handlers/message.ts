// packages/core_services/when2meet/handlers/message.ts
// Routes text input to the right phase of the organizer flow.

import { type MessageEvent, reply, state } from "@sdk/mod.ts";
import type { When2meetState } from "../types.ts";
import {
	handleSlotEndDate,
	handleSlotEndTime,
	handleSlotStartDate,
	handleSlotStartTime,
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
		case "slot_start_date":
			return handleSlotStartDate(text, st, ev);
		case "slot_start_time":
			return handleSlotStartTime(text, st, ev);
		case "slot_end_date":
			return handleSlotEndDate(text, st, ev);
		case "slot_end_time":
			return handleSlotEndTime(text, st, ev);
		case "review":
			return showReviewMenu(st, ev);
		default:
			return reply(tev(ev, "menu.start_first", { command: DEFAULT_COMMAND }), {
				state: state.clear(),
			});
	}
}
