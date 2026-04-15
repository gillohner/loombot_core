// packages/core_services/when2meet/handlers/command.ts
// /when2meet entry: start the organizer flow at the title phase.

import { type CommandEvent, reply, state } from "@sdk/mod.ts";
import { MAX_TITLE_LENGTH } from "../constants.ts";
import { tev } from "../utils/i18n.ts";

export function handleCommand(ev: CommandEvent) {
	const lines = [
		tev(ev, "command.title"),
		"",
		tev(ev, "command.intro"),
		"",
		tev(ev, "command.step_title_hint", { max: MAX_TITLE_LENGTH }),
	];
	return reply(lines.join("\n"), {
		state: state.replace({ phase: "title" }),
		options: { parse_mode: "HTML" },
	});
}
