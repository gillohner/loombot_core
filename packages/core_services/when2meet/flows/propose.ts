// packages/core_services/when2meet/flows/propose.ts
// Slot-proposal flow. The organizer types a title, then each slot is built
// via three quick-pick keyboards (date → start time → duration); the end
// date/time is computed automatically from start + duration. Each picker
// step keeps a typed-text fallback for users who want full control, and a
// "Multi-day" duration branch lets you set an explicit end date/time.
//
// State shape while a slot is being built:
//   phase: "slot_date_pick" | "slot_time_pick" | "slot_duration_pick" | ...
//   current: { startDate?, startTime?, endDate?, endTime? }
// When all four fields on `current` are set, the slot is pushed into
// `slots` and we return to the review menu.

import {
	type CallbackEvent,
	escapeHtml,
	type MessageEvent,
	none,
	pollPublish,
	reply,
	state,
	UIBuilder,
	uiKeyboard,
} from "@sdk/mod.ts";
import {
	CB_ADD_SLOT,
	CB_CANCEL,
	CB_DATE_PREFIX,
	CB_DUR_LATE,
	CB_DUR_MULTI,
	CB_DUR_PREFIX,
	CB_OTHER,
	CB_PUBLISH,
	CB_TIME_PREFIX,
	DATE_SUGGESTION_COUNT,
	DURATION_LATE_END_TIME,
	DURATION_SUGGESTIONS,
	MAX_SLOTS,
	MAX_TITLE_LENGTH,
	MIN_SLOTS,
	REVIEW_REPLACE_GROUP,
	SLOT_REPLACE_GROUP,
	TIME_SUGGESTIONS,
	WHEN2MEET_SERVICE_ID,
} from "../constants.ts";
import type { Slot, When2meetPhase, When2meetState } from "../types.ts";
import { tev, tfor } from "../utils/i18n.ts";
import {
	normalizeDate,
	parseDateParts,
	validateDate,
	validateEndDateNotBeforeStart,
	validateEndTimeAfterStart,
	validateTime,
} from "../utils/validation.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSlots(st: When2meetState): Slot[] {
	return Array.isArray(st.slots) ? st.slots : [];
}

function effectiveMaxSlots(ev: MessageEvent | CallbackEvent): number {
	const cfg = (ev.serviceConfig ?? {}) as { maxSlots?: number };
	const m = typeof cfg.maxSlots === "number" ? cfg.maxSlots : MAX_SLOTS;
	return Math.max(MIN_SLOTS, Math.min(10, m));
}

function formatSlotShort(slot: Slot): string {
	if (slot.startDate === slot.endDate) {
		return `${slot.startDate} ${slot.startTime}–${slot.endTime}`;
	}
	return `${slot.startDate} ${slot.startTime} → ${slot.endDate} ${slot.endTime}`;
}

/** DD.MM.YYYY → Date object (local time, noon). */
function ddmmyyyyToDate(ddmmyyyy: string): Date | null {
	const p = parseDateParts(ddmmyyyy);
	if (!p) return null;
	const d = new Date(p.year, p.month - 1, p.day, 12, 0, 0, 0);
	if (
		d.getFullYear() !== p.year || d.getMonth() !== p.month - 1 || d.getDate() !== p.day
	) return null;
	return d;
}

/** Date object → DD.MM.YYYY. */
function dateToDdmmyyyy(d: Date): string {
	const dd = String(d.getDate()).padStart(2, "0");
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const yyyy = d.getFullYear();
	return `${dd}.${mm}.${yyyy}`;
}

function weekdayLabel(d: Date, locale: string | undefined): string {
	try {
		return d.toLocaleDateString(locale === "de" ? "de-DE" : "en-US", { weekday: "short" });
	} catch {
		return "";
	}
}

function buildDateSuggestions(): Date[] {
	const out: Date[] = [];
	const now = new Date();
	now.setHours(12, 0, 0, 0);
	for (let i = 0; i < DATE_SUGGESTION_COUNT; i++) {
		const d = new Date(now);
		d.setDate(now.getDate() + i);
		out.push(d);
	}
	return out;
}

function addMinutesToDateTime(
	startDate: string,
	startTime: string,
	minutes: number,
): { endDate: string; endTime: string } | null {
	const d = ddmmyyyyToDate(startDate);
	if (!d) return null;
	const [h, m] = startTime.split(":").map(Number);
	if (Number.isNaN(h) || Number.isNaN(m)) return null;
	d.setHours(h, m, 0, 0);
	d.setMinutes(d.getMinutes() + minutes);
	const endDate = dateToDdmmyyyy(d);
	const endTime = `${String(d.getHours()).padStart(2, "0")}:${
		String(d.getMinutes()).padStart(2, "0")
	}`;
	return { endDate, endTime };
}

// ---------------------------------------------------------------------------
// Title input (unchanged from original)
// ---------------------------------------------------------------------------

export function handleTitleInput(text: string, st: When2meetState, ev: MessageEvent) {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return reply(tev(ev, "title.empty"));
	}
	if (trimmed.length > MAX_TITLE_LENGTH) {
		return reply(tev(ev, "title.too_long", { max: MAX_TITLE_LENGTH }));
	}
	const nextState: When2meetState = {
		...st,
		phase: "slot_date_pick",
		title: trimmed,
		slots: [],
		current: {},
	};
	return showDatePicker(nextState, ev, {
		headerPrefix: tev(ev, "title.ok", { title: escapeHtml(trimmed) }) + "\n\n",
	});
}

// ---------------------------------------------------------------------------
// Slot date picker
// ---------------------------------------------------------------------------

export function showDatePicker(
	st: When2meetState,
	ev: MessageEvent | CallbackEvent,
	extras?: { headerPrefix?: string },
) {
	const slots = getSlots(st);
	const index = slots.length + 1;
	const maxSlots = effectiveMaxSlots(ev);
	const dates = buildDateSuggestions();

	const keyboard = UIBuilder.keyboard().namespace(WHEN2MEET_SERVICE_ID);
	for (let i = 0; i < dates.length; i++) {
		const d = dates[i];
		let label: string;
		if (i === 0) label = tev(ev, "pick.today");
		else if (i === 1) label = tev(ev, "pick.tomorrow");
		else {
			const wd = weekdayLabel(d, ev.language);
			const dd = String(d.getDate()).padStart(2, "0");
			const mm = String(d.getMonth() + 1).padStart(2, "0");
			label = `${wd} ${dd}.${mm}`.trim();
		}
		keyboard.callback(label, `${CB_DATE_PREFIX}${i}`);
		if (i % 2 === 1) keyboard.row();
	}
	if (dates.length % 2 === 1) keyboard.row();
	keyboard.callback(tev(ev, "pick.other_date"), `${CB_DATE_PREFIX}${CB_OTHER}`).row();
	keyboard.callback(tev(ev, "pick.cancel"), CB_CANCEL, "danger");

	const header = (extras?.headerPrefix ?? "") +
		tev(ev, "pick.date_header", { index, max: maxSlots });

	return uiKeyboard(keyboard.build(), header, {
		state: state.replace(st as Record<string, unknown>),
		options: { parse_mode: "HTML", replaceGroup: SLOT_REPLACE_GROUP },
	});
}

function applyDatePick(st: When2meetState, ev: CallbackEvent, isoDate: string) {
	const nextState: When2meetState = {
		...st,
		phase: "slot_time_pick",
		current: { ...(st.current ?? {}), startDate: isoDate },
	};
	return showTimePicker(nextState, ev);
}

export function handleDateCallback(ev: CallbackEvent, payload: string) {
	const st = (ev.state ?? {}) as When2meetState;
	if (payload === CB_OTHER) {
		return reply(tev(ev, "pick.type_date"), {
			state: state.merge({ phase: "slot_date_pick" as When2meetPhase }),
			options: { parse_mode: "HTML", cleanupGroup: SLOT_REPLACE_GROUP },
		});
	}
	const idx = parseInt(payload, 10);
	if (Number.isNaN(idx) || idx < 0 || idx >= DATE_SUGGESTION_COUNT) {
		return showDatePicker(st, ev);
	}
	const dates = buildDateSuggestions();
	const iso = dateToDdmmyyyy(dates[idx]);
	return applyDatePick(st, ev, iso);
}

// Typed-date fallback (user typed instead of tapping).
export function handleDateText(text: string, st: When2meetState, ev: MessageEvent) {
	const validation = validateDate(text.trim(), ev.language);
	if (!validation.valid) return reply(validation.error!);
	const normalized = normalizeDate(text.trim()) ?? text.trim();
	const nextState: When2meetState = {
		...st,
		phase: "slot_time_pick",
		current: { ...(st.current ?? {}), startDate: normalized },
	};
	return showTimePicker(nextState, ev);
}

// ---------------------------------------------------------------------------
// Slot start-time picker
// ---------------------------------------------------------------------------

export function showTimePicker(
	st: When2meetState,
	ev: MessageEvent | CallbackEvent,
) {
	const dateLabel = st.current?.startDate ?? "";

	const keyboard = UIBuilder.keyboard().namespace(WHEN2MEET_SERVICE_ID);
	TIME_SUGGESTIONS.forEach((t, i) => {
		keyboard.callback(t, `${CB_TIME_PREFIX}${t}`);
		if (i % 4 === 3) keyboard.row();
	});
	if (TIME_SUGGESTIONS.length % 4 !== 0) keyboard.row();
	keyboard.callback(tev(ev, "pick.other_time"), `${CB_TIME_PREFIX}${CB_OTHER}`).row();
	keyboard.callback(tev(ev, "pick.cancel"), CB_CANCEL, "danger");

	return uiKeyboard(
		keyboard.build(),
		tev(ev, "pick.time_header", { date: escapeHtml(dateLabel) }),
		{
			state: state.replace(st as Record<string, unknown>),
			options: { parse_mode: "HTML", replaceGroup: SLOT_REPLACE_GROUP },
		},
	);
}

export function handleTimeCallback(ev: CallbackEvent, payload: string) {
	const st = (ev.state ?? {}) as When2meetState;
	if (payload === CB_OTHER) {
		return reply(tev(ev, "pick.type_time"), {
			state: state.merge({ phase: "slot_time_pick" as When2meetPhase }),
			options: { parse_mode: "HTML", cleanupGroup: SLOT_REPLACE_GROUP },
		});
	}
	const validation = validateTime(payload, ev.language);
	if (!validation.valid) return showTimePicker(st, ev);
	return advanceToDurationPicker(st, ev, payload);
}

export function handleTimeText(text: string, st: When2meetState, ev: MessageEvent) {
	const validation = validateTime(text.trim(), ev.language);
	if (!validation.valid) return reply(validation.error!);
	return advanceToDurationPicker(st, ev, text.trim());
}

function advanceToDurationPicker(
	st: When2meetState,
	ev: MessageEvent | CallbackEvent,
	startTime: string,
) {
	const nextState: When2meetState = {
		...st,
		phase: "slot_duration_pick",
		current: { ...(st.current ?? {}), startTime },
	};
	return showDurationPicker(nextState, ev);
}

// ---------------------------------------------------------------------------
// Slot duration picker
// ---------------------------------------------------------------------------

export function showDurationPicker(
	st: When2meetState,
	ev: MessageEvent | CallbackEvent,
) {
	const current = st.current ?? {};

	const keyboard = UIBuilder.keyboard().namespace(WHEN2MEET_SERVICE_ID);
	DURATION_SUGGESTIONS.forEach((d, i) => {
		keyboard.callback(d.label, `${CB_DUR_PREFIX}${d.minutes}`);
		if (i % 3 === 2) keyboard.row();
	});
	if (DURATION_SUGGESTIONS.length % 3 !== 0) keyboard.row();
	keyboard
		.callback(tev(ev, "pick.until_late"), `${CB_DUR_PREFIX}${CB_DUR_LATE}`)
		.callback(tev(ev, "pick.multi_day"), `${CB_DUR_PREFIX}${CB_DUR_MULTI}`)
		.row()
		.callback(tev(ev, "pick.other_duration"), `${CB_DUR_PREFIX}${CB_OTHER}`)
		.row()
		.callback(tev(ev, "pick.cancel"), CB_CANCEL, "danger");

	return uiKeyboard(
		keyboard.build(),
		tev(ev, "pick.duration_header", {
			date: escapeHtml(current.startDate ?? ""),
			time: escapeHtml(current.startTime ?? ""),
		}),
		{
			state: state.replace(st as Record<string, unknown>),
			options: { parse_mode: "HTML", replaceGroup: SLOT_REPLACE_GROUP },
		},
	);
}

export function handleDurationCallback(ev: CallbackEvent, payload: string) {
	const st = (ev.state ?? {}) as When2meetState;
	const current = st.current ?? {};
	if (!current.startDate || !current.startTime) {
		return showDatePicker(st, ev);
	}

	if (payload === CB_OTHER) {
		return reply(tev(ev, "pick.type_end_time"), {
			state: state.merge({ phase: "slot_end_time_text" as When2meetPhase }),
			options: { parse_mode: "HTML", cleanupGroup: SLOT_REPLACE_GROUP },
		});
	}

	if (payload === CB_DUR_MULTI) {
		return reply(tev(ev, "pick.type_end_date"), {
			state: state.merge({ phase: "slot_end_date_text" as When2meetPhase }),
			options: { parse_mode: "HTML", cleanupGroup: SLOT_REPLACE_GROUP },
		});
	}

	if (payload === CB_DUR_LATE) {
		// Same day, end at DURATION_LATE_END_TIME. Validate that end > start;
		// if start is already >= 22:00 we fall through to asking for manual input.
		const endCheck = validateEndTimeAfterStart(
			current.startDate,
			current.startTime,
			current.startDate,
			DURATION_LATE_END_TIME,
			ev.language,
		);
		if (!endCheck.valid) {
			return reply(tev(ev, "pick.type_end_time"), {
				state: state.merge({ phase: "slot_end_time_text" as When2meetPhase }),
				options: { parse_mode: "HTML", cleanupGroup: SLOT_REPLACE_GROUP },
			});
		}
		return commitSlot(st, ev, {
			endDate: current.startDate,
			endTime: DURATION_LATE_END_TIME,
		});
	}

	const minutes = parseInt(payload, 10);
	if (Number.isNaN(minutes) || minutes <= 0) {
		return showDurationPicker(st, ev);
	}
	const end = addMinutesToDateTime(current.startDate, current.startTime, minutes);
	if (!end) return showDurationPicker(st, ev);
	return commitSlot(st, ev, { endDate: end.endDate, endTime: end.endTime });
}

// Typed end-time fallback after "Other" duration → same-day end time.
export function handleDurationText(text: string, st: When2meetState, ev: MessageEvent) {
	const current = st.current ?? {};
	if (!current.startDate || !current.startTime) {
		return showDatePicker(st, ev);
	}
	const validation = validateTime(text.trim(), ev.language);
	if (!validation.valid) return reply(validation.error!);
	const orderCheck = validateEndTimeAfterStart(
		current.startDate,
		current.startTime,
		current.startDate,
		text.trim(),
		ev.language,
	);
	if (!orderCheck.valid) return reply(orderCheck.error!);
	return commitSlot(st, ev, { endDate: current.startDate, endTime: text.trim() });
}

// ---------------------------------------------------------------------------
// Multi-day end-date + end-time text path
// ---------------------------------------------------------------------------

export function handleEndDateText(text: string, st: When2meetState, ev: MessageEvent) {
	const validation = validateDate(text.trim(), ev.language);
	if (!validation.valid) return reply(validation.error!);
	const normalized = normalizeDate(text.trim()) ?? text.trim();
	const startDate = st.current?.startDate;
	if (startDate) {
		const rangeCheck = validateEndDateNotBeforeStart(startDate, normalized, ev.language);
		if (!rangeCheck.valid) return reply(rangeCheck.error!);
	}
	return reply(tev(ev, "pick.type_end_time"), {
		state: state.merge({
			phase: "slot_end_time_text" as When2meetPhase,
			current: { ...(st.current ?? {}), endDate: normalized },
		}),
	});
}

export function handleEndTimeText(text: string, st: When2meetState, ev: MessageEvent) {
	const current = st.current ?? {};
	if (!current.startDate || !current.startTime) {
		return showDatePicker(st, ev);
	}
	const validation = validateTime(text.trim(), ev.language);
	if (!validation.valid) return reply(validation.error!);
	const endDate = current.endDate ?? current.startDate;
	const orderCheck = validateEndTimeAfterStart(
		current.startDate,
		current.startTime,
		endDate,
		text.trim(),
		ev.language,
	);
	if (!orderCheck.valid) return reply(orderCheck.error!);
	return commitSlot(st, ev, { endDate, endTime: text.trim() });
}

// ---------------------------------------------------------------------------
// Commit slot + review menu
// ---------------------------------------------------------------------------

function commitSlot(
	st: When2meetState,
	ev: MessageEvent | CallbackEvent,
	end: { endDate: string; endTime: string },
) {
	const current = st.current ?? {};
	if (!current.startDate || !current.startTime) {
		return showDatePicker(st, ev);
	}
	const newSlot: Slot = {
		startDate: current.startDate,
		startTime: current.startTime,
		endDate: end.endDate,
		endTime: end.endTime,
	};
	const nextSlots = [...getSlots(st), newSlot];
	const nextState: When2meetState = {
		...st,
		phase: "review",
		slots: nextSlots,
		current: {},
	};
	return showReviewMenu(nextState, ev, {
		addedSlotIndex: nextSlots.length,
		addedSlot: newSlot,
	});
}

export function showReviewMenu(
	st: When2meetState,
	ev: MessageEvent | CallbackEvent,
	extras?: { addedSlotIndex?: number; addedSlot?: Slot },
) {
	const slots = getSlots(st);
	const t = tfor(ev.language);
	const maxSlots = effectiveMaxSlots(ev);
	const lines: string[] = [
		t("review.header"),
		"",
		t("review.title_line", { title: escapeHtml(st.title ?? "") }),
		"",
	];
	slots.forEach((slot, idx) => {
		lines.push(
			t("review.slot_line", { index: idx + 1, slot: escapeHtml(formatSlotShort(slot)) }),
		);
	});
	lines.push("");
	if (extras?.addedSlot && extras.addedSlotIndex) {
		lines.push(
			t("slot.added", {
				index: extras.addedSlotIndex,
				slot: escapeHtml(formatSlotShort(extras.addedSlot)),
				count: slots.length,
			}),
		);
		lines.push("");
	}
	if (slots.length < MIN_SLOTS) {
		lines.push(t("review.need_two", { min: MIN_SLOTS }));
	} else if (slots.length >= maxSlots) {
		lines.push(t("review.max_reached", { max: maxSlots }));
	} else {
		lines.push(t("review.footer"));
	}

	const keyboard = UIBuilder.keyboard().namespace(WHEN2MEET_SERVICE_ID);
	if (slots.length < maxSlots) {
		keyboard.callback(t("review.button_add_slot"), CB_ADD_SLOT).row();
	}
	if (slots.length >= MIN_SLOTS) {
		keyboard.callback(t("review.button_publish"), CB_PUBLISH, "primary").row();
	}
	keyboard.callback(t("review.button_cancel"), CB_CANCEL, "danger");

	return uiKeyboard(keyboard.build(), lines.join("\n"), {
		state: state.replace(st as Record<string, unknown>),
		options: {
			parse_mode: "HTML",
			replaceGroup: REVIEW_REPLACE_GROUP,
			cleanupGroup: SLOT_REPLACE_GROUP,
		},
	});
}

// ---------------------------------------------------------------------------
// Review-menu callbacks: add / publish / cancel
// ---------------------------------------------------------------------------

export function handleAddSlot(ev: CallbackEvent) {
	const st = (ev.state ?? {}) as When2meetState;
	const slots = getSlots(st);
	const maxSlots = effectiveMaxSlots(ev);
	if (slots.length >= maxSlots) {
		return showReviewMenu(st, ev);
	}
	const nextState: When2meetState = {
		...st,
		phase: "slot_date_pick",
		current: {},
	};
	return showDatePicker(nextState, ev);
}

export function handlePublish(ev: CallbackEvent) {
	const st = (ev.state ?? {}) as When2meetState;
	const slots = getSlots(st);
	if (slots.length < MIN_SLOTS || !st.title) {
		return showReviewMenu(st, ev);
	}
	return pollPublish(
		{
			title: st.title,
			slots,
		},
		{ state: state.clear() },
	);
}

export function handleCancel(ev: CallbackEvent) {
	return reply(tev(ev, "review.cancelled"), { state: state.clear(), deleteTrigger: true });
}

export function flowFallback(_ev: MessageEvent | CallbackEvent) {
	return none();
}
