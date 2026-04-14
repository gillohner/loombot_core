// packages/core_services/event-creator/handlers/message.ts
// Message handler for text input and image uploads

import { type MessageEvent, reply, state } from "@sdk/mod.ts";
import type { EventCreatorState } from "../types.ts";
import { handleRequiredFieldInput } from "../flows/required.ts";
import { handleEditFieldInput } from "../flows/edit.ts";
import { handleOptionalFieldInput } from "../flows/optional_menu.ts";
import { tev } from "../utils/i18n.ts";

export function handleMessage(ev: MessageEvent) {
	const st = (ev.state ?? {}) as EventCreatorState;
	const phase = st.phase;

	switch (phase) {
		case "required":
			return handleRequiredFieldInput(ev);

		case "editing":
			return handleEditFieldInput(ev);

		case "optional_menu":
			return handleOptionalFieldInput(ev);

		default:
			return reply(tev(ev, "menu.start_first"), {
				state: state.clear(),
			});
	}
}
