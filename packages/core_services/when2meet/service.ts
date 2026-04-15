// packages/core_services/when2meet/service.ts
// when2meet — availability poll service for loombot. Runs the organizer flow
// (title + 2-5 candidate slots) in the sandbox, then emits a `poll_publish`
// response that the Telegram adapter turns into a poll message with live
// inline-keyboard voting. Vote/close/create_event callbacks are handled
// host-side in src/middleware/polls.ts.

import { defineService, runService } from "@sdk/mod.ts";
import type { CallbackEvent, CommandEvent, MessageEvent } from "@sdk/mod.ts";
import {
	SERVICE_KIND,
	WHEN2MEET_CONFIG_SCHEMA,
	WHEN2MEET_SERVICE_ID,
	WHEN2MEET_VERSION,
} from "./constants.ts";
import { handleCommand } from "./handlers/command.ts";
import { handleMessage } from "./handlers/message.ts";
import { handleCallback } from "./handlers/callback.ts";

const service = defineService({
	id: WHEN2MEET_SERVICE_ID,
	version: WHEN2MEET_VERSION,
	kind: SERVICE_KIND,
	description:
		"Availability poll: collect candidate time slots, let the group vote, then seed event_creator.",
	configSchema: WHEN2MEET_CONFIG_SCHEMA,

	handlers: {
		command: (ev: CommandEvent) => handleCommand(ev),
		message: (ev: MessageEvent) => handleMessage(ev),
		callback: (ev: CallbackEvent) => handleCallback(ev),
	},
});

export default service;

if (import.meta.main) await runService(service);
