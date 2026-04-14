// packages/core_services/help/constants.ts
// Help - Single command service that shows a configurable help message with optional command list

import { createI18n, type DatasetSchemas, escapeHtml, type JSONSchema } from "@sdk/mod.ts";
import en from "./locales/en.ts";
import de from "./locales/de.ts";

// ============================================================================
// Service Identity
// ============================================================================

export const HELP_SERVICE_ID = "help" as const;
export const HELP_VERSION = "1.0.0" as const;

// ============================================================================
// Types
// ============================================================================

export interface HelpCommandEntry {
	/** Command name (e.g. "/start") */
	command: string;
	/** Description of what the command does */
	description: string;
}

export interface HelpConfig {
	/** Main help text (HTML) */
	message: string;
	/** Optional list of commands to append */
	commands?: HelpCommandEntry[];
	/** Whether to append the command list (default: true) */
	showCommandList?: boolean;
}

// ============================================================================
// i18n
// ============================================================================

const tRaw = createI18n({ en, de }, "en");

// ============================================================================
// JSON Schemas
// ============================================================================

export const HELP_COMMAND_ENTRY_SCHEMA: JSONSchema = {
	type: "object",
	properties: {
		command: {
			type: "string",
			title: "Command",
			description: "Command name (e.g. /start)",
			minLength: 1,
			maxLength: 50,
		},
		description: {
			type: "string",
			title: "Description",
			description: "What the command does",
			minLength: 1,
			maxLength: 200,
		},
	},
	required: ["command", "description"],
};

export const HELP_CONFIG_SCHEMA: JSONSchema = {
	type: "object",
	properties: {
		message: {
			type: "string",
			title: "Help Message",
			description: "The main help message to display (supports HTML tags)",
			format: "textarea",
			maxLength: 2000,
		},
		commands: {
			type: "array",
			title: "Commands",
			description: "List of commands to show in the help message",
			items: HELP_COMMAND_ENTRY_SCHEMA,
		},
		showCommandList: {
			type: "boolean",
			title: "Show Command List",
			description: "Whether to append the command list after the message (default: true)",
		},
		messageTtl: {
			type: "integer",
			title: "Message TTL",
			description: "Auto-delete bot messages after this many seconds (0 to keep forever)",
			minimum: 0,
			default: 300,
		},
	},
	required: ["message"],
};

export const HELP_DATASET_SCHEMAS: DatasetSchemas = {};

// ============================================================================
// Helpers
// ============================================================================

export function formatHelpMessage(config: HelpConfig, locale?: string): string {
	// Escape user-provided message to avoid breaking HTML parse mode
	let text = escapeHtml(config.message);

	const showCommands = config.showCommandList !== false;
	if (showCommands && config.commands && config.commands.length > 0) {
		text += "\n\n" + tRaw("commands_header", undefined, locale ?? "en") + "\n";
		text += config.commands
			.map((c) => `${escapeHtml(c.command)} — ${escapeHtml(c.description)}`)
			.join("\n");
	}

	return text;
}

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_CONFIG: HelpConfig = {
	// Dead fallback — `message` is required by the schema so this never actually
	// reaches a user. Kept as a structural default only.
	message: "",
	commands: [],
	showCommandList: true,
};
