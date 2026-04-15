// sdk/i18n.ts
// Simple i18n helper.
export interface I18nMessages {
	[key: string]: string | I18nMessages;
}

export function createI18n(messages: I18nMessages, fallbackLang = "en") {
	return function t(key: string, params?: Record<string, unknown>, lang = fallbackLang): string {
		const keys = key.split(".");
		let current: string | I18nMessages = messages[lang] || messages[fallbackLang] || messages;
		for (const k of keys) {
			if (current && typeof current === "object" && k in current) {
				current = (current as I18nMessages)[k];
			} else return key;
		}
		if (typeof current !== "string") return key;
		if (params) {
			return current.replace(/\{\{(\w+)\}\}/g, (match, name) => {
				const v = params[name];
				return v === undefined || v === null ? match : String(v);
			});
		}
		return current;
	};
}
