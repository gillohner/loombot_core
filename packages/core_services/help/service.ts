// packages/core_services/help/service.ts
// Help - Single command service that shows a configurable help message with optional command list
import { defineService, none, reply, runService } from "@sdk/mod.ts";
import type { CallbackEvent, CommandEvent, MessageEvent } from "@sdk/mod.ts";
import {
	DEFAULT_CONFIG,
	formatHelpMessage,
	HELP_CONFIG_SCHEMA,
	HELP_DATASET_SCHEMAS,
	HELP_SERVICE_ID,
	HELP_VERSION,
	type HelpConfig,
} from "./constants.ts";

// ============================================================================
// Service Definition
// ============================================================================

const service = defineService({
	id: HELP_SERVICE_ID,
	version: HELP_VERSION,
	kind: "single_command",
	description: "Configurable help message with optional command list",
	configSchema: HELP_CONFIG_SCHEMA,
	datasetSchemas: HELP_DATASET_SCHEMAS,
	handlers: {
		command: (ev: CommandEvent) => {
			const rawConfig = ev.serviceConfig || {};
			const config: HelpConfig = { ...DEFAULT_CONFIG, ...rawConfig };
			const text = formatHelpMessage(config, ev.language);

			return reply(text, {
				options: {
					parse_mode: "HTML",
					disable_web_page_preview: true,
				},
			});
		},
		callback: (_ev: CallbackEvent) => none(),
		message: (_ev: MessageEvent) => none(),
	},
});

export default service;
if (import.meta.main) await runService(service);
