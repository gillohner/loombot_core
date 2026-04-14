// packages/core_services/event-creator/utils/i18n.ts
// Event-creator i18n helper. Wraps the SDK's createI18n() with a simple
// `tev(ev, key, params)` that reads the locale from the event context.

import { createI18n } from "@sdk/mod.ts";
import en from "../locales/en.ts";
import de from "../locales/de.ts";

const tRaw = createI18n({ en, de }, "en");

export type EvCtxLike = { language?: string };

/**
 * Translate a key using the event's locale. Falls back to English when
 * language is missing on the event.
 */
export function tev(
	ev: EvCtxLike | undefined,
	key: string,
	params?: Record<string, unknown>,
): string {
	return tRaw(key, params, ev?.language ?? "en");
}

/**
 * Pre-bind to a specific locale. Useful when you don't have `ev` in scope.
 */
export function tfor(locale: string | undefined) {
	return (key: string, params?: Record<string, unknown>): string => {
		return tRaw(key, params, locale ?? "en");
	};
}
