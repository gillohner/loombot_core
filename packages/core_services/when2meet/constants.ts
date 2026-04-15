// packages/core_services/when2meet/constants.ts
// Service identity + flow constants for the when2meet (availability poll) service.

import type { JSONSchema } from "@sdk/mod.ts";

export const WHEN2MEET_SERVICE_ID = "when2meet" as const;
export const WHEN2MEET_VERSION = "1.0.0" as const;
export const SERVICE_KIND = "command_flow" as const;
export const DEFAULT_COMMAND = "when2meet";

// Slot limits per poll.
export const MIN_SLOTS = 2;
export const MAX_SLOTS = 5;

// Title max length (matches event_creator for consistency).
export const MAX_TITLE_LENGTH = 100;

// Flow phases.
export const PHASE_TITLE = "title" as const;
export const PHASE_SLOT_START_DATE = "slot_start_date" as const;
export const PHASE_SLOT_START_TIME = "slot_start_time" as const;
export const PHASE_SLOT_END_DATE = "slot_end_date" as const;
export const PHASE_SLOT_END_TIME = "slot_end_time" as const;
export const PHASE_REVIEW = "review" as const;

// Callback data prefixes (namespaced automatically via UIBuilder.keyboard().namespace()).
export const CB_ADD_SLOT = "add_slot";
export const CB_PUBLISH = "publish";
export const CB_CANCEL = "cancel";

// Group key used for in-place edits of the organizer's review message.
export const REVIEW_REPLACE_GROUP = "w2m_review";

export const WHEN2MEET_CONFIG_SCHEMA: JSONSchema = {
	type: "object",
	title: "When2meet Configuration",
	description: "Configuration options for the when2meet availability poll service",
	properties: {
		maxSlots: {
			type: "integer",
			title: "Maximum slots per poll",
			description: "Upper bound on how many candidate time slots a poll can have.",
			minimum: 2,
			maximum: 10,
			default: MAX_SLOTS,
		},
		messageTtl: {
			type: "integer",
			title: "Message TTL",
			description:
				"Auto-delete bot messages sent to the organizer after this many seconds (0 to keep forever).",
			minimum: 0,
			default: 0,
		},
	},
};

export interface When2meetConfig {
	maxSlots?: number;
	messageTtl?: number;
}
