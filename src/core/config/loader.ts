// src/core/config/loader.ts
// Parse and validate config.yaml. Called once at startup.
//
// Top-level scalar fields can be overridden from the environment so that
// Docker/Umbrel/Start9 installs can ship a baseline profile file and let
// operators fill in the common knobs via platform-native env-var forms.
// Supported env overrides (all optional):
//   BOT_ADMIN_IDS                 comma-separated Telegram user ids
//   LOCK_DM_CONFIG                "1" / "true" → lock DMs to super-admins
//   BOT_LANGUAGE                  "en" | "de" — sets bot.language
//   PUBKY_ENABLED                 "1" / "true" → enable Pubky writer
//   PUBKY_RECOVERY_FILE           path to .pkarr recovery file
//   PUBKY_APPROVAL_GROUP_CHAT_ID  telegram chat id for write approvals
//   PUBKY_APPROVAL_TIMEOUT_HOURS  integer hours

import { parse as parseYaml } from "@std/yaml";
import { type OperatorConfig, OperatorConfigSchema } from "@core/config/schema.ts";
import {
	getServiceEntry,
	getServiceKind,
	serviceExists,
	serviceRequiresPubky,
} from "@services/registry.ts";
import { log } from "@core/util/logger.ts";

export interface LoadConfigResult {
	config: OperatorConfig;
	sourcePath: string;
}

export async function loadOperatorConfig(
	path = Deno.env.get("CONFIG_FILE") ?? "./config.yaml",
): Promise<LoadConfigResult> {
	let text: string;
	try {
		text = await Deno.readTextFile(path);
	} catch (err) {
		if (err instanceof Deno.errors.NotFound) {
			throw new Error(
				`Config file not found at ${path}. Copy config.example.yaml to config.yaml and edit it.`,
			);
		}
		throw err;
	}

	let raw: unknown;
	try {
		raw = parseYaml(text);
	} catch (err) {
		throw new Error(`Failed to parse ${path}: ${(err as Error).message}`);
	}

	applyEnvOverrides(raw);

	const parsed = OperatorConfigSchema.safeParse(raw);
	if (!parsed.success) {
		const issues = parsed.error.issues
			.map((i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`)
			.join("\n");
		throw new Error(`Invalid ${path}:\n${issues}`);
	}

	const config = parsed.data;
	validateFeatures(config);
	return { config, sourcePath: path };
}

// Apply env-var overrides in-place to the raw parsed-YAML object (before
// zod validation). Only touches scalar top-level fields under `bot:` and
// `pubky:` — feature shapes stay file-driven.
export function applyEnvOverrides(raw: unknown): void {
	if (!raw || typeof raw !== "object") return;
	const cfg = raw as Record<string, unknown>;

	const adminIds = Deno.env.get("BOT_ADMIN_IDS");
	if (adminIds !== undefined) {
		const bot = (cfg.bot = (cfg.bot as Record<string, unknown>) ?? {});
		bot.admin_ids = adminIds.split(",").map((s) => s.trim()).filter(Boolean);
	}

	const lockDm = Deno.env.get("LOCK_DM_CONFIG");
	if (lockDm !== undefined) {
		const bot = (cfg.bot = (cfg.bot as Record<string, unknown>) ?? {});
		bot.lock_dm_config = parseBool(lockDm);
	}

	const language = Deno.env.get("BOT_LANGUAGE");
	if (language !== undefined && language.length > 0) {
		const bot = (cfg.bot = (cfg.bot as Record<string, unknown>) ?? {});
		bot.language = language.trim().toLowerCase();
	}

	const pubkyEnabled = Deno.env.get("PUBKY_ENABLED");
	if (pubkyEnabled !== undefined) {
		const pubky = (cfg.pubky = (cfg.pubky as Record<string, unknown>) ?? {});
		pubky.enabled = parseBool(pubkyEnabled);
	}

	const recoveryFile = Deno.env.get("PUBKY_RECOVERY_FILE");
	if (recoveryFile !== undefined && recoveryFile.length > 0) {
		const pubky = (cfg.pubky = (cfg.pubky as Record<string, unknown>) ?? {});
		pubky.recovery_file = recoveryFile;
	}

	const approvalGroup = Deno.env.get("PUBKY_APPROVAL_GROUP_CHAT_ID");
	if (approvalGroup !== undefined && approvalGroup.length > 0) {
		const pubky = (cfg.pubky = (cfg.pubky as Record<string, unknown>) ?? {});
		// Keep as string OR number — the schema accepts both.
		const n = Number(approvalGroup);
		pubky.approval_group_chat_id = Number.isFinite(n) ? n : approvalGroup;
	}

	const approvalTimeout = Deno.env.get("PUBKY_APPROVAL_TIMEOUT_HOURS");
	if (approvalTimeout !== undefined && approvalTimeout.length > 0) {
		const n = Number(approvalTimeout);
		if (Number.isFinite(n) && n > 0) {
			const pubky = (cfg.pubky = (cfg.pubky as Record<string, unknown>) ?? {});
			pubky.approval_timeout_hours = n;
		}
	}
}

function parseBool(v: string): boolean {
	const s = v.trim().toLowerCase();
	return s === "1" || s === "true" || s === "yes" || s === "on";
}

// Cross-validation between features and the services registry.
// Catches typos in `service:` values and pubky-gated features at startup.
function validateFeatures(config: OperatorConfig): void {
	const problems: string[] = [];
	for (const [featureId, feature] of Object.entries(config.features)) {
		if (!serviceExists(feature.service)) {
			problems.push(
				`features.${featureId}: unknown service "${feature.service}" (see src/services/registry.ts)`,
			);
			continue;
		}
		if (serviceRequiresPubky(feature.service) && !config.pubky.enabled) {
			log.info("config.feature.auto_disabled_no_pubky", {
				featureId,
				service: feature.service,
			});
		}
		if (feature.service === "meetups") {
			const cfg = feature.config as Record<string, unknown>;
			const tz = cfg.periodicTimezone;
			if (typeof tz === "string" && !isValidTimezone(tz)) {
				problems.push(
					`features.${featureId}.config.periodicTimezone: "${tz}" is not a valid IANA timezone`,
				);
			}
			const day = cfg.periodicDay;
			if (typeof day === "number" && (!Number.isInteger(day) || day < 0 || day > 6)) {
				problems.push(
					`features.${featureId}.config.periodicDay: must be an integer 0..6 (0=Sun, 6=Sat)`,
				);
			}
			const hour = cfg.periodicHour;
			if (typeof hour === "number" && (!Number.isInteger(hour) || hour < 0 || hour > 23)) {
				problems.push(
					`features.${featureId}.config.periodicHour: must be an integer 0..23`,
				);
			}
			const range = cfg.periodicRange;
			if (
				typeof range === "string" &&
				!["today", "week", "2weeks", "30days"].includes(range)
			) {
				problems.push(
					`features.${featureId}.config.periodicRange: must be one of today | week | 2weeks | 30days`,
				);
			}
		}
	}
	if (problems.length > 0) {
		throw new Error("Config validation failed:\n" + problems.map((p) => "  " + p).join("\n"));
	}
}

function isValidTimezone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
		return true;
	} catch {
		return false;
	}
}

// Re-export for callers that want direct access to the parsed shape + registry helpers.
export { getServiceEntry, getServiceKind, serviceExists };
