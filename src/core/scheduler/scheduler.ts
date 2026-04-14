// src/core/scheduler/scheduler.ts
// Periodic meetups scheduler — auto-broadcasts "this week's events" on a configurable schedule.
// Uses direct host invocation (imports fetchEvents from the meetups service module).

import { log } from "@core/util/logger.ts";
import { listKnownChatIds } from "@core/config/store.ts";
import { buildSnapshot } from "@core/snapshot/snapshot.ts";
import { fetchEvents } from "../../../packages/core_services/meetups/service.ts";
import {
	buildCalendarHeader,
	computeEndDate,
	DEFAULT_CONFIG,
	formatEventsMessage,
	MEETUPS_SERVICE_ID,
	type MeetupsConfig,
	type TimelineRangeId,
} from "../../../packages/core_services/meetups/constants.ts";
import {
	clearPinnedMessage,
	getLastFired,
	getPinnedMessage,
	savePinnedMessage,
	setLastFired,
} from "./pin_store.ts";

const INTERVAL_MS = 60_000; // 60 seconds

interface SchedulerBotApi {
	sendMessage(
		chatId: string | number,
		text: string,
		options?: { parse_mode?: string; disable_web_page_preview?: boolean },
	): Promise<{ message_id: number }>;
	pinChatMessage(
		chatId: string | number,
		messageId: number,
		options?: { disable_notification?: boolean },
	): Promise<unknown>;
	unpinChatMessage(
		chatId: string | number,
		messageId: number,
	): Promise<unknown>;
}

/**
 * Get the current day-of-week and hour in the given IANA timezone.
 */
function getCurrentDayHour(timezone: string): { day: number; hour: number } {
	const now = new Date();
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		weekday: "short",
		hour: "numeric",
		hour12: false,
	}).formatToParts(now);

	const weekdayMap: Record<string, number> = {
		Sun: 0,
		Mon: 1,
		Tue: 2,
		Wed: 3,
		Thu: 4,
		Fri: 5,
		Sat: 6,
	};

	let day = 0;
	let hour = 0;
	for (const part of parts) {
		if (part.type === "weekday") {
			day = weekdayMap[part.value] ?? 0;
		} else if (part.type === "hour") {
			hour = parseInt(part.value, 10);
			// Intl hour12:false can return 24 for midnight
			if (hour === 24) hour = 0;
		}
	}
	return { day, hour };
}

/**
 * Build a slot string for the last-fired guard (date + hour in the target timezone).
 */
function currentSlot(timezone: string): string {
	const now = new Date();
	const fmt = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		hour12: false,
	});
	const parts = fmt.formatToParts(now);
	let y = "", m = "", d = "", h = "";
	for (const p of parts) {
		if (p.type === "year") y = p.value;
		else if (p.type === "month") m = p.value;
		else if (p.type === "day") d = p.value;
		else if (p.type === "hour") h = p.value;
	}
	return `${y}-${m}-${d}T${h}`;
}

async function runPeriodicBroadcast(
	chatId: string,
	botApi: SchedulerBotApi,
	opts: { force: boolean },
): Promise<void> {
	// 1. Build snapshot for this chat
	let snapshot;
	try {
		snapshot = await buildSnapshot(chatId);
	} catch (err) {
		log.debug("scheduler.periodic.snapshot_error", {
			chatId,
			error: (err as Error).message,
		});
		if (opts.force) throw err;
		return;
	}

	// 2. Find the meetups route
	let meetupsConfig: MeetupsConfig | null = null;
	for (const route of Object.values(snapshot.commands)) {
		if (route.serviceId === MEETUPS_SERVICE_ID) {
			meetupsConfig = {
				...DEFAULT_CONFIG,
				...(route.config as Partial<MeetupsConfig>),
			} as MeetupsConfig;
			break;
		}
	}
	if (!meetupsConfig) {
		if (opts.force) throw new Error("meetups feature not enabled in this chat");
		return;
	}

	const timezone = meetupsConfig.periodicTimezone ?? "Europe/Zurich";

	// 3. Schedule guards — skipped in force mode so the /config preview button works.
	if (!opts.force) {
		if (!meetupsConfig.periodicEnabled) return;

		const targetDay = meetupsConfig.periodicDay ?? 1;
		const targetHour = meetupsConfig.periodicHour ?? 7;

		const { day, hour } = getCurrentDayHour(timezone);
		if (day !== targetDay || hour !== targetHour) return;

		const slot = currentSlot(timezone);
		const lastFired = await getLastFired(chatId);
		if (lastFired === slot) return;

		log.info("scheduler.periodic.firing", { chatId, slot, timezone });
	} else {
		log.info("scheduler.periodic.preview", { chatId, timezone });
	}

	// 4. Fetch events — use all calendars currently merged onto this chat's route.
	const rangeId: TimelineRangeId = meetupsConfig.periodicRange ?? "week";
	const windowEnd = computeEndDate(rangeId);
	const allCalendarIndices = meetupsConfig.calendars.map((_: unknown, i: number) => i);

	const occurrences = await fetchEvents(meetupsConfig, allCalendarIndices, windowEnd);

	// 5. Format message
	const header = buildCalendarHeader(meetupsConfig, "all");
	const linkBaseUrl = meetupsConfig.linkEvents !== false
		? (meetupsConfig.eventkyBaseUrl || "https://eventky.app")
		: undefined;
	const rangeLabel = rangeId === "today"
		? "Today"
		: rangeId === "week"
		? "This week"
		: rangeId === "2weeks"
		? "Next 2 weeks"
		: "Next 30 days";
	const eventList = formatEventsMessage(occurrences, rangeLabel, linkBaseUrl);
	const text = header + eventList;

	// 6. Unpin previous message if configured
	const shouldPin = meetupsConfig.periodicPin !== false;
	const shouldUnpin = meetupsConfig.periodicUnpinPrevious !== false;

	if (shouldUnpin) {
		const prevMsgId = await getPinnedMessage(chatId);
		if (prevMsgId !== null) {
			try {
				await botApi.unpinChatMessage(chatId, prevMsgId);
				log.info("scheduler.periodic.unpinned", { chatId, messageId: prevMsgId });
			} catch (err) {
				log.debug("scheduler.periodic.unpin_failed", {
					chatId,
					messageId: prevMsgId,
					error: (err as Error).message,
				});
			}
			await clearPinnedMessage(chatId);
		}
	}

	// 7. Send message
	const sent = await botApi.sendMessage(chatId, text, {
		parse_mode: "HTML",
		disable_web_page_preview: meetupsConfig.disableLinkPreview !== false,
	});

	log.info("scheduler.periodic.sent", { chatId, messageId: sent.message_id });

	// 8. Pin if configured
	if (shouldPin) {
		try {
			await botApi.pinChatMessage(chatId, sent.message_id, {
				disable_notification: true,
			});
			await savePinnedMessage(chatId, sent.message_id);
			log.info("scheduler.periodic.pinned", { chatId, messageId: sent.message_id });
		} catch (err) {
			log.debug("scheduler.periodic.pin_failed", {
				chatId,
				messageId: sent.message_id,
				error: (err as Error).message,
			});
		}
	}

	// 9. Update last-fired guard (only for real scheduled fires, not previews).
	if (!opts.force) {
		const slot = currentSlot(timezone);
		await setLastFired(chatId, slot);
	}
}

async function processChatPeriodic(chatId: string, botApi: SchedulerBotApi): Promise<void> {
	await runPeriodicBroadcast(chatId, botApi, { force: false });
}

/**
 * Fire a periodic broadcast immediately for this chat, bypassing the
 * enabled / schedule / last-fired guards. Used by the /config preview button
 * so admins can test settings without waiting for the scheduled slot.
 */
export async function runPeriodicNow(
	chatId: string,
	botApi: SchedulerBotApi,
): Promise<void> {
	await runPeriodicBroadcast(chatId, botApi, { force: true });
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startScheduler(botApi: SchedulerBotApi): void {
	if (intervalId !== null) return;

	log.info("scheduler.started", { intervalMs: INTERVAL_MS });

	intervalId = setInterval(async () => {
		let chatIds: string[];
		try {
			chatIds = listKnownChatIds();
		} catch (err) {
			log.error("scheduler.list_chats_error", { error: (err as Error).message });
			return;
		}

		for (const chatId of chatIds) {
			try {
				await processChatPeriodic(chatId, botApi);
			} catch (err) {
				log.error("scheduler.periodic.error", {
					chatId,
					error: (err as Error).message,
				});
			}
		}
	}, INTERVAL_MS);
}

export function stopScheduler(): void {
	if (intervalId !== null) {
		clearInterval(intervalId);
		intervalId = null;
		log.info("scheduler.stopped");
	}
}
