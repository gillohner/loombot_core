// packages/core_services/when2meet/utils/validation.ts
// Date/time validation helpers. Locale-aware error messages come from the
// when2meet locales so the user sees consistent strings during the organizer
// flow. The regex + numeric checks mirror event-creator/utils/validation.ts
// on purpose so both services accept the same input format.

import { tfor } from "./i18n.ts";

const DATE_REGEX = /^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}$/;
const TIME_REGEX = /^\d{2}:\d{2}$/;

export interface ValidationResult {
	valid: boolean;
	error?: string;
}

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

export function normalizeDate(input: string): string | null {
	const parts = parseDateParts(input);
	if (!parts) return null;
	const dd = String(parts.day).padStart(2, "0");
	const mm = String(parts.month).padStart(2, "0");
	return `${dd}.${mm}.${parts.year}`;
}

export function validateDate(text: string, locale?: string): ValidationResult {
	const t = tfor(locale);
	if (!DATE_REGEX.test(text)) {
		return { valid: false, error: t("validation.date_format_invalid") };
	}
	const parts = parseDateParts(text);
	if (!parts) return { valid: false, error: t("validation.date_format_invalid") };
	const { day, month, year } = parts;
	if (month < 1 || month > 12) {
		return { valid: false, error: t("validation.date_month_invalid") };
	}
	if (day < 1 || day > 31) {
		return { valid: false, error: t("validation.date_day_invalid") };
	}
	const dateObj = new Date(year, month - 1, day);
	if (
		dateObj.getFullYear() !== year ||
		dateObj.getMonth() !== month - 1 ||
		dateObj.getDate() !== day
	) {
		return { valid: false, error: t("validation.date_combination_invalid") };
	}
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	if (dateObj < today) {
		return { valid: false, error: t("validation.date_in_past") };
	}
	return { valid: true };
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

function dateNumericKey(ddmmyyyy: string): number | null {
	const p = parseDateParts(ddmmyyyy);
	if (!p) return null;
	return p.year * 10000 + p.month * 100 + p.day;
}

export function validateEndDateNotBeforeStart(
	startDate: string,
	endDate: string,
	locale?: string,
): ValidationResult {
	const t = tfor(locale);
	const sKey = dateNumericKey(startDate);
	const eKey = dateNumericKey(endDate);
	if (sKey === null || eKey === null) return { valid: true };
	if (eKey < sKey) {
		return {
			valid: false,
			error: t("validation.end_before_start_date", { end: endDate, start: startDate }),
		};
	}
	return { valid: true };
}

export function validateEndTimeAfterStart(
	startDate: string,
	startTime: string,
	endDate: string,
	endTime: string,
	locale?: string,
): ValidationResult {
	const t = tfor(locale);
	const startIso = toIsoDate(startDate);
	const endIso = toIsoDate(endDate);
	if (!startIso || !endIso) return { valid: true };
	const start = new Date(`${startIso}T${startTime}:00`);
	const end = new Date(`${endIso}T${endTime}:00`);
	if (end <= start) {
		return { valid: false, error: t("validation.end_before_start_time") };
	}
	return { valid: true };
}

function toIsoDate(ddmmyyyy: string): string | null {
	const p = parseDateParts(ddmmyyyy);
	if (!p) return null;
	const mm = String(p.month).padStart(2, "0");
	const dd = String(p.day).padStart(2, "0");
	return `${p.year}-${mm}-${dd}`;
}
