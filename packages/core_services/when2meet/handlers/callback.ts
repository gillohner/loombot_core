// packages/core_services/when2meet/handlers/callback.ts
// Handles the three buttons on the review menu: add slot, publish, cancel.
//
// NOTE: Vote / close / create_event callbacks on the published poll message
// are NOT handled here — they use the `w2m:*` prefix and are intercepted
// host-side in src/middleware/polls.ts, never reaching the sandbox.

import { type CallbackEvent, reply, state } from "@sdk/mod.ts";
import { CB_ADD_SLOT, CB_CANCEL, CB_PUBLISH } from "../constants.ts";
import { handleAddSlot, handleCancel, handlePublish } from "../flows/propose.ts";
import { tev } from "../utils/i18n.ts";

export function handleCallback(ev: CallbackEvent) {
	const data = ev.data ?? "";
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
