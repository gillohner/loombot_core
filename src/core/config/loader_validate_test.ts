// src/core/config/loader_validate_test.ts
// Verifies the meetups-specific validation rules in loadOperatorConfig():
// bad periodicTimezone / periodicDay / periodicHour / periodicRange should
// fail fast at startup instead of silently crashing the scheduler loop.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadOperatorConfig } from "@core/config/loader.ts";

async function withTempConfig(yaml: string, fn: (path: string) => Promise<void>): Promise<void> {
	const path = await Deno.makeTempFile({ prefix: "loombot-cfg-", suffix: ".yaml" });
	try {
		await Deno.writeTextFile(path, yaml);
		await fn(path);
	} finally {
		try {
			await Deno.remove(path);
		} catch {
			// ignore
		}
	}
}

const BASE_YAML = `
bot:
  admin_ids: []
pubky:
  enabled: false
features:
  meetups:
    service: meetups
    groups: true
    dms: true
    config:
`;

Deno.test("loader accepts valid meetups periodic config", async () => {
	await withTempConfig(
		BASE_YAML +
			"      periodicEnabled: true\n" +
			"      periodicDay: 3\n" +
			"      periodicHour: 14\n" +
			'      periodicTimezone: "America/New_York"\n' +
			'      periodicRange: "2weeks"\n',
		async (path) => {
			const { config } = await loadOperatorConfig(path);
			const meetups = config.features.meetups.config as Record<string, unknown>;
			assertEquals(meetups.periodicTimezone, "America/New_York");
			assertEquals(meetups.periodicRange, "2weeks");
		},
	);
});

Deno.test("loader rejects invalid periodicTimezone", async () => {
	await withTempConfig(
		BASE_YAML + '      periodicTimezone: "Not/A/Real/Zone"\n',
		async (path) => {
			const err = await assertRejects(() => loadOperatorConfig(path), Error);
			assert(err.message.includes("periodicTimezone"));
			assert(err.message.includes("Not/A/Real/Zone"));
		},
	);
});

Deno.test("loader rejects out-of-range periodicDay", async () => {
	await withTempConfig(
		BASE_YAML + "      periodicDay: 9\n",
		async (path) => {
			const err = await assertRejects(() => loadOperatorConfig(path), Error);
			assert(err.message.includes("periodicDay"));
		},
	);
});

Deno.test("loader rejects out-of-range periodicHour", async () => {
	await withTempConfig(
		BASE_YAML + "      periodicHour: 25\n",
		async (path) => {
			const err = await assertRejects(() => loadOperatorConfig(path), Error);
			assert(err.message.includes("periodicHour"));
		},
	);
});

Deno.test("loader rejects unknown periodicRange", async () => {
	await withTempConfig(
		BASE_YAML + '      periodicRange: "quarterly"\n',
		async (path) => {
			const err = await assertRejects(() => loadOperatorConfig(path), Error);
			assert(err.message.includes("periodicRange"));
		},
	);
});
