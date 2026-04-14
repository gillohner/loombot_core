// packages/core_services/event-creator/handlers/command.ts
// Command handler for starting the event creation flow

import { type CommandEvent, reply, state } from "@sdk/mod.ts";
import { REQ_STEP_TITLE } from "../constants.ts";
import type { EventCreatorConfig } from "../types.ts";
import { getCalendarName, getDefaultCalendarUri } from "../utils/calendar.ts";
import { escapeHtml } from "../utils/formatting.ts";
import { tev } from "../utils/i18n.ts";

export function handleCommand(ev: CommandEvent) {
	const config = ev.serviceConfig as EventCreatorConfig | undefined;
	const calCount = config?.calendars?.length ?? 0;

	// Display welcome message with calendar info
	const defaultUri = config ? getDefaultCalendarUri(config) : undefined;
	const lines: string[] = [tev(ev, "command.title"), ""];

	if (defaultUri && config) {
		lines.push(
			tev(ev, "command.calendar_line", { name: escapeHtml(getCalendarName(defaultUri, config)) }),
		);
		if (calCount > 1) {
			lines.push(tev(ev, "command.more_available", { count: calCount - 1 }));
		}
		lines.push("");
	}

	lines.push(tev(ev, "command.step_title"));

	return reply(lines.join("\n"), {
		state: state.replace({
			phase: "required",
			requirementStep: REQ_STEP_TITLE,
		}),
		options: { parse_mode: "HTML" },
	});
}
