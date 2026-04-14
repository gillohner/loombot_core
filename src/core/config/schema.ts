// src/core/config/schema.ts
// Zod schema for config.yaml. The operator edits config.yaml by hand; this is
// what validates it at startup (and via `deno task config:check`).

import { z } from "zod";

const CalendarEntrySchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	uri: z.string().min(1),
});

const FeatureSchema = z.object({
	service: z.string().min(1),
	groups: z.boolean().default(true),
	dms: z.boolean().default(false),
	lock: z.boolean().default(false),
	command: z.string().optional(),
	config: z.record(z.unknown()).default({}),
	datasets: z.record(z.unknown()).optional(),
	allow_external_calendars: z.boolean().optional(),
});

export const SUPPORTED_LANGUAGES = ["en", "de"] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

export const OperatorConfigSchema = z.object({
	bot: z.object({
		admin_ids: z.array(z.union([z.string(), z.number()])).default([]),
		lock_dm_config: z.boolean().default(false),
		language: z.enum(SUPPORTED_LANGUAGES).default("en"),
	}).default({ admin_ids: [], lock_dm_config: false, language: "en" }),
	pubky: z.object({
		enabled: z.boolean().default(false),
		recovery_file: z.string().optional(),
		passphrase_env: z.string().default("PUBKY_PASSPHRASE"),
		approval_group_chat_id: z.union([z.string(), z.number()]).default(0),
		approval_timeout_hours: z.number().positive().default(24),
	}).default({
		enabled: false,
		passphrase_env: "PUBKY_PASSPHRASE",
		approval_group_chat_id: 0,
		approval_timeout_hours: 24,
	}),
	features: z.record(FeatureSchema).default({}),
});

export type OperatorConfig = z.infer<typeof OperatorConfigSchema>;
export type FeatureConfig = z.infer<typeof FeatureSchema>;
export type CalendarEntry = z.infer<typeof CalendarEntrySchema>;
