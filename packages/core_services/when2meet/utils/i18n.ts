// packages/core_services/when2meet/utils/i18n.ts
// Event-scoped translation helper, modelled on event-creator/utils/i18n.ts.

import { createI18n } from "@sdk/mod.ts";
import en from "../locales/en.ts";
import de from "../locales/de.ts";

const tRaw = createI18n({ en, de }, "en");

export type EvCtxLike = { language?: string };

export function tev(
	ev: EvCtxLike | undefined,
	key: string,
	params?: Record<string, unknown>,
): string {
	return tRaw(key, params, ev?.language ?? "en");
}

export function tfor(locale: string | undefined) {
	return (key: string, params?: Record<string, unknown>): string => {
		return tRaw(key, params, locale ?? "en");
	};
}
