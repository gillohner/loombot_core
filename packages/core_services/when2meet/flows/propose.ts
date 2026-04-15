// packages/core_services/when2meet/flows/propose.ts
// Slot-proposal state machine for the organizer flow. Accepts text messages
// and transitions through: title → slot_start_date → slot_start_time →
// slot_end_date → slot_end_time → review. From the review message the
// organizer can add another slot, publish, or cancel.

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
	CB_PUBLISH,
	MAX_SLOTS,
	MAX_TITLE_LENGTH,
	MIN_SLOTS,
	REVIEW_REPLACE_GROUP,
	WHEN2MEET_SERVICE_ID,
} from "../constants.ts";
import type { Slot, When2meetPhase, When2meetState } from "../types.ts";
import { tev, tfor } from "../utils/i18n.ts";
import {
	normalizeDate,
	validateDate,
	validateEndDateNotBeforeStart,
	validateEndTimeAfterStart,
	validateTime,
} from "../utils/validation.ts";

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

// ---------------------------------------------------------------------------
// Title input
// ---------------------------------------------------------------------------

export function handleTitleInput(text: string, st: When2meetState, ev: MessageEvent) {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return reply(tev(ev, "title.empty"));
	}
	if (trimmed.length > MAX_TITLE_LENGTH) {
		return reply(tev(ev, "title.too_long", { max: MAX_TITLE_LENGTH }));
	}
	const maxSlots = effectiveMaxSlots(ev);
	const nextState: When2meetState = {
		...st,
		phase: "slot_start_date",
		title: trimmed,
		slots: [],
		current: {},
	};
	return reply(
		tev(ev, "title.ok", { title: escapeHtml(trimmed) }) + "\n\n" +
			tev(ev, "slot.prompt_start_date", { index: 1, max: maxSlots }),
		{
			state: state.replace(nextState as Record<string, unknown>),
			options: { parse_mode: "HTML" },
		},
	);
}

// ---------------------------------------------------------------------------
// Per-slot date/time collection
// ---------------------------------------------------------------------------

export function handleSlotStartDate(text: string, st: When2meetState, ev: MessageEvent) {
	const validation = validateDate(text.trim(), ev.language);
	if (!validation.valid) return reply(validation.error!);
	const normalized = normalizeDate(text.trim()) ?? text.trim();
	return reply(tev(ev, "slot.prompt_start_time"), {
		state: state.merge({
			phase: "slot_start_time" as When2meetPhase,
			current: { ...(st.current ?? {}), startDate: normalized },
		}),
	});
}

export function handleSlotStartTime(text: string, st: When2meetState, ev: MessageEvent) {
	const validation = validateTime(text.trim(), ev.language);
	if (!validation.valid) return reply(validation.error!);
	return reply(tev(ev, "slot.prompt_end_date"), {
		state: state.merge({
			phase: "slot_end_date" as When2meetPhase,
			current: { ...(st.current ?? {}), startTime: text.trim() },
		}),
	});
}

export function handleSlotEndDate(text: string, st: When2meetState, ev: MessageEvent) {
	const validation = validateDate(text.trim(), ev.language);
	if (!validation.valid) return reply(validation.error!);
	const normalized = normalizeDate(text.trim()) ?? text.trim();
	const startDate = st.current?.startDate;
	if (startDate) {
		const rangeCheck = validateEndDateNotBeforeStart(startDate, normalized, ev.language);
		if (!rangeCheck.valid) return reply(rangeCheck.error!);
	}
	return reply(tev(ev, "slot.prompt_end_time"), {
		state: state.merge({
			phase: "slot_end_time" as When2meetPhase,
			current: { ...(st.current ?? {}), endDate: normalized },
		}),
	});
}

export function handleSlotEndTime(text: string, st: When2meetState, ev: MessageEvent) {
	const timeValidation = validateTime(text.trim(), ev.language);
	if (!timeValidation.valid) return reply(timeValidation.error!);
	const current = st.current ?? {};
	if (!current.startDate || !current.startTime || !current.endDate) {
		return reply(tev(ev, "menu.start_first", { command: "when2meet" }), {
			state: state.clear(),
		});
	}
	const orderCheck = validateEndTimeAfterStart(
		current.startDate,
		current.startTime,
		current.endDate,
		text.trim(),
		ev.language,
	);
	if (!orderCheck.valid) return reply(orderCheck.error!);
	const newSlot: Slot = {
		startDate: current.startDate,
		startTime: current.startTime,
		endDate: current.endDate,
		endTime: text.trim(),
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

// ---------------------------------------------------------------------------
// Review menu (inline keyboard: add slot / publish / cancel)
// ---------------------------------------------------------------------------

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
		options: { parse_mode: "HTML", replaceGroup: REVIEW_REPLACE_GROUP },
	});
}

// ---------------------------------------------------------------------------
// Review callbacks: add / publish / cancel
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
		phase: "slot_start_date",
		current: {},
	};
	return reply(
		tev(ev, "slot.prompt_start_date", { index: slots.length + 1, max: maxSlots }),
		{
			state: state.replace(nextState as Record<string, unknown>),
			options: { parse_mode: "HTML" },
		},
	);
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

// ---------------------------------------------------------------------------
// Fallback for unknown phases
// ---------------------------------------------------------------------------

export function flowFallback(_ev: MessageEvent | CallbackEvent) {
	return none();
}
