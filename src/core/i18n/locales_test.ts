// src/core/i18n/locales_test.ts
// Enforces that every locale file has the same keys as English (the fallback).
// If this test fails you added a key to en.ts without adding it to de.ts (or
// vice versa). Add the missing translation and re-run.

import { assertEquals } from "jsr:@std/assert@1";
import en from "./locales/en.ts";
import de from "./locales/de.ts";

function collectKeys(obj: unknown, prefix = ""): string[] {
	if (obj === null || typeof obj !== "object") return [];
	const keys: string[] = [];
	for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
		const path = prefix ? `${prefix}.${k}` : k;
		if (v !== null && typeof v === "object") {
			keys.push(...collectKeys(v, path));
		} else {
			keys.push(path);
		}
	}
	return keys.sort();
}

Deno.test("locale key parity: en <-> de", () => {
	const enKeys = collectKeys(en);
	const deKeys = collectKeys(de);
	assertEquals(
		deKeys,
		enKeys,
		"German locale keys must match English exactly (see src/i18n/locales/de.ts)",
	);
});

Deno.test("locale values are strings", () => {
	const enKeys = collectKeys(en);
	for (const key of enKeys) {
		const parts = key.split(".");
		let cursor: unknown = en;
		for (const p of parts) {
			cursor = (cursor as Record<string, unknown>)[p];
		}
		if (typeof cursor !== "string") {
			throw new Error(`en.${key} is not a string (got ${typeof cursor})`);
		}
	}
});
