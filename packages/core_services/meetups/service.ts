// packages/core_services/meetups/service.ts
// Meetups - Command flow service that displays upcoming events from Pubky calendars
import { defineService, del, none, runService, state, UIBuilder, uiKeyboard } from "@sdk/mod.ts";
import type { CallbackEvent, CommandEvent, MessageEvent } from "@sdk/mod.ts";
import {
	buildCalendarHeader,
	computeEndDate,
	computeOccurrenceEnd,
	DEFAULT_CONFIG,
	DEFAULT_TIMELINE_OPTIONS,
	type EventOccurrence,
	extractLocationName,
	formatEventsMessage,
	MEETUPS_COMMAND,
	MEETUPS_CONFIG_SCHEMA,
	MEETUPS_DATASET_SCHEMAS,
	MEETUPS_REPLACE_GROUP,
	MEETUPS_SERVICE_ID,
	MEETUPS_VERSION,
	type MeetupsConfig,
	type MeetupsState,
	type NexusCalendarView,
	type NexusEventDetails,
	type NexusEventView,
	parseCalendarUri,
	parseEventUri,
	TIMELINE_LABELS,
	type TimelineRangeId,
} from "./constants.ts";

// ============================================================================
// RRULE Parsing & Recurrence Expansion (pure TypeScript, no npm dependency)
// ============================================================================

interface ParsedRRule {
	freq?: string;
	interval: number;
	count?: number;
	until?: string;
	byday?: string[];
	bymonthday?: number[];
	bysetpos?: number[];
}

const WEEKDAY_MAP: Record<string, number> = {
	"SU": 0,
	"MO": 1,
	"TU": 2,
	"WE": 3,
	"TH": 4,
	"FR": 5,
	"SA": 6,
};

function parseRRule(rrule: string): ParsedRRule {
	const rules: ParsedRRule = { interval: 1 };
	for (const part of rrule.split(";")) {
		const eqIdx = part.indexOf("=");
		if (eqIdx < 0) continue;
		const key = part.slice(0, eqIdx);
		const value = part.slice(eqIdx + 1);
		switch (key) {
			case "FREQ":
				rules.freq = value;
				break;
			case "INTERVAL":
				rules.interval = parseInt(value) || 1;
				break;
			case "COUNT":
				rules.count = parseInt(value);
				break;
			case "UNTIL":
				rules.until = value;
				break;
			case "BYDAY":
				rules.byday = value.split(",");
				break;
			case "BYMONTHDAY":
				rules.bymonthday = value.split(",").map((d) => parseInt(d));
				break;
			case "BYSETPOS":
				rules.bysetpos = value.split(",").map((p) => parseInt(p));
				break;
		}
	}
	return rules;
}

/**
 * Parse a naive datetime string as a "UTC" Date.
 * Event dtstart values like "2026-01-08T19:00:14" are local times (no Z suffix).
 * We treat them as UTC to avoid timezone library dependency.
 * The small timezone offset error is acceptable for week/2week/30day ranges.
 */
function parseAsUtc(dateStr: string): Date {
	if (dateStr.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(dateStr)) {
		return new Date(dateStr);
	}
	return new Date(dateStr + "Z");
}

/** Normalize datetime to YYYY-MM-DDTHH:MM:SS for comparison/dedup. */
function normalizeDateTime(dateStr: string): string {
	return dateStr.slice(0, 19);
}

/**
 * Parse RRULE UNTIL value into a Date.
 * Handles compact formats: 20260301T090000Z, 20260301T090000, 20260301
 */
function parseRRuleUntil(untilStr: string): Date | undefined {
	try {
		if (/^\d{8}T\d{6}Z?$/.test(untilStr)) {
			const iso = `${untilStr.slice(0, 4)}-${untilStr.slice(4, 6)}-${untilStr.slice(6, 8)}` +
				`T${untilStr.slice(9, 11)}:${untilStr.slice(11, 13)}:${untilStr.slice(13, 15)}`;
			return untilStr.endsWith("Z") ? new Date(iso + "Z") : parseAsUtc(iso);
		}
		if (/^\d{8}$/.test(untilStr)) {
			const iso = `${untilStr.slice(0, 4)}-${untilStr.slice(4, 6)}-${
				untilStr.slice(6, 8)
			}T23:59:59`;
			return parseAsUtc(iso);
		}
		return parseAsUtc(untilStr);
	} catch {
		return undefined;
	}
}

/**
 * Get the day-of-month for the Nth occurrence of a weekday in a given month.
 * pos > 0: 1=first, 2=second. pos < 0: -1=last, -2=second-to-last.
 * Returns null if the date doesn't exist in the month.
 */
function getNthWeekdayInMonth(
	year: number,
	month: number,
	weekday: number,
	pos: number,
): number | null {
	if (pos > 0) {
		const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
		let offset = weekday - firstDow;
		if (offset < 0) offset += 7;
		const day = 1 + offset + (pos - 1) * 7;
		if (new Date(Date.UTC(year, month, day)).getUTCMonth() !== month) return null;
		return day;
	} else {
		const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
		const lastDow = new Date(Date.UTC(year, month + 1, 0)).getUTCDay();
		let offset = lastDow - weekday;
		if (offset < 0) offset += 7;
		const day = lastDay - offset + (pos + 1) * 7;
		return day >= 1 ? day : null;
	}
}

/** Advance a UTC date by the given frequency and interval. */
function advanceDate(date: Date, freq: string, interval: number): Date {
	const y = date.getUTCFullYear(), m = date.getUTCMonth(), d = date.getUTCDate();
	const h = date.getUTCHours(), mi = date.getUTCMinutes(), s = date.getUTCSeconds();
	switch (freq) {
		case "DAILY":
			return new Date(Date.UTC(y, m, d + interval, h, mi, s));
		case "WEEKLY":
			return new Date(Date.UTC(y, m, d + 7 * interval, h, mi, s));
		case "MONTHLY":
			return new Date(Date.UTC(y, m + interval, d, h, mi, s));
		case "YEARLY":
			return new Date(Date.UTC(y + interval, m, d, h, mi, s));
		default:
			return date;
	}
}

/** Generate MONTHLY occurrences for BYDAY+BYSETPOS rules (e.g., 2nd Tuesday). */
function generateMonthlyBySetPos(
	dtstart: Date,
	rules: ParsedRRule,
	until: Date,
	maxCount: number,
	out: Date[],
): void {
	const h = dtstart.getUTCHours(), mi = dtstart.getUTCMinutes(), s = dtstart.getUTCSeconds();
	let year = dtstart.getUTCFullYear(), month = dtstart.getUTCMonth();
	let count = 0;

	for (let iter = 0; iter < 500 && count < maxCount; iter++) {
		if (iter > 0) {
			month += rules.interval;
			year += Math.floor(month / 12);
			month = month % 12;
		}
		for (const pos of rules.bysetpos!) {
			for (const byday of rules.byday!) {
				const wd = WEEKDAY_MAP[byday.replace(/^[+-]?\d+/, "")];
				if (wd === undefined) continue;
				const day = getNthWeekdayInMonth(year, month, wd, pos);
				if (day === null) continue;
				const date = new Date(Date.UTC(year, month, day, h, mi, s));
				if (date.getTime() === dtstart.getTime()) continue;
				if (date < dtstart) continue;
				if (date > until) continue;
				count++;
				out.push(date);
				if (count >= maxCount) return;
			}
		}
	}
}

/** Generate MONTHLY occurrences for BYMONTHDAY rules (e.g., 21st of each month). */
function generateMonthlyByMonthDay(
	dtstart: Date,
	rules: ParsedRRule,
	until: Date,
	maxCount: number,
	out: Date[],
): void {
	const h = dtstart.getUTCHours(), mi = dtstart.getUTCMinutes(), s = dtstart.getUTCSeconds();
	let year = dtstart.getUTCFullYear(), month = dtstart.getUTCMonth();
	let count = 0;

	for (let iter = 0; iter < 500 && count < maxCount; iter++) {
		if (iter > 0) {
			month += rules.interval;
			year += Math.floor(month / 12);
			month = month % 12;
		}
		for (const targetDay of rules.bymonthday!) {
			let day: number;
			if (targetDay > 0) {
				day = targetDay;
			} else {
				const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
				day = lastDay + targetDay + 1;
			}
			const date = new Date(Date.UTC(year, month, day, h, mi, s));
			if (date.getUTCMonth() !== month) continue;
			if (date.getTime() === dtstart.getTime()) continue;
			if (date < dtstart) continue;
			if (date > until) continue;
			count++;
			out.push(date);
			if (count >= maxCount) return;
		}
	}
}

/** Generate WEEKLY occurrences for BYDAY rules (e.g., MO,WE,FR). */
function generateWeeklyByDay(
	dtstart: Date,
	rules: ParsedRRule,
	until: Date,
	maxCount: number,
	out: Date[],
): void {
	const targetDays = rules.byday!
		.map((d) => WEEKDAY_MAP[d.replace(/^[+-]?\d+/, "")])
		.filter((w) => w !== undefined)
		.sort((a, b) => a - b);
	const h = dtstart.getUTCHours(), mi = dtstart.getUTCMinutes(), s = dtstart.getUTCSeconds();
	let count = 0;
	let searchDate = new Date(dtstart.getTime() + 86_400_000);

	for (let i = 0; i < 1000 && count < maxCount; i++) {
		if (searchDate > until) break;
		const dow = searchDate.getUTCDay();
		if (targetDays.includes(dow)) {
			count++;
			out.push(
				new Date(Date.UTC(
					searchDate.getUTCFullYear(),
					searchDate.getUTCMonth(),
					searchDate.getUTCDate(),
					h,
					mi,
					s,
				)),
			);
		}
		if (dow === 6 && rules.interval > 1) {
			searchDate = new Date(
				searchDate.getTime() + (rules.interval - 1) * 7 * 86_400_000 + 86_400_000,
			);
		} else {
			searchDate = new Date(searchDate.getTime() + 86_400_000);
		}
	}
}

/**
 * Expand an event's recurrence rules into individual occurrences within a time window.
 */
function expandOccurrences(
	event: NexusEventDetails,
	windowStart: Date,
	windowEnd: Date,
): EventOccurrence[] {
	const isRecurring = !!(event.rrule || (event.rdate && event.rdate.length > 0));
	const locationName = extractLocationName(event.locations);

	if (!isRecurring) {
		const start = parseAsUtc(event.dtstart);
		if (start >= windowStart && start <= windowEnd) {
			return [{
				summary: event.summary,
				description: event.description,
				occurrenceStart: event.dtstart,
				occurrenceEnd: computeOccurrenceEnd(event.dtstart, event),
				uri: event.uri,
				isRecurring: false,
				locationName,
			}];
		}
		return [];
	}

	const dtstart = parseAsUtc(event.dtstart);

	// Build excluded dates set
	const excludedDates = new Set<string>();
	if (event.exdate) {
		for (const ex of event.exdate) {
			if (ex) excludedDates.add(normalizeDateTime(ex));
		}
	}

	// Collect all candidate dates (dtstart is always candidate #1)
	const candidates: Date[] = [dtstart];

	// Generate RRULE occurrences
	if (event.rrule) {
		try {
			const rules = parseRRule(event.rrule);
			if (rules.freq) {
				// RFC 5545: COUNT includes dtstart as #1
				const maxAdditional = rules.count != null ? rules.count - 1 : 500;
				let effectiveUntil = windowEnd;
				if (rules.until) {
					const untilDate = parseRRuleUntil(rules.until);
					if (untilDate && untilDate < effectiveUntil) effectiveUntil = untilDate;
				}

				if (rules.freq === "MONTHLY" && rules.bysetpos && rules.byday) {
					generateMonthlyBySetPos(
						dtstart,
						rules,
						effectiveUntil,
						maxAdditional,
						candidates,
					);
				} else if (rules.freq === "MONTHLY" && rules.bymonthday) {
					generateMonthlyByMonthDay(
						dtstart,
						rules,
						effectiveUntil,
						maxAdditional,
						candidates,
					);
				} else if (rules.freq === "WEEKLY" && rules.byday && rules.byday.length > 0) {
					generateWeeklyByDay(dtstart, rules, effectiveUntil, maxAdditional, candidates);
				} else {
					// Standard DAILY/WEEKLY/MONTHLY/YEARLY
					let generated = 0;
					let current = new Date(dtstart.getTime());
					for (let i = 0; i < 500 && generated < maxAdditional; i++) {
						current = advanceDate(current, rules.freq, rules.interval);
						if (current > effectiveUntil) break;
						generated++;
						candidates.push(new Date(current.getTime()));
					}
				}
			}
		} catch (err) {
			console.error(`Failed to parse RRULE "${event.rrule}" for ${event.uri}:`, err);
		}
	}

	// Add RDATE entries
	if (event.rdate) {
		for (const rd of event.rdate) {
			if (!rd) continue;
			try {
				candidates.push(parseAsUtc(rd));
			} catch {
				// skip unparseable
			}
		}
	}

	// Filter to window, remove excluded, deduplicate, sort
	candidates.sort((a, b) => a.getTime() - b.getTime());
	const seen = new Set<string>();
	const results: EventOccurrence[] = [];

	for (const date of candidates) {
		if (date < windowStart || date > windowEnd) continue;
		const isoStr = date.toISOString().replace(/\.\d{3}Z$/, "");
		const key = normalizeDateTime(isoStr);
		if (excludedDates.has(key)) continue;
		if (seen.has(key)) continue;
		seen.add(key);
		results.push({
			summary: event.summary,
			description: event.description,
			occurrenceStart: isoStr,
			occurrenceEnd: computeOccurrenceEnd(isoStr, event),
			uri: event.uri,
			isRecurring: true,
			locationName,
		});
	}

	return results;
}

// ============================================================================
// Fetching
// ============================================================================

/**
 * Fetch all event URIs for a calendar via the Nexus calendar view endpoint.
 */
async function fetchCalendarEventUris(
	baseUrl: string,
	calendarUri: string,
): Promise<string[]> {
	const parsed = parseCalendarUri(calendarUri);
	if (!parsed) {
		console.error(`Invalid calendar URI: ${calendarUri}`);
		return [];
	}
	const url = `${baseUrl}/v0/calendar/${parsed.authorId}/${parsed.calendarId}`;
	const resp = await fetch(url);
	if (!resp.ok) {
		console.error(`Failed to fetch calendar ${calendarUri}: ${resp.status}`);
		return [];
	}
	const data = (await resp.json()) as NexusCalendarView;
	return data.events || [];
}

/**
 * Fetch a single event's full details from Nexus.
 */
async function fetchEventDetails(
	baseUrl: string,
	eventUri: string,
): Promise<NexusEventDetails | null> {
	const parsed = parseEventUri(eventUri);
	if (!parsed) {
		console.error(`Invalid event URI: ${eventUri}`);
		return null;
	}
	const url = `${baseUrl}/v0/event/${parsed.authorId}/${parsed.eventId}`;
	const resp = await fetch(url);
	if (!resp.ok) {
		console.error(`Failed to fetch event ${eventUri}: ${resp.status}`);
		return null;
	}
	const data = (await resp.json()) as NexusEventView;
	return data.details;
}

/**
 * Fetch events for the specified calendars, expand recurrences, and return
 * occurrences sorted by date within the given time window.
 */
export async function fetchEvents(
	config: MeetupsConfig,
	calendarIndices: number[],
	windowEnd: Date,
): Promise<EventOccurrence[]> {
	const maxEvents = config.maxEvents ?? 10;
	const baseUrl = (config.nexusUrl || "https://nexus.eventky.app").replace(/\/$/, "");
	const windowStart = new Date();
	const calendarsToFetch = calendarIndices.map((i) => config.calendars[i]).filter(Boolean);

	// Step 1: Fetch event URIs from all calendars
	const allEventUris = new Set<string>();
	for (const cal of calendarsToFetch) {
		try {
			const uris = await fetchCalendarEventUris(baseUrl, cal.uri);
			for (const uri of uris) allEventUris.add(uri);
		} catch (err) {
			console.error(`Error fetching calendar ${cal.uri}:`, (err as Error).message);
		}
	}

	if (allEventUris.size === 0) return [];

	// Step 2: Fetch event details in parallel (limit to 30 events max)
	const urisToFetch = [...allEventUris].slice(0, 30);
	const eventPromises = urisToFetch.map((uri) =>
		fetchEventDetails(baseUrl, uri).catch((err) => {
			console.error(`Error fetching event ${uri}:`, (err as Error).message);
			return null;
		})
	);
	const events = (await Promise.all(eventPromises)).filter(
		(e): e is NexusEventDetails => e !== null,
	);

	// Step 3: Filter to CONFIRMED events (or events without status)
	const confirmed = events.filter((e) => !e.status || e.status === "CONFIRMED");

	// Step 4: Expand recurrences and collect all occurrences in the window
	const allOccurrences: EventOccurrence[] = [];
	for (const event of confirmed) {
		const occurrences = expandOccurrences(event, windowStart, windowEnd);
		allOccurrences.push(...occurrences);
	}

	// Step 5: Sort by occurrence date ascending
	allOccurrences.sort((a, b) => {
		return new Date(a.occurrenceStart).getTime() - new Date(b.occurrenceStart).getTime();
	});

	// Step 6: Deduplicate by event URI + occurrence date, then limit
	const seen = new Set<string>();
	const unique: EventOccurrence[] = [];
	for (const occ of allOccurrences) {
		const key = `${occ.uri}|${occ.occurrenceStart}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(occ);
		if (unique.length >= maxEvents) break;
	}

	return unique;
}

// ============================================================================
// Keyboard Builders
// ============================================================================

function buildCalendarKeyboard(
	calendars: MeetupsConfig["calendars"],
	serviceId: string,
) {
	const keyboard = UIBuilder.keyboard().namespace(serviceId);
	for (const [idx, cal] of calendars.entries()) {
		keyboard.callback(cal.name || `Calendar ${idx + 1}`, `cal:${idx}`);
		keyboard.row();
	}
	if (calendars.length > 1) {
		keyboard.callback("All Calendars", "cal:all");
		keyboard.row();
	}
	keyboard.callback("\u2716 Close", "close");
	return keyboard.build();
}

function buildTimelineKeyboard(
	options: TimelineRangeId[],
	showBack: boolean,
	serviceId: string,
) {
	const keyboard = UIBuilder.keyboard().namespace(serviceId);
	for (const opt of options) {
		keyboard.callback(TIMELINE_LABELS[opt], `time:${opt}`);
		keyboard.row();
	}
	if (showBack) {
		keyboard.callback("\u2190 Back", "back:cal");
	}
	keyboard.callback("\u2716 Close", "close");
	return keyboard.build();
}

function buildEventListKeyboard(
	hasMultipleCalendars: boolean,
	serviceId: string,
) {
	const keyboard = UIBuilder.keyboard().namespace(serviceId);
	keyboard.callback("\u2190 Change timeframe", "back:time");
	keyboard.row();
	if (hasMultipleCalendars) {
		keyboard.callback("\u2190 Change calendar", "back:cal");
		keyboard.row();
	}
	keyboard.callback("\u2716 Close", "close");
	return keyboard.build();
}

// ============================================================================
// Service Definition
// ============================================================================

const service = defineService({
	id: MEETUPS_SERVICE_ID,
	version: MEETUPS_VERSION,
	kind: "command_flow",
	command: MEETUPS_COMMAND,
	description: "Display upcoming events from Pubky calendars",
	configSchema: MEETUPS_CONFIG_SCHEMA,
	datasetSchemas: MEETUPS_DATASET_SCHEMAS,
	net: ["nexus.eventky.app"],
	handlers: {
		command: (ev: CommandEvent) => {
			const rawConfig = ev.serviceConfig || {};
			const config: MeetupsConfig = { ...DEFAULT_CONFIG, ...rawConfig } as MeetupsConfig;

			if (!config.calendars?.length) {
				return uiKeyboard(
					UIBuilder.keyboard().namespace(MEETUPS_SERVICE_ID)
						.callback("\u2716 Close", "close").build(),
					"Meetups service is not configured. Please set at least one calendar URI.",
					{
						state: state.replace({}),
						options: { parse_mode: "HTML", replaceGroup: MEETUPS_REPLACE_GROUP },
					},
				);
			}

			const hasMultiple = config.calendars.length > 1;

			if (hasMultiple) {
				// Show calendar picker
				const kb = buildCalendarKeyboard(config.calendars, MEETUPS_SERVICE_ID);
				return uiKeyboard(kb, "Select a calendar:", {
					state: state.replace({}),
					options: { parse_mode: "HTML", replaceGroup: MEETUPS_REPLACE_GROUP },
				});
			}

			// Single calendar — skip to timeline picker
			const timeOpts = config.timelineOptions ?? DEFAULT_TIMELINE_OPTIONS;
			const kb = buildTimelineKeyboard(timeOpts, false, MEETUPS_SERVICE_ID);
			return uiKeyboard(kb, "Select a time range:", {
				state: state.replace({ selectedCalendar: 0 }),
				options: { parse_mode: "HTML", replaceGroup: MEETUPS_REPLACE_GROUP },
			});
		},

		callback: async (ev: CallbackEvent) => {
			const data = ev.data;
			const rawConfig = ev.serviceConfig || {};
			const config: MeetupsConfig = { ...DEFAULT_CONFIG, ...rawConfig } as MeetupsConfig;
			const currentState = (ev.state || {}) as MeetupsState;
			const hasMultiple = (config.calendars?.length ?? 0) > 1;
			const timeOpts = config.timelineOptions ?? DEFAULT_TIMELINE_OPTIONS;

			// Close — delete message
			if (data === "close") {
				return del();
			}

			// Back to calendar picker
			if (data === "back:cal") {
				const kb = buildCalendarKeyboard(config.calendars, MEETUPS_SERVICE_ID);
				return uiKeyboard(kb, "Select a calendar:", {
					state: state.replace({}),
					options: { parse_mode: "HTML", replaceGroup: MEETUPS_REPLACE_GROUP },
				});
			}

			// Back to timeline picker (preserves selectedCalendar)
			if (data === "back:time") {
				const kb = buildTimelineKeyboard(timeOpts, hasMultiple, MEETUPS_SERVICE_ID);
				return uiKeyboard(kb, "Select a time range:", {
					state: state.replace({ selectedCalendar: currentState.selectedCalendar }),
					options: { parse_mode: "HTML", replaceGroup: MEETUPS_REPLACE_GROUP },
				});
			}

			// Calendar selection
			const calMatch = /^cal:(.+)$/.exec(data);
			if (calMatch) {
				const val = calMatch[1];
				const selectedCalendar: number | "all" = val === "all" ? "all" : Number(val);
				const kb = buildTimelineKeyboard(timeOpts, hasMultiple, MEETUPS_SERVICE_ID);
				return uiKeyboard(kb, "Select a time range:", {
					state: state.replace({ selectedCalendar }),
					options: { parse_mode: "HTML", replaceGroup: MEETUPS_REPLACE_GROUP },
				});
			}

			// Timeline selection — fetch and display events
			const timeMatch = /^time:(.+)$/.exec(data);
			if (timeMatch) {
				const rangeId = timeMatch[1] as TimelineRangeId;
				const windowEnd = computeEndDate(rangeId);
				const selectedCalendar = currentState.selectedCalendar ?? 0;

				// Determine which calendar indices to fetch
				const calendarIndices: number[] = selectedCalendar === "all"
					? config.calendars.map((_, i) => i)
					: [selectedCalendar as number];

				try {
					const occurrences = await fetchEvents(config, calendarIndices, windowEnd);
					const header = buildCalendarHeader(config, selectedCalendar);
					const rangeLabel = TIMELINE_LABELS[rangeId] || rangeId;
					const linkBaseUrl = config.linkEvents !== false
						? (config.eventkyBaseUrl || "https://eventky.app")
						: undefined;
					const eventList = formatEventsMessage(occurrences, rangeLabel, linkBaseUrl);
					const text = header + eventList;
					const kb = buildEventListKeyboard(hasMultiple, MEETUPS_SERVICE_ID);

					return uiKeyboard(kb, text, {
						state: state.replace({ selectedCalendar, timeRange: rangeId }),
						options: {
							parse_mode: "HTML",
							disable_web_page_preview: true,
							replaceGroup: MEETUPS_REPLACE_GROUP,
						},
					});
				} catch (err) {
					console.error("Meetups fetch error:", (err as Error).message);
					const kb = buildEventListKeyboard(hasMultiple, MEETUPS_SERVICE_ID);
					return uiKeyboard(kb, "Failed to fetch upcoming events. Please try again.", {
						state: state.replace(currentState),
						options: { parse_mode: "HTML", replaceGroup: MEETUPS_REPLACE_GROUP },
					});
				}
			}

			return none();
		},

		message: (_ev: MessageEvent) => none(),
	},
});

export default service;
if (import.meta.main) await runService(service);
