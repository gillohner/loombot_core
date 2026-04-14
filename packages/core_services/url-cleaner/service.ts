// packages/core_services/url-cleaner/service.ts
// URL Cleaner - Listener service that cleans tracking parameters and offers alt frontends
import { createI18n, defineService, none, reply, runService } from "@sdk/mod.ts";
import type { CallbackEvent, CommandEvent, MessageEvent } from "@sdk/mod.ts";
import { TidyURL } from "npm:tidy-url@1";
import enMessages from "./locales/en.ts";
import deMessages from "./locales/de.ts";

const tRaw = createI18n({ en: enMessages, de: deMessages }, "en");
const tl = (locale: string | undefined, key: string, params?: Record<string, unknown>) =>
	tRaw(key, params, locale ?? "en");
import {
	type AltFrontendMapping,
	type AltFrontendsDataset,
	DEFAULT_ALT_FRONTENDS,
	DEFAULT_CONFIG,
	EXTRA_TRACKING_PARAMS,
	URL_CLEANER_CONFIG_SCHEMA,
	URL_CLEANER_DATASET_SCHEMAS,
	URL_CLEANER_SERVICE_ID,
	URL_CLEANER_VERSION,
	validateAltFrontendsDataset,
	validateConfig,
} from "./constants.ts";

// ============================================================================
// URL Processing Logic
// ============================================================================

interface ProcessedUrl {
	original: string;
	cleaned: string;
	wasModified: boolean;
	removedParams: string[];
	altFrontend?: {
		name: string;
		url: string;
	};
}

/**
 * Extract URLs from message text
 */
function extractUrls(text: string): string[] {
	const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
	const matches = text.match(urlRegex) || [];
	// Remove trailing punctuation that might be captured
	return matches.map((url) => url.replace(/[.,;:!?)]+$/, ""));
}

/**
 * Strip additional tracking params that tidy-url misses (e.g. YouTube `si`)
 */
function stripExtraTrackers(url: string): { cleaned: string; removed: string[] } {
	try {
		const parsed = new URL(url);
		const hostname = parsed.hostname;
		const removed: string[] = [];

		for (const [hostPattern, params] of Object.entries(EXTRA_TRACKING_PARAMS)) {
			if (new RegExp(hostPattern, "i").test(hostname)) {
				for (const param of params) {
					if (parsed.searchParams.has(param)) {
						parsed.searchParams.delete(param);
						removed.push(param);
					}
				}
			}
		}

		if (removed.length === 0) return { cleaned: url, removed: [] };
		return { cleaned: parsed.toString(), removed };
	} catch {
		return { cleaned: url, removed: [] };
	}
}

/**
 * Clean a URL using tidy-url, then strip extra known trackers
 */
function cleanUrl(url: string): { cleaned: string; removed: string[] } {
	try {
		const result = TidyURL.clean(url);
		// tidy-url may return key-value pairs or strings
		const rawRemoved = result.info?.removed || [];
		const removed = rawRemoved.map((r: unknown) =>
			typeof r === "string" ? r : (r as { key?: string })?.key || String(r)
		);
		// Strip additional trackers tidy-url doesn't know about
		const extra = stripExtraTrackers(result.url);
		return {
			cleaned: extra.cleaned,
			removed: [...removed, ...extra.removed],
		};
	} catch {
		// If tidy-url fails, still try extra stripping
		const extra = stripExtraTrackers(url);
		return { cleaned: extra.cleaned, removed: extra.removed };
	}
}

/**
 * Apply alt-frontend mappings to a URL
 */
function applyAltFrontend(
	url: string,
	mappings: AltFrontendMapping[],
): { name: string; url: string } | undefined {
	for (const mapping of mappings) {
		// Skip disabled mappings
		if (mapping.enabled === false) continue;

		try {
			const regex = new RegExp(mapping.pattern, "i");
			const match = url.match(regex);

			if (match) {
				// Check path pattern if specified
				if (mapping.pathPattern) {
					const urlObj = new URL(url);
					const pathRegex = new RegExp(mapping.pathPattern, "i");
					if (!pathRegex.test(urlObj.pathname)) {
						continue;
					}
				}

				// Apply replacement
				const altUrl = url.replace(regex, mapping.replacement);
				return { name: mapping.name, url: altUrl };
			}
		} catch {
			// Skip invalid regex patterns
			continue;
		}
	}
	return undefined;
}

/**
 * Process a single URL
 */
function processUrl(url: string, mappings: AltFrontendMapping[]): ProcessedUrl {
	const { cleaned, removed } = cleanUrl(url);
	const wasModified = cleaned !== url;
	const altFrontend = applyAltFrontend(cleaned, mappings);

	return {
		original: url,
		cleaned,
		wasModified,
		removedParams: removed,
		altFrontend,
	};
}

// ============================================================================
// Response Formatting
// ============================================================================

interface ServiceConfig {
	showOriginalUrl?: boolean;
	showCleanedUrl?: boolean;
	showRemovedParams?: boolean;
	silentIfUnchanged?: boolean;
	maxUrlsPerMessage?: number;
}

/**
 * Format a single processed URL for the response message
 */
function formatUrlResult(
	result: ProcessedUrl,
	config: ServiceConfig,
	locale: string | undefined,
): string | null {
	const parts: string[] = [];
	const silentIfUnchanged = config.silentIfUnchanged ?? DEFAULT_CONFIG.silentIfUnchanged;

	// If nothing changed and no alt-frontend, and silent mode is on, return null
	if (!result.wasModified && !result.altFrontend && silentIfUnchanged) {
		return null;
	}

	// Show original if configured
	if (config.showOriginalUrl) {
		parts.push(`${tl(locale, "label_original")}\n<code>${result.original}</code>`);
	}

	// Show cleaned URL if modified, or always alongside an alt-frontend
	const showCleaned = config.showCleanedUrl ?? DEFAULT_CONFIG.showCleanedUrl;
	if (showCleaned && result.wasModified) {
		parts.push(`${tl(locale, "label_cleaned")}\n${result.cleaned}`);
	} else if (result.altFrontend && !result.wasModified) {
		// Show direct URL alongside alt-frontend even if nothing was cleaned
		parts.push(`${tl(locale, "label_direct")}\n${result.cleaned}`);
	}

	// Show removed params if configured
	if (result.wasModified && config.showRemovedParams && result.removedParams.length > 0) {
		parts.push(`${tl(locale, "label_removed")} ${result.removedParams.join(", ")}`);
	}

	// Show alt-frontend if available. Name comes from operator-configured dataset
	// so it stays as-is; we just wrap it in the emoji prefix.
	if (result.altFrontend) {
		parts.push(`🔄 <b>${result.altFrontend.name}:</b>\n${result.altFrontend.url}`);
	}

	// If we have nothing to show, return null
	if (parts.length === 0) {
		return null;
	}

	return parts.join("\n");
}

/**
 * Format multiple URL results
 */
function formatResults(
	results: ProcessedUrl[],
	config: ServiceConfig,
	locale: string | undefined,
): string | null {
	const formatted = results
		.map((r) => formatUrlResult(r, config, locale))
		.filter((r): r is string => r !== null);

	if (formatted.length === 0) {
		return null;
	}

	if (formatted.length === 1) {
		return formatted[0];
	}

	// Multiple URLs - add separators
	return formatted
		.map((r, i) => `${tl(locale, "url_index", { n: i + 1 })}\n${r}`)
		.join("\n\n");
}

// ============================================================================
// Service Definition
// ============================================================================

const service = defineService({
	id: URL_CLEANER_SERVICE_ID,
	version: URL_CLEANER_VERSION,
	kind: "listener",
	description:
		"Automatically cleans tracking parameters from URLs and suggests privacy-friendly alternatives",
	npmDependencies: ["tidy-url"],
	configSchema: URL_CLEANER_CONFIG_SCHEMA,
	datasetSchemas: URL_CLEANER_DATASET_SCHEMAS,
	handlers: {
		command: (_ev: CommandEvent) => none(),
		callback: (_ev: CallbackEvent) => none(),
		message: (ev: MessageEvent) => {
			// Get message text
			const msg = ev.message as { text?: string } | undefined;
			const text = msg?.text || "";

			if (!text) {
				return none();
			}

			// Extract URLs from message
			const urls = extractUrls(text);
			if (urls.length === 0) {
				return none();
			}

			// Get config with defaults
			const rawConfig = ev.serviceConfig || {};
			const configValidation = validateConfig(rawConfig);
			if (!configValidation.valid) {
				// Log validation errors but continue with defaults
				console.error("URL Cleaner config validation errors:", configValidation.errors);
			}
			const config: ServiceConfig = { ...DEFAULT_CONFIG, ...rawConfig };

			// Get alt-frontends dataset
			let altFrontends: AltFrontendsDataset = DEFAULT_ALT_FRONTENDS;
			const datasets = ev.datasets as Record<string, unknown> | undefined;
			if (datasets?.altFrontends) {
				const validation = validateAltFrontendsDataset(datasets.altFrontends);
				if (validation.valid) {
					altFrontends = datasets.altFrontends as AltFrontendsDataset;
				} else {
					console.error("URL Cleaner altFrontends dataset validation errors:", validation.errors);
				}
			}

			// Limit URLs processed
			const maxUrls = config.maxUrlsPerMessage ?? DEFAULT_CONFIG.maxUrlsPerMessage;
			const urlsToProcess = urls.slice(0, maxUrls);

			// Process each URL
			const results = urlsToProcess.map((url) => processUrl(url, altFrontends.mappings));

			// Format results
			const message = formatResults(results, config, ev.language);

			if (!message) {
				return none();
			}

			return reply(message, {
				options: {
					parse_mode: "HTML",
					disable_web_page_preview: true,
				},
			});
		},
	},
});

export default service;
if (import.meta.main) await runService(service);
