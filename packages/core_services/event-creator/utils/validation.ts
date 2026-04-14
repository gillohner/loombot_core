// packages/core_services/event-creator/utils/validation.ts
// Field validation utilities. Error messages are translated via the event
// locale — callers pass the locale (from `ev.language`) into each function.

import {
	DATE_REGEX,
	MAX_DESCRIPTION_LENGTH,
	MAX_LOCATION_NAME_LENGTH,
	MAX_TITLE_LENGTH,
	TIME_REGEX,
} from "../constants.ts";
import { tfor } from "./i18n.ts";

export interface ValidationResult {
	valid: boolean;
	error?: string;
}

export function validateTitle(text: string, locale?: string): ValidationResult {
	const t = tfor(locale);
	if (!text || text.trim().length === 0) {
		return { valid: false, error: t("validation.title_empty") };
	}
	if (text.length > MAX_TITLE_LENGTH) {
		return {
			valid: false,
			error: t("validation.title_too_long", { max: MAX_TITLE_LENGTH }),
		};
	}
	return { valid: true };
}

export function validateDescription(text: string, locale?: string): ValidationResult {
	const t = tfor(locale);
	if (text.length > MAX_DESCRIPTION_LENGTH) {
		return {
			valid: false,
			error: t("validation.description_too_long", { max: MAX_DESCRIPTION_LENGTH }),
		};
	}
	return { valid: true };
}

export function validateDate(text: string, locale?: string): ValidationResult {
	const t = tfor(locale);
	if (!DATE_REGEX.test(text)) {
		return { valid: false, error: t("validation.date_format_invalid") };
	}

	const parts = parseDateParts(text);
	if (!parts) {
		return { valid: false, error: t("validation.date_format_invalid") };
	}

	const { day, month, year } = parts;
	if (month < 1 || month > 12) {
		return { valid: false, error: t("validation.date_month_invalid") };
	}
	if (day < 1 || day > 31) {
		return { valid: false, error: t("validation.date_day_invalid") };
	}

	// Check actual validity by constructing a Date
	const dateObj = new Date(year, month - 1, day);
	if (
		dateObj.getFullYear() !== year ||
		dateObj.getMonth() !== month - 1 ||
		dateObj.getDate() !== day
	) {
		return { valid: false, error: t("validation.date_combination_invalid") };
	}

	// Validate the date is in the future
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	if (dateObj < today) {
		return { valid: false, error: t("validation.date_in_past") };
	}

	return { valid: true };
}

/**
 * Parse a date string with any separator (. / -) into day, month, year parts.
 * Expects DD{sep}MM{sep}YYYY format.
 */
export function parseDateParts(
	input: string,
): { day: number; month: number; year: number } | null {
	const parts = input.split(/[.\/-]/);
	if (parts.length !== 3) return null;
	const day = parseInt(parts[0], 10);
	const month = parseInt(parts[1], 10);
	const year = parseInt(parts[2], 10);
	if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
	return { day, month, year };
}

/**
 * Normalize a user-entered date string to DD.MM.YYYY format.
 * Accepts any separator (. / -).
 */
export function normalizeDate(input: string): string | null {
	const parts = parseDateParts(input);
	if (!parts) return null;
	const dd = String(parts.day).padStart(2, "0");
	const mm = String(parts.month).padStart(2, "0");
	return `${dd}.${mm}.${parts.year}`;
}

export function validateTime(text: string, locale?: string): ValidationResult {
	const t = tfor(locale);
	if (!TIME_REGEX.test(text)) {
		return { valid: false, error: t("validation.time_format_invalid") };
	}

	const [hours, minutes] = text.split(":").map(Number);
	if (hours! > 23 || minutes! > 59) {
		return { valid: false, error: t("validation.time_range_invalid") };
	}

	return { valid: true };
}

export function validateLocationName(text: string, locale?: string): ValidationResult {
	const t = tfor(locale);
	if (text.length > MAX_LOCATION_NAME_LENGTH) {
		return {
			valid: false,
			error: t("validation.location_too_long", { max: MAX_LOCATION_NAME_LENGTH }),
		};
	}
	return { valid: true };
}

export function validateEndTime(
	startDate: string,
	startTime: string,
	endDate: string,
	endTime: string,
	locale?: string,
): ValidationResult {
	const t = tfor(locale);
	const startIso = dateToIso(startDate);
	const endIso = dateToIso(endDate);
	const start = new Date(`${startIso}T${startTime}:00`);
	const end = new Date(`${endIso}T${endTime}:00`);

	if (end <= start) {
		return { valid: false, error: t("validation.end_time_before_start") };
	}

	return { valid: true };
}

/**
 * Convert DD.MM.YYYY to YYYY-MM-DD for Date constructor.
 */
function dateToIso(ddmmyyyy: string): string {
	const parts = parseDateParts(ddmmyyyy);
	if (!parts) return ddmmyyyy; // fallback
	const mm = String(parts.month).padStart(2, "0");
	const dd = String(parts.day).padStart(2, "0");
	return `${parts.year}-${mm}-${dd}`;
}
