// packages/core_services/when2meet/handlers/callback.ts
// Routes the organizer flow's inline-keyboard callbacks. Quick-pick prefixes
// (d:, t:, dur:) carry the chosen value after a colon; review-menu actions
// are plain strings.
//
// NOTE: Vote / close / create_event callbacks on the *published* poll
// message are NOT handled here — they use the `w2m:*` prefix and are
// intercepted host-side in src/middleware/polls.ts, never reaching the
// sandbox.

import { type CallbackEvent, reply, state } from "@sdk/mod.ts";
import {
	CB_ADD_SLOT,
	CB_CANCEL,
	CB_DATE_PREFIX,
	CB_DUR_PREFIX,
	CB_PUBLISH,
	CB_TIME_PREFIX,
} from "../constants.ts";
import {
	handleAddSlot,
	handleCancel,
	handleDateCallback,
	handleDurationCallback,
	handlePublish,
	handleTimeCallback,
} from "../flows/propose.ts";
import { tev } from "../utils/i18n.ts";

export function handleCallback(ev: CallbackEvent) {
	const data = ev.data ?? "";
	if (data.startsWith(CB_DATE_PREFIX)) {
		return handleDateCallback(ev, data.slice(CB_DATE_PREFIX.length));
	}
	if (data.startsWith(CB_TIME_PREFIX)) {
		return handleTimeCallback(ev, data.slice(CB_TIME_PREFIX.length));
	}
	if (data.startsWith(CB_DUR_PREFIX)) {
		return handleDurationCallback(ev, data.slice(CB_DUR_PREFIX.length));
	}
	switch (data) {
		case CB_ADD_SLOT:
			return handleAddSlot(ev);
		case CB_PUBLISH:
			return handlePublish(ev);
		case CB_CANCEL:
			return handleCancel(ev);
		default:
			return reply(tev(ev, "menu.unknown_action"), { state: state.clear() });
	}
}
