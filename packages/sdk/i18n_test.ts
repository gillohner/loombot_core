import { assertEquals } from "jsr:@std/assert@1";
import { createI18n } from "./i18n.ts";

const messages = {
	en: {
		greet: "Hello {{name}}",
		button: "Add/Edit{{required}}",
		nested: {
			line: "{{a}} and {{b}}",
		},
	},
	de: {
		greet: "Hallo {{name}}",
	},
};

Deno.test("createI18n interpolates simple params", () => {
	const t = createI18n(messages, "en");
	assertEquals(t("greet", { name: "Gil" }), "Hello Gil");
});

Deno.test("createI18n returns key when path missing in requested lang", () => {
	// The helper does NOT do per-key cross-language fallback: when the
	// language exists as a top-level key but the requested path is missing
	// inside it, the key string is returned.
	const t = createI18n(messages, "en");
	assertEquals(t("button", { required: "" }, "de"), "button");
});

Deno.test("createI18n leaves empty string params as empty (regression)", () => {
	// Previously the helper used `params[name]?.toString() || m`, which
	// treated empty-string values as falsy and left the raw `{{required}}`
	// placeholder in the output. Empty string must replace the placeholder.
	const t = createI18n(messages, "en");
	assertEquals(t("button", { required: "" }), "Add/Edit");
});

Deno.test("createI18n renders non-empty param normally", () => {
	const t = createI18n(messages, "en");
	assertEquals(t("button", { required: " ❗" }), "Add/Edit ❗");
});

Deno.test("createI18n leaves placeholder intact when param is missing", () => {
	const t = createI18n(messages, "en");
	assertEquals(t("nested.line", { a: "foo" }), "foo and {{b}}");
});

Deno.test("createI18n returns key on unknown path", () => {
	const t = createI18n(messages, "en");
	assertEquals(t("does.not.exist"), "does.not.exist");
});
