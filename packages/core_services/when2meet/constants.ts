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
// Picker phases — the service has already shown a quick-pick keyboard for
// this step. If the user types instead of tapping a button, the message
// handler treats the text as a manual fallback for the same field.
export const PHASE_SLOT_DATE_PICK = "slot_date_pick" as const;
export const PHASE_SLOT_TIME_PICK = "slot_time_pick" as const;
export const PHASE_SLOT_DURATION_PICK = "slot_duration_pick" as const;
// End-of-slot text phases — only entered when the organizer picks
// "Multi-day" on the duration picker.
export const PHASE_SLOT_END_DATE_TEXT = "slot_end_date_text" as const;
export const PHASE_SLOT_END_TIME_TEXT = "slot_end_time_text" as const;
export const PHASE_REVIEW = "review" as const;

// Callback data prefixes (namespaced automatically via UIBuilder.keyboard().namespace()).
export const CB_ADD_SLOT = "add_slot";
export const CB_PUBLISH = "publish";
export const CB_CANCEL = "cancel";

// Quick-pick callback prefixes. Each carries the chosen value after a colon.
// Date: "d:<index>" (index into the 14-day suggestion list) or "d:other".
// Time: "t:<HH:MM>" or "t:other".
// Duration: "dur:<minutes>", "dur:late", "dur:multi", or "dur:other".
export const CB_DATE_PREFIX = "d:";
export const CB_TIME_PREFIX = "t:";
export const CB_DUR_PREFIX = "dur:";
export const CB_OTHER = "other";
export const CB_DUR_LATE = "late";
export const CB_DUR_MULTI = "multi";

// Number of day suggestions in the quick date picker (starting at "today").
export const DATE_SUGGESTION_COUNT = 14;

// Common start times shown as quick buttons. Hand-picked for meetups.
export const TIME_SUGGESTIONS: readonly string[] = [
	"12:00",
	"14:00",
	"17:00",
	"18:00",
	"18:30",
	"19:00",
	"19:30",
	"20:00",
];

// Common durations in minutes. "late" and "multi" are handled separately.
export const DURATION_SUGGESTIONS: ReadonlyArray<{ label: string; minutes: number }> = [
	{ label: "1h", minutes: 60 },
	{ label: "1.5h", minutes: 90 },
	{ label: "2h", minutes: 120 },
	{ label: "2.5h", minutes: 150 },
	{ label: "3h", minutes: 180 },
];

// When the user picks "Until late", the end time defaults to this on the
// start date (e.g. "21:00-22:30" style evenings).
export const DURATION_LATE_END_TIME = "22:00";

// Group keys used for in-place message edits.
export const REVIEW_REPLACE_GROUP = "w2m_review";
export const SLOT_REPLACE_GROUP = "w2m_slot";

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
