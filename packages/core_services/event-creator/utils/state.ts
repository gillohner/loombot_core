// packages/core_services/event-creator/utils/state.ts
// State management utilities

import type { EventCreatorConfig, EventCreatorState } from "../types.ts";
import { validateEndTime } from "./validation.ts";
import { tfor } from "./i18n.ts";

/**
 * Check if all required fields are complete
 */
export function isRequiredPhaseComplete(state: EventCreatorState): boolean {
	return !!(state.title && state.startDate && state.startTime);
}

/**
 * Check if the event can be submitted
 */
export function canSubmit(
	state: EventCreatorState,
	config: EventCreatorConfig,
	locale?: string,
): { canSubmit: boolean; error?: string } {
	const t = tfor(locale);
	// Required fields
	if (!isRequiredPhaseComplete(state)) {
		return { canSubmit: false, error: t("submit.missing_required") };
	}

	// Config-required fields
	if (config.requireLocation && !state.location?.name) {
		return { canSubmit: false, error: t("submit.location_required") };
	}
	if (config.requireImage && !state.imageFileId) {
		return { canSubmit: false, error: t("submit.image_required") };
	}
	if (config.requireEndTime && (!state.endDate || !state.endTime)) {
		return { canSubmit: false, error: t("submit.end_required") };
	}

	// Validate end time if provided
	if (state.endDate && state.endTime) {
		const endTimeValid = validateEndTime(
			state.startDate!,
			state.startTime!,
			state.endDate,
			state.endTime,
			locale,
		);
		if (!endTimeValid.valid) {
			return { canSubmit: false, error: endTimeValid.error };
		}
	}

	return { canSubmit: true };
}

/**
 * Get the prompt text for editing a specific field
 */
export function getEditPrompt(field: string, locale?: string): string {
	const t = tfor(locale);
	switch (field) {
		case "title":
			return t("edit.prompt_title");
		case "startDate":
			return t("edit.prompt_start_date");
		case "startTime":
			return t("edit.prompt_start_time");
		case "description":
			return t("edit.prompt_description");
		case "endDate":
			return t("edit.prompt_end_date");
		case "endTime":
			return t("edit.prompt_end_time");
		case "location":
			return t("edit.prompt_location");
		case "imageFileId":
			return t("edit.prompt_image");
		default:
			return t("edit.prompt_generic");
	}
}

/**
 * Check if a field is clearable (optional)
 */
export function isFieldClearable(field: string): boolean {
	return ["description", "endDate", "endTime", "location", "imageFileId"].includes(field);
}
