// packages/core_services/event-creator/handlers/callback.ts
// Callback handler router for optional menu and calendar selection

import { type CallbackEvent, reply, state } from "@sdk/mod.ts";
import {
	CAL_REPLACE_GROUP,
	CB_CALENDAR_PREFIX,
	CB_EDIT_PREFIX,
	CB_LOCATION_PREFIX,
	CB_MENU_PREFIX,
} from "../constants.ts";
import { handleCalendarMenu, handleCalendarToggle } from "../flows/calendar.ts";
import { handleEditField, handleEditMenu } from "../flows/edit.ts";
import {
	handleLocationBack,
	handleLocationConfirm,
	handleLocationSelect,
	handleLocationTypeSelect,
	handleUseAsName,
} from "../flows/location.ts";
import { handleOptionalMenuAction, showOptionalMenu } from "../flows/optional_menu.ts";
import { handleSubmit } from "../flows/submit.ts";
import { tev } from "../utils/i18n.ts";

export function handleCallback(ev: CallbackEvent) {
	const data = ev.data ?? "";

	// Route to appropriate handler
	if (data.startsWith(CB_MENU_PREFIX)) {
		return handleMenuCallback(ev, data);
	}

	if (data.startsWith(CB_CALENDAR_PREFIX)) {
		return handleCalendarCallback(ev, data);
	}

	if (data.startsWith(CB_LOCATION_PREFIX)) {
		return handleLocationCallback(ev, data);
	}

	if (data.startsWith(CB_EDIT_PREFIX)) {
		return handleEditCallback(ev, data);
	}

	return reply(tev(ev, "menu.unknown_action"), {
		state: state.clear(),
	});
}

function handleMenuCallback(ev: CallbackEvent, data: string) {
	const action = data.substring(CB_MENU_PREFIX.length);

	switch (action) {
		case "description":
		case "image":
		case "location":
		case "endtime":
			return handleOptionalMenuAction(ev, action);

		case "calendars":
			return handleCalendarMenu(ev);

		case "edit":
			return handleEditMenu(ev);

		case "submit":
			return handleSubmit(ev);

		case "cancel":
			return reply(tev(ev, "menu.cancelled"), {
				state: state.clear(),
				deleteTrigger: true,
			});

		default:
			return reply(tev(ev, "menu.unknown_menu_action"), { state: state.clear() });
	}
}

function handleCalendarCallback(ev: CallbackEvent, data: string) {
	const action = data.substring(CB_CALENDAR_PREFIX.length);

	if (action === "back") {
		// Return to optional menu, clean up calendar message
		const st = (ev.state ?? {}) as Record<string, unknown>;
		return showOptionalMenu(st as import("../types.ts").EventCreatorState, ev, {
			cleanupGroup: CAL_REPLACE_GROUP,
		});
	}

	// Toggle calendar selection
	return handleCalendarToggle(ev, action);
}

function handleLocationCallback(ev: CallbackEvent, data: string) {
	const action = data.substring(CB_LOCATION_PREFIX.length);

	if (action === "back") {
		return handleLocationBack(ev);
	}

	if (action === "confirm") {
		return handleLocationConfirm(ev);
	}

	if (action.startsWith("type:")) {
		return handleLocationTypeSelect(ev, action.substring("type:".length));
	}

	if (action.startsWith("select:")) {
		return handleLocationSelect(ev, action.substring("select:".length));
	}

	if (action === "use_name") {
		return handleUseAsName(ev);
	}

	return handleLocationBack(ev);
}

function handleEditCallback(ev: CallbackEvent, data: string) {
	const field = data.substring(CB_EDIT_PREFIX.length);

	if (field === "back") {
		// Return to optional menu
		return handleOptionalMenuAction(ev, "back");
	}

	return handleEditField(ev, field);
}
