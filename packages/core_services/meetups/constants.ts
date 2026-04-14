// packages/core_services/meetups/constants.ts
// Meetups - Command flow service that displays upcoming events from Pubky calendars

import { type DatasetSchemas, escapeHtml, type JSONSchema } from "@sdk/mod.ts";
export { escapeHtml };

// ============================================================================
// Service Identity
// ============================================================================

export const MEETUPS_SERVICE_ID = "meetups" as const;
export const MEETUPS_VERSION = "2.1.0" as const;
export const MEETUPS_COMMAND = "meetups" as const;
export const MEETUPS_REPLACE_GROUP = "meetups_menu" as const;

// ============================================================================
// Types
// ============================================================================

export interface CalendarSource {
	/** Pubky calendar URI */
	uri: string;
	/** Display name for this calendar */
	name?: string;
}

export interface MeetupsConfig {
	/** Nexus API base URL for fetching events (default: "https://nexus.eventky.app") */
	nexusUrl?: string;
	/** Pubky calendar URIs to fetch events from */
	calendars: CalendarSource[];
	/** Header text (default: "Upcoming Events") */
	title?: string;
	/** Max events to show (default: 10) */
	maxEvents?: number;
	/** Show calendar title with eventky link above events (default: true) */
	showCalendarTitle?: boolean;
	/** Link each event title to its eventky page (default: true) */
	linkEvents?: boolean;
	/** Base URL for eventky web app (default: "https://eventky.app") */
	eventkyBaseUrl?: string;
	/** Which timeline options to offer (default: all three) */
	timelineOptions?: TimelineRangeId[];
	/** Enable periodic auto-broadcast (default: false) */
	periodicEnabled?: boolean;
	/** Day of week to broadcast: 0=Sun, 1=Mon, ..., 6=Sat (default: 1 = Monday) */
	periodicDay?: number;
	/** Hour to broadcast in 24h format (default: 7) */
	periodicHour?: number;
	/** Timezone for schedule matching (default: "Europe/Zurich") */
	periodicTimezone?: string;
	/** Pin the periodic message (default: true) */
	periodicPin?: boolean;
	/** Unpin previous periodic message when sending new one (default: true) */
	periodicUnpinPrevious?: boolean;
	/** Timeline range for periodic broadcast (default: "week") */
	periodicRange?: TimelineRangeId;
	/** Disable URL previews in messages (default: true) */
	disableLinkPreview?: boolean;
}

export interface MeetupsState {
	[key: string]: unknown;
	selectedCalendar?: number | "all";
	timeRange?: string;
}

export type TimelineRangeId = "today" | "week" | "2weeks" | "30days";

// Legacy English labels — kept for backward compatibility. Prefer the locale
// file in ./locales/{en,de}.ts via `labelForRange(range, locale)` below.
export const TIMELINE_LABELS: Record<TimelineRangeId, string> = {
	today: "Today",
	week: "This week",
	"2weeks": "Next 2 weeks",
	"30days": "Next 30 days",
};

const TIMELINE_LABELS_DE: Record<TimelineRangeId, string> = {
	today: "Heute",
	week: "Diese Woche",
	"2weeks": "Nächste 2 Wochen",
	"30days": "Nächste 30 Tage",
};

/** Locale-aware timeline label lookup. `locale` falls back to English. */
export function labelForRange(range: TimelineRangeId, locale?: string): string {
	if (locale === "de") return TIMELINE_LABELS_DE[range];
	return TIMELINE_LABELS[range];
}

function intlLocaleFor(locale?: string): string {
	return locale === "de" ? "de-DE" : "en-US";
}

// Inline two-key table for the "No upcoming events found." fallback. This is
// called from both the host-side scheduler and the sandboxed meetups service,
// so the helper can't import the service's locales directly (the service owns
// those) — we duplicate the two strings here intentionally.
const NO_EVENTS_LABELS: Record<string, string> = {
	en: "No upcoming events found.",
	de: "Keine bevorstehenden Events.",
};

export const DEFAULT_TIMELINE_OPTIONS: TimelineRangeId[] = ["today", "week", "2weeks", "30days"];

// ============================================================================
// Nexus API Types
// ============================================================================

/** Full event details from Nexus /v0/event/{author_id}/{event_id} */
export interface NexusEventDetails {
	id: string;
	author: string;
	uri: string;
	summary: string;
	dtstart: string;
	dtend?: string | null;
	dtstart_tzid?: string | null;
	dtend_tzid?: string | null;
	dtstart_timestamp?: number | null;
	description?: string | null;
	status?: string | null;
	rrule?: string | null;
	rdate?: string[] | null;
	exdate?: string[] | null;
	duration?: string | null;
	locations?: string | null;
	url?: string | null;
}

/** Response from /v0/event/{author_id}/{event_id} */
export interface NexusEventView {
	details: NexusEventDetails;
	tags?: unknown[];
	attendees?: unknown[];
}

/** Response from /v0/calendar/{author_id}/{calendar_id} */
export interface NexusCalendarView {
	details: {
		id: string;
		author: string;
		uri: string;
		name: string;
		timezone: string;
		description?: string | null;
	};
	events: string[];
}

/** A specific occurrence of an event to display in the timeline */
export interface EventOccurrence {
	/** Event summary/title */
	summary: string;
	/** Description (if any) */
	description?: string | null;
	/** The date/time of this occurrence (ISO 8601 string, event-local timezone) */
	occurrenceStart: string;
	/** The end date/time of this occurrence (if computable) */
	occurrenceEnd?: string;
	/** Event URI for linking */
	uri: string;
	/** Whether this event has recurrence rules */
	isRecurring: boolean;
	/** Parsed location name (if any) */
	locationName?: string;
}

// ============================================================================
// JSON Schemas
// ============================================================================

export const CALENDAR_SOURCE_SCHEMA: JSONSchema = {
	type: "object",
	properties: {
		uri: {
			type: "string",
			title: "Calendar URI",
			description: "Pubky calendar URI (e.g., pubky://<pk>/pub/eventky.app/calendars/<id>)",
			minLength: 1,
		},
		name: {
			type: "string",
			title: "Calendar Name",
			description: "Display name for this calendar (optional)",
			maxLength: 100,
		},
	},
	required: ["uri"],
};

export const MEETUPS_CONFIG_SCHEMA: JSONSchema = {
	type: "object",
	properties: {
		nexusUrl: {
			type: "string",
			title: "Nexus API URL",
			description: "Base URL of the Nexus indexer API",
			default: "https://nexus.eventky.app",
		},
		calendars: {
			type: "array",
			title: "Calendars",
			description: "Pubky calendar URIs to fetch events from",
			items: CALENDAR_SOURCE_SCHEMA,
			minItems: 1,
		},
		title: {
			type: "string",
			title: "Header Title",
			description: "Header text shown above the event list",
			maxLength: 200,
			default: "Upcoming Events",
		},
		maxEvents: {
			type: "integer",
			title: "Max Events",
			description: "Maximum number of events to display",
			minimum: 1,
			maximum: 50,
			default: 10,
		},
		showCalendarTitle: {
			type: "boolean",
			title: "Show Calendar Title",
			description: "Show calendar name with eventky link above events",
			default: true,
		},
		linkEvents: {
			type: "boolean",
			title: "Link Events",
			description: "Link each event title to its eventky.app page",
			default: true,
		},
		eventkyBaseUrl: {
			type: "string",
			title: "Eventky Base URL",
			description: "Base URL for eventky web app",
			default: "https://eventky.app",
		},
		timelineOptions: {
			type: "array",
			title: "Timeline Options",
			description:
				"Timeline filter buttons to show: 'today' (rest of today), 'week' (this week), '2weeks' (next 2 weeks), '30days' (next 30 days)",
			items: {
				type: "string",
				enum: ["today", "week", "2weeks", "30days"],
			},
			default: ["today", "week", "2weeks", "30days"],
		},
		messageTtl: {
			type: "integer",
			title: "Message TTL",
			description: "Auto-delete bot messages after this many seconds (0 to keep forever)",
			minimum: 0,
			default: 300,
		},
		periodicEnabled: {
			type: "boolean",
			title: "Enable Periodic Broadcast",
			description: "Automatically send this week's events on a schedule",
			default: false,
		},
		periodicDay: {
			type: "integer",
			title: "Broadcast Day",
			description: "Day of week: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat",
			minimum: 0,
			maximum: 6,
			default: 1,
		},
		periodicHour: {
			type: "integer",
			title: "Broadcast Hour",
			description: "Hour to broadcast (24h format, in configured timezone)",
			minimum: 0,
			maximum: 23,
			default: 7,
		},
		periodicTimezone: {
			type: "string",
			title: "Broadcast Timezone",
			description: "IANA timezone for schedule matching (e.g., Europe/Zurich, America/New_York)",
			default: "Europe/Zurich",
		},
		periodicPin: {
			type: "boolean",
			title: "Pin Periodic Message",
			description: "Pin the periodic broadcast message in the chat",
			default: true,
		},
		periodicUnpinPrevious: {
			type: "boolean",
			title: "Unpin Previous Message",
			description: "Unpin the previous periodic message when sending a new one",
			default: true,
		},
		periodicRange: {
			type: "string",
			title: "Periodic Range",
			description: "Timeline range for periodic broadcast",
			enum: ["today", "week", "2weeks", "30days"],
			default: "week",
		},
		disableLinkPreview: {
			type: "boolean",
			title: "Disable Link Preview",
			description: "Disable URL previews in messages (Telegram only renders the first URL preview)",
			default: true,
		},
	},
	required: ["calendars"],
};

export const MEETUPS_DATASET_SCHEMAS: DatasetSchemas = {};

// ============================================================================
// URI Parsing
// ============================================================================

/** Parse a pubky:// calendar URI into author_id and calendar_id */
export function parseCalendarUri(
	uri: string,
): { authorId: string; calendarId: string } | null {
	const match = /^pubky:\/\/([^/]+)\/pub\/eventky\.app\/calendars\/([^/]+)/.exec(uri);
	if (!match) return null;
	return { authorId: match[1], calendarId: match[2] };
}

/** Parse a pubky:// event URI into author_id and event_id */
export function parseEventUri(
	uri: string,
): { authorId: string; eventId: string } | null {
	const match = /^pubky:\/\/([^/]+)\/pub\/eventky\.app\/events\/([^/]+)/.exec(uri);
	if (!match) return null;
	return { authorId: match[1], eventId: match[2] };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse an ISO 8601 duration string (e.g., "PT3H", "PT1H30M", "P1D") into milliseconds.
 */
export function parseDuration(duration: string): number | null {
	const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(duration);
	if (!match) return null;
	const days = parseInt(match[1] || "0");
	const hours = parseInt(match[2] || "0");
	const minutes = parseInt(match[3] || "0");
	const seconds = parseInt(match[4] || "0");
	return ((days * 24 + hours) * 60 + minutes) * 60000 + seconds * 1000;
}

/**
 * Compute end time from start + duration string.
 */
export function computeOccurrenceEnd(
	startIso: string,
	event: NexusEventDetails,
): string | undefined {
	if (event.dtend) {
		// For recurring events, compute the offset from original dtstart→dtend
		// and apply it to the occurrence start
		const origStart = new Date(event.dtstart);
		const origEnd = new Date(event.dtend);
		const durationMs = origEnd.getTime() - origStart.getTime();
		if (durationMs > 0) {
			const occStart = new Date(startIso);
			return new Date(occStart.getTime() + durationMs).toISOString();
		}
		return undefined;
	}
	if (event.duration) {
		const durationMs = parseDuration(event.duration);
		if (durationMs) {
			const start = new Date(startIso);
			return new Date(start.getTime() + durationMs).toISOString();
		}
	}
	return undefined;
}

/**
 * Extract a human-readable location name from the event's locations JSON.
 */
export function extractLocationName(locationsJson: string | null | undefined): string | undefined {
	if (!locationsJson) return undefined;
	try {
		const locations = JSON.parse(locationsJson) as Array<{ name?: string }>;
		if (locations.length > 0 && locations[0].name) {
			return locations[0].name;
		}
	} catch {
		// ignore parse errors
	}
	return undefined;
}

/**
 * Format an ISO 8601 datetime string for display.
 * Returns a human-readable date/time string in the given locale.
 */
export function formatEventDate(dtstart: string, dtend?: string, locale?: string): string {
	try {
		const intl = intlLocaleFor(locale);
		const start = new Date(dtstart);
		const dateStr = start.toLocaleDateString(intl, {
			weekday: "short",
			month: "short",
			day: "numeric",
		});
		const timeStr = start.toLocaleTimeString(intl, {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});

		let result = `${dateStr}, ${timeStr}`;

		if (dtend) {
			const end = new Date(dtend);
			const sameDay = start.toDateString() === end.toDateString();
			if (sameDay) {
				const endTime = end.toLocaleTimeString(intl, {
					hour: "2-digit",
					minute: "2-digit",
					hour12: false,
				});
				result += `\u2013${endTime}`;
			} else {
				const endDateStr = end.toLocaleDateString(intl, {
					weekday: "short",
					month: "short",
					day: "numeric",
				});
				const endTime = end.toLocaleTimeString(intl, {
					hour: "2-digit",
					minute: "2-digit",
					hour12: false,
				});
				result += ` \u2013 ${endDateStr}, ${endTime}`;
			}
		}

		return result;
	} catch {
		return dtstart;
	}
}

/**
 * Format a list of event occurrences as an HTML message.
 * When eventkyBaseUrl is provided, event titles link to their eventky page.
 * `locale` controls the "No upcoming events found." fallback and the date
 * formatting for each event.
 */
export function formatEventsMessage(
	occurrences: EventOccurrence[],
	title: string,
	eventkyBaseUrl?: string,
	locale?: string,
): string {
	if (occurrences.length === 0) {
		const noEvents = NO_EVENTS_LABELS[locale ?? "en"] ?? NO_EVENTS_LABELS.en;
		return `<b>${escapeHtml(title)}</b>\n\n${noEvents}`;
	}

	let text = `<b>${escapeHtml(title)}</b>\n`;

	for (const occ of occurrences) {
		const date = formatEventDate(occ.occurrenceStart, occ.occurrenceEnd, locale);
		const name = escapeHtml(occ.summary);
		let eventUrl = eventkyBaseUrl ? buildEventkyEventUrl(occ.uri, eventkyBaseUrl) : "";
		// For recurring events, link to the specific occurrence
		if (eventUrl && occ.isRecurring) {
			eventUrl += `?instance=${encodeURIComponent(occ.occurrenceStart)}`;
		}

		if (eventUrl) {
			text += `\n<b><a href="${eventUrl}">${name}</a></b>`;
		} else {
			text += `\n<b>${name}</b>`;
		}
		if (occ.isRecurring) text += ` \u{1F501}`;
		text += `\n${escapeHtml(date)}\n`;
		if (occ.locationName) {
			text += `\u{1F4CD} ${escapeHtml(occ.locationName)}\n`;
		}
		if (occ.description) {
			const desc = occ.description.length > 100
				? occ.description.slice(0, 97) + "..."
				: occ.description;
			text += `${escapeHtml(desc)}\n`;
		}
	}

	return text;
}

/**
 * Compute end date as a Date object for a given timeline range.
 */
export function computeEndDate(rangeId: TimelineRangeId): Date {
	const now = new Date();

	switch (rangeId) {
		case "today": {
			const endOfDay = new Date(now);
			endOfDay.setHours(23, 59, 59, 999);
			return endOfDay;
		}
		case "week": {
			const dayOfWeek = now.getDay();
			const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
			const endOfWeek = new Date(now);
			endOfWeek.setDate(now.getDate() + daysUntilSunday);
			endOfWeek.setHours(23, 59, 59, 999);
			return endOfWeek;
		}
		case "2weeks": {
			const twoWeeks = new Date(now);
			twoWeeks.setDate(now.getDate() + 14);
			twoWeeks.setHours(23, 59, 59, 999);
			return twoWeeks;
		}
		case "30days": {
			const thirtyDays = new Date(now);
			thirtyDays.setDate(now.getDate() + 30);
			thirtyDays.setHours(23, 59, 59, 999);
			return thirtyDays;
		}
	}
}

/**
 * Extract pk and calendarId from a pubky:// calendar URI and build an eventky web link.
 * URI format: pubky://<pk>/pub/eventky.app/calendars/<calendarId>
 */
export function buildEventkyCalendarUrl(calUri: string, baseUrl: string): string {
	const match = /^pubky:\/\/([^/]+)\/pub\/eventky\.app\/calendars\/([^/]+)/.exec(calUri);
	if (!match) return "";
	const [, pk, calendarId] = match;
	return `${baseUrl.replace(/\/$/, "")}/calendar/${pk}/${calendarId}`;
}

/**
 * Build an eventky web link for a specific event.
 * URI format: pubky://<pk>/pub/eventky.app/events/<eventId>
 */
export function buildEventkyEventUrl(eventUri: string, baseUrl: string): string {
	const match = /^pubky:\/\/([^/]+)\/pub\/eventky\.app\/events\/([^/]+)/.exec(eventUri);
	if (!match) return "";
	const [, pk, eventId] = match;
	return `${baseUrl.replace(/\/$/, "")}/event/${pk}/${eventId}`;
}

const DEFAULT_TITLE_LABELS: Record<string, string> = {
	en: "Upcoming Events",
	de: "Kommende Events",
};

function defaultTitleFor(locale?: string): string {
	return DEFAULT_TITLE_LABELS[locale ?? "en"] ?? DEFAULT_TITLE_LABELS.en;
}

/**
 * Build an HTML header with the calendar title and optional eventky link.
 * Returns empty string if showCalendarTitle is disabled.
 */
export function buildCalendarHeader(
	config: MeetupsConfig,
	selectedCalendar: number | "all",
	locale?: string,
): string {
	if (config.showCalendarTitle === false) return "";
	const baseUrl = config.eventkyBaseUrl || "https://eventky.app";
	const fallbackTitle = defaultTitleFor(locale);

	if (selectedCalendar === "all") {
		return `<b>${escapeHtml(config.title || fallbackTitle)}</b>\n\n`;
	}

	const cal = config.calendars[selectedCalendar];
	if (!cal) return "";

	const name = escapeHtml(cal.name || config.title || fallbackTitle);
	const url = buildEventkyCalendarUrl(cal.uri, baseUrl);

	if (url) {
		return `<b><a href="${url}">${name}</a></b>\n\n`;
	}
	return `<b>${name}</b>\n\n`;
}

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_CONFIG: Partial<MeetupsConfig> = {
	nexusUrl: "https://nexus.eventky.app",
	// `title` intentionally omitted: when the operator doesn't set one,
	// buildCalendarHeader falls through to defaultTitleFor(locale) so the
	// header is localized ("Upcoming Events" / "Kommende Events").
	maxEvents: 10,
	showCalendarTitle: true,
	linkEvents: true,
	eventkyBaseUrl: "https://eventky.app",
	timelineOptions: ["today", "week", "2weeks", "30days"],
	periodicEnabled: false,
	periodicDay: 1,
	periodicHour: 7,
	periodicTimezone: "Europe/Zurich",
	periodicPin: true,
	periodicUnpinPrevious: true,
	periodicRange: "week",
};
