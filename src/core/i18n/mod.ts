// src/i18n/mod.ts
// Core-bot i18n. Reads the operator language from the runtime singleton and
// looks up the string via the SDK's createI18n() helper. Operator-level only
// in v1 — no per-chat or per-user override.
//
// Usage:
//   import { t } from "@core/i18n/mod.ts";
//   await ctx.reply(t("core.admin_only"));
//   await ctx.reply(t("config_ui.welcome.too_long", { max: 2000, length: 3100 }));
//
// Missing keys fall through to the key string itself (e.g. "core.admin_only").
// The key-parity test in locales_test.ts catches missing German keys before
// they reach production.

import { createI18n } from "@sdk/mod.ts";
import { getOperatorConfig } from "@core/config/runtime.ts";
import en from "./locales/en.ts";
import de from "./locales/de.ts";

const tImpl = createI18n({ en, de }, "en");

/**
 * Look up a translation by dot-notation key.
 *
 * Params are interpolated via {{name}}. They are NOT auto-escaped — callers
 * must pre-escape user-provided text with escapeHtml() before passing it in.
 */
export function t(key: string, params?: Record<string, unknown>): string {
	const lang = getOperatorConfig().bot.language ?? "en";
	return tImpl(key, params, lang);
}

/**
 * Current operator locale. Useful for date/time formatting (`Intl.DateTimeFormat`)
 * and for passing along to services via the sandbox payload.
 */
export function getLocale(): string {
	return getOperatorConfig().bot.language ?? "en";
}

/**
 * Map our short locale codes (en / de) to BCP 47 tags accepted by Intl APIs.
 */
export function intlLocale(): string {
	const l = getLocale();
	if (l === "de") return "de-DE";
	return "en-US";
}
