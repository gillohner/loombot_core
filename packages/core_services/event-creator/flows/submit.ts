// packages/core_services/event-creator/flows/submit.ts
// Event submission and approval flow

import { createEvent, type Location, validateTimezone } from "@eventky/mod.ts";
import { type CallbackEvent, error, pubkyWrite, state } from "@sdk/mod.ts";
import { DEFAULT_RETURN_TEMPLATE } from "../constants.ts";
import type { EventCreatorConfig, EventCreatorState } from "../types.ts";
import { getAllCalendarUris } from "../utils/calendar.ts";
import { applyTemplate, buildEventUrl, formatDateTime } from "../utils/formatting.ts";
import { buildAdminPreview } from "../utils/preview.ts";
import { canSubmit } from "../utils/state.ts";

export function handleSubmit(ev: CallbackEvent) {
	const st = (ev.state ?? {}) as EventCreatorState;
	const config = (ev.serviceConfig ?? {}) as EventCreatorConfig;

	// Validate can submit
	const submitCheck = canSubmit(st, config);
	if (!submitCheck.canSubmit) {
		return error(submitCheck.error || "Cannot submit event");
	}

	// Validate timezone if provided
	if (config.defaultTimezone && !validateTimezone(config.defaultTimezone)) {
		return error(`Invalid timezone: ${config.defaultTimezone}`);
	}

	// Format the datetime
	const dtstart = formatDateTime(st.startDate!, st.startTime!);

	// Build dtend if provided
	const dtend = st.endDate && st.endTime ? formatDateTime(st.endDate, st.endTime) : undefined;

	// Build locations array if location provided
	const locations: Location[] | undefined = st.location?.name
		? [
			{
				name: st.location.name,
				location_type: (st.location.location_type ?? "PHYSICAL") as "PHYSICAL" | "ONLINE",
				description: st.location.address,
				structured_data: st.location.structured_data,
			},
		]
		: undefined;

	// Get all calendar URIs
	const calendarUris = getAllCalendarUris(st, config);

	// Create the event using eventky-specs
	const result = createEvent({
		summary: st.title!,
		dtstart,
		dtend,
		description: st.description,
		dtstart_tzid: config.defaultTimezone,
		dtend_tzid: dtend ? config.defaultTimezone : undefined,
		x_pubky_calendar_uris: calendarUris.length > 0 ? calendarUris : undefined,
		locations,
		// image_uri will be added by PubkyWriter after upload
	});

	// Build preview for admin approval
	const preview = buildAdminPreview(result.event, st, config);

	// Build return message with eventky.app URL
	const userId = ev.botPublicKey;
	if (!userId) {
		return error("Bot public key not available");
	}

	const eventUrl = buildEventUrl(userId, result.meta.id);
	const returnMessage = applyTemplate(
		config.returnMessageTemplate || DEFAULT_RETURN_TEMPLATE,
		{
			url: eventUrl,
			title: st.title!,
			date: st.startDate!,
			time: st.startTime!,
		},
	);

	// Prepare data for PubkyWriter
	// If image is present, use metadata structure for PubkyWriter enhancement
	const writeData = st.imageFileId
		? {
			__image_file_id: st.imageFileId,
			__event_data: result.event,
		}
		: result.event;

	// Submit for Pubky write with admin approval
	return pubkyWrite(result.meta.path, writeData, {
		preview,
		onApprovalMessage: returnMessage,
		state: state.clear(),
	});
}
