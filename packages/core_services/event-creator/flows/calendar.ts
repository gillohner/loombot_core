// packages/core_services/event-creator/flows/calendar.ts
// Calendar selection and toggle handlers

import { type CallbackEvent, reply, state, UIBuilder, uiKeyboard } from "@sdk/mod.ts";
import { CAL_REPLACE_GROUP, SERVICE_ID } from "../constants.ts";
import type { EventCreatorConfig, EventCreatorState } from "../types.ts";
import {
	decodeCalendarId,
	encodeCalendarId,
	getCalendarName,
	getDefaultCalendarUri,
	getSelectableCalendars,
} from "../utils/calendar.ts";
import { escapeHtml } from "../utils/formatting.ts";
import { tev, tfor } from "../utils/i18n.ts";

export function handleCalendarMenu(ev: CallbackEvent) {
	const st = (ev.state ?? {}) as EventCreatorState;
	const config = (ev.serviceConfig ?? {}) as EventCreatorConfig;
	const t = tfor(ev.language);

	const selectableCalendars = getSelectableCalendars(config);
	if (selectableCalendars.length === 0) {
		return reply(tev(ev, "calendar.none_available"), {
			state: state.replace(st),
		});
	}

	const selected = st.selectedCalendars || [];
	const keyboard = UIBuilder.keyboard().namespace(SERVICE_ID);

	for (const cal of selectableCalendars) {
		const isSelected = selected.includes(cal.uri);
		const icon = isSelected ? "✅" : "☐";
		const calId = encodeCalendarId(cal.uri);
		const name = getCalendarName(cal.uri, config);
		keyboard.callback(
			`${icon} ${name}`,
			`calendar:toggle:${calId}`,
		).row();
	}

	keyboard.callback(t("menu.back_to_menu"), "calendar:back");

	// Build description lines for calendars that have one
	const descLines: string[] = [];
	const defaultUri = getDefaultCalendarUri(config);
	if (defaultUri) {
		const defaultName = getCalendarName(defaultUri, config);
		descLines.push(t("calendar.default_line", { name: escapeHtml(defaultName) }));
	}
	for (const cal of selectableCalendars) {
		if (cal.description) {
			const name = getCalendarName(cal.uri, config);
			descLines.push(t("calendar.desc_bullet", { name, desc: cal.description }));
		}
	}

	const message = `${t("calendar.header")}\n\n` +
		(descLines.length > 0 ? descLines.join("\n") + "\n\n" : "") +
		t("calendar.tap_to_toggle", { count: selected.length });

	return uiKeyboard(keyboard.build(), message, {
		state: state.replace(st),
		options: { replaceGroup: CAL_REPLACE_GROUP },
	});
}

export function handleCalendarToggle(ev: CallbackEvent, calIdEncoded: string) {
	const st = (ev.state ?? {}) as EventCreatorState;
	const config = (ev.serviceConfig ?? {}) as EventCreatorConfig;

	// Remove "toggle:" prefix if present
	const calId = calIdEncoded.replace("toggle:", "");
	const calUri = decodeCalendarId(calId, config);

	if (!calUri) {
		return reply(tev(ev, "calendar.not_found"), {
			state: state.replace(st),
		});
	}

	let selected = st.selectedCalendars || [];

	if (selected.includes(calUri)) {
		// Remove
		selected = selected.filter((uri) => uri !== calUri);
	} else {
		// Add
		selected = [...selected, calUri];
	}

	const updatedState = {
		...st,
		selectedCalendars: selected,
	};

	// Redisplay calendar menu with updated selection
	return handleCalendarMenu({
		...ev,
		state: updatedState,
	});
}
