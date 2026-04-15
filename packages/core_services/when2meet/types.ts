// packages/core_services/when2meet/types.ts
// State types for the when2meet organizer flow. State is per-user (standard
// SDK state store) and lives only until the poll is published, which clears
// the flow. Vote storage lives host-side in SQLite — see src/core/polls/store.ts.

export interface Slot {
	startDate: string; // DD.MM.YYYY
	startTime: string; // HH:MM
	endDate: string; // DD.MM.YYYY
	endTime: string; // HH:MM
}

export interface PartialSlot {
	startDate?: string;
	startTime?: string;
	endDate?: string;
	endTime?: string;
}

export type When2meetPhase =
	| "title"
	| "slot_date_pick"
	| "slot_time_pick"
	| "slot_duration_pick"
	| "slot_end_date_text"
	| "slot_end_time_text"
	| "review";

export interface When2meetState {
	phase?: When2meetPhase;
	title?: string;
	slots?: Slot[];
	current?: PartialSlot;
	// SDK state compatibility
	[key: string]: unknown;
}
