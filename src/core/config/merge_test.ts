// src/core/config/merge_test.ts
// Unit tests for resolveChatConfig. Uses an in-memory SQLite DB so the
// chat_feature_overrides table is real but disposable.

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
	clearAllChatFeatureOverrides,
	initDb,
	setChatFeatureOverride,
} from "@core/config/store.ts";
import { OperatorConfigSchema } from "@core/config/schema.ts";
import { resolveChatConfig } from "@core/config/merge.ts";

// Use an in-memory SQLite for all tests in this file.
initDb(":memory:");

function makeOperatorConfig(yamlLikeObject: unknown) {
	const parsed = OperatorConfigSchema.safeParse(yamlLikeObject);
	if (!parsed.success) {
		throw new Error("fixture invalid: " + JSON.stringify(parsed.error.issues));
	}
	return parsed.data;
}

const BASE_CONFIG = makeOperatorConfig({
	bot: { admin_ids: [], lock_dm_config: false },
	pubky: { enabled: false },
	features: {
		help: {
			service: "help",
			groups: true,
			dms: true,
			lock: true,
			config: { message: "help!" },
		},
		meetups: {
			service: "meetups",
			groups: true,
			dms: true,
			lock: false,
			allow_external_calendars: true,
			config: {
				calendars: [
					{
						id: "berlin",
						name: "Berlin",
						uri: "pubky://a".padEnd(60, "a") + "/pub/eventky.app/calendars/CAL1",
					},
					{
						id: "prague",
						name: "Prague",
						uri: "pubky://b".padEnd(60, "b") + "/pub/eventky.app/calendars/CAL2",
					},
				],
			},
		},
		triggerwords: {
			service: "triggerwords",
			groups: true,
			dms: false,
			lock: false,
			config: { responseProbability: 1.0 },
		},
		newevent: {
			service: "event_creator",
			groups: false,
			dms: true,
			lock: false,
			config: {},
		},
		new_member: {
			service: "new_member",
			groups: true,
			dms: false,
			lock: false,
			config: { message: "Welcome {display_name}!" },
		},
	},
});

Deno.test("group defaults: enabled features match `groups: true`", () => {
	clearAllChatFeatureOverrides("g1");
	const resolved = resolveChatConfig("g1", { chatType: "group", operatorConfig: BASE_CONFIG });
	const enabled = resolved.enabledFeatures.map((f) => f.featureId).sort();
	// event_creator is groups:false, new_member/triggerwords/meetups/help stay.
	assertEquals(enabled, ["help", "meetups", "new_member", "triggerwords"]);
});

Deno.test("dm defaults: enabled features match `dms: true`", () => {
	clearAllChatFeatureOverrides("dm1");
	const resolved = resolveChatConfig("dm1", { chatType: "private", operatorConfig: BASE_CONFIG });
	const enabled = resolved.enabledFeatures.map((f) => f.featureId).sort();
	// newevent would be on, but pubky.enabled=false blocks it.
	// help/meetups dms:true; triggerwords dms:false; new_member dms:false.
	assertEquals(enabled, ["help", "meetups"]);
});

Deno.test("pubky_blocked: event_creator stays off in DMs when pubky disabled", () => {
	clearAllChatFeatureOverrides("dm2");
	const resolved = resolveChatConfig("dm2", { chatType: "private", operatorConfig: BASE_CONFIG });
	const newevent = resolved.features.find((f) => f.featureId === "newevent");
	assertExists(newevent);
	assertEquals(newevent!.enabled, false);
});

Deno.test("pubky_enabled: event_creator turns on in DMs", () => {
	const withPubky = makeOperatorConfig({
		...BASE_CONFIG,
		pubky: {
			enabled: true,
			recovery_file: "./secrets/op.pkarr",
			passphrase_env: "PUBKY_PASSPHRASE",
			approval_group_chat_id: 1,
			approval_timeout_hours: 24,
		},
	});
	clearAllChatFeatureOverrides("dm3");
	const resolved = resolveChatConfig("dm3", { chatType: "private", operatorConfig: withPubky });
	const newevent = resolved.features.find((f) => f.featureId === "newevent");
	assertEquals(newevent?.enabled, true);
});

Deno.test("locked feature cannot be overridden", () => {
	clearAllChatFeatureOverrides("g2");
	setChatFeatureOverride("g2", "help", { enabled: false });
	const resolved = resolveChatConfig("g2", { chatType: "group", operatorConfig: BASE_CONFIG });
	const help = resolved.features.find((f) => f.featureId === "help");
	assertEquals(help?.enabled, true, "locked feature ignores chat override");
});

Deno.test("chat override disables a feature", () => {
	clearAllChatFeatureOverrides("g3");
	setChatFeatureOverride("g3", "triggerwords", { enabled: false });
	const resolved = resolveChatConfig("g3", { chatType: "group", operatorConfig: BASE_CONFIG });
	const tw = resolved.features.find((f) => f.featureId === "triggerwords");
	assertEquals(tw?.enabled, false);
});

Deno.test("meetups: selected_calendar_ids filters curated list", () => {
	clearAllChatFeatureOverrides("g4");
	setChatFeatureOverride("g4", "meetups", {
		data: { selected_calendar_ids: ["berlin"] },
	});
	const resolved = resolveChatConfig("g4", { chatType: "group", operatorConfig: BASE_CONFIG });
	const meetups = resolved.features.find((f) => f.featureId === "meetups");
	const cals = meetups?.config.calendars as Array<{ uri: string; name?: string }>;
	assertEquals(cals.length, 1);
	assertEquals(cals[0].name, "Berlin");
});

Deno.test("meetups: external calendars append to curated list", () => {
	clearAllChatFeatureOverrides("g5");
	const external = "pubky://" + "c".repeat(52) + "/pub/eventky.app/calendars/CAL9";
	setChatFeatureOverride("g5", "meetups", {
		data: { external_calendars: [external] },
	});
	const resolved = resolveChatConfig("g5", { chatType: "group", operatorConfig: BASE_CONFIG });
	const meetups = resolved.features.find((f) => f.featureId === "meetups");
	const cals = meetups?.config.calendars as Array<{ uri: string; name?: string }>;
	// 2 curated + 1 external
	assertEquals(cals.length, 3);
	assertEquals(cals[2].uri, external);
});

Deno.test("new_member: welcome_override replaces config.message", () => {
	clearAllChatFeatureOverrides("g6");
	setChatFeatureOverride("g6", "new_member", {
		data: { welcome_override: "Hi {first_name}!" },
	});
	const resolved = resolveChatConfig("g6", { chatType: "group", operatorConfig: BASE_CONFIG });
	const nm = resolved.features.find((f) => f.featureId === "new_member");
	assertEquals(nm?.config.message, "Hi {first_name}!");
});

// ---------------------------------------------------------------------------
// Periodic broadcast overrides (meetups)
// ---------------------------------------------------------------------------

function meetupsPeriodicConfig(chatId: string) {
	const resolved = resolveChatConfig(chatId, {
		chatType: "group",
		operatorConfig: BASE_CONFIG,
	});
	const meetups = resolved.features.find((f) => f.featureId === "meetups");
	assertExists(meetups);
	return meetups!.config as Record<string, unknown>;
}

Deno.test("meetups periodic: no override leaves operator defaults untouched", () => {
	clearAllChatFeatureOverrides("g7");
	const cfg = meetupsPeriodicConfig("g7");
	// BASE_CONFIG doesn't set any periodic fields → they stay undefined on the merged config.
	assertEquals(cfg.periodicEnabled, undefined);
	assertEquals(cfg.periodicDay, undefined);
	assertEquals(cfg.periodicHour, undefined);
	assertEquals(cfg.periodicTimezone, undefined);
	assertEquals(cfg.periodicRange, undefined);
	assertEquals(cfg.periodicPin, undefined);
	assertEquals(cfg.periodicUnpinPrevious, undefined);
});

Deno.test("meetups periodic: full override maps to periodicXxx fields", () => {
	clearAllChatFeatureOverrides("g8");
	setChatFeatureOverride("g8", "meetups", {
		data: {
			periodic: {
				enabled: true,
				day: 5,
				hour: 20,
				timezone: "America/New_York",
				range: "2weeks",
				pin: false,
				unpin_previous: false,
			},
		},
	});
	const cfg = meetupsPeriodicConfig("g8");
	assertEquals(cfg.periodicEnabled, true);
	assertEquals(cfg.periodicDay, 5);
	assertEquals(cfg.periodicHour, 20);
	assertEquals(cfg.periodicTimezone, "America/New_York");
	assertEquals(cfg.periodicRange, "2weeks");
	assertEquals(cfg.periodicPin, false);
	assertEquals(cfg.periodicUnpinPrevious, false);
});

Deno.test("meetups periodic: partial override only touches specified fields", () => {
	// Operator config with some defaults set.
	const withDefaults = makeOperatorConfig({
		...BASE_CONFIG,
		features: {
			...BASE_CONFIG.features,
			meetups: {
				...BASE_CONFIG.features.meetups,
				config: {
					...BASE_CONFIG.features.meetups.config,
					periodicEnabled: false,
					periodicDay: 1,
					periodicHour: 7,
					periodicTimezone: "Europe/Zurich",
					periodicRange: "week",
					periodicPin: true,
					periodicUnpinPrevious: true,
				},
			},
		},
	});
	clearAllChatFeatureOverrides("g9");
	setChatFeatureOverride("g9", "meetups", {
		data: {
			periodic: { enabled: true, hour: 18 },
		},
	});
	const resolved = resolveChatConfig("g9", {
		chatType: "group",
		operatorConfig: withDefaults,
	});
	const cfg = resolved.features.find((f) => f.featureId === "meetups")!
		.config as Record<string, unknown>;
	// Overridden
	assertEquals(cfg.periodicEnabled, true);
	assertEquals(cfg.periodicHour, 18);
	// Inherited from operator defaults
	assertEquals(cfg.periodicDay, 1);
	assertEquals(cfg.periodicTimezone, "Europe/Zurich");
	assertEquals(cfg.periodicRange, "week");
	assertEquals(cfg.periodicPin, true);
	assertEquals(cfg.periodicUnpinPrevious, true);
});

Deno.test("meetups periodic: override coexists with calendar overrides", () => {
	clearAllChatFeatureOverrides("g10");
	setChatFeatureOverride("g10", "meetups", {
		data: {
			selected_calendar_ids: ["prague"],
			periodic: { enabled: true, day: 0 },
		},
	});
	const resolved = resolveChatConfig("g10", {
		chatType: "group",
		operatorConfig: BASE_CONFIG,
	});
	const meetups = resolved.features.find((f) => f.featureId === "meetups")!;
	const cfg = meetups.config as Record<string, unknown>;
	const cals = cfg.calendars as Array<{ name?: string }>;
	assertEquals(cals.length, 1);
	assertEquals(cals[0].name, "Prague");
	assertEquals(cfg.periodicEnabled, true);
	assertEquals(cfg.periodicDay, 0);
});

Deno.test("meetups periodic: bogus types are ignored, not coerced", () => {
	clearAllChatFeatureOverrides("g11");
	setChatFeatureOverride("g11", "meetups", {
		data: {
			periodic: {
				enabled: "yes", // wrong type — ignored
				day: "monday", // wrong type — ignored
				hour: 14, // valid
			},
		},
	});
	const cfg = meetupsPeriodicConfig("g11");
	// Bad types do not overwrite operator defaults (which are undefined here).
	assertEquals(cfg.periodicEnabled, undefined);
	assertEquals(cfg.periodicDay, undefined);
	// Valid field still goes through.
	assertEquals(cfg.periodicHour, 14);
});
