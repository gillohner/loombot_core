// src/core/pubky/pubky.ts
// Multi-layered Pubky config system supporting Bot Config -> Service Config -> Service Registry

export interface PubkyServiceRegistryEntry {
	id: string;
	name: string;
	kind: "single_command" | "command_flow" | "listener";
	source: {
		type: "jsr" | "github" | "local";
		location: string; // JSR package, GitHub repo, or pubky:// path for local
		entry?: string; // entry point for GitHub/local sources
		version?: string; // for JSR/GitHub
	};
}

export interface PubkyServiceRegistry {
	registryId: string;
	description?: string;
	services: PubkyServiceRegistryEntry[];
}

export interface PubkyServiceConfig {
	configId: string;
	name: string;
	description?: string;
	// Option A: registry-based lookup
	registryRef?: string; // pubky:// URL to service registry
	serviceId?: string; // ID from the registry
	// Option B: inline source (no registry)
	kind?: "single_command" | "command_flow" | "listener";
	source?: PubkyServiceRegistryEntry["source"]; // direct source descriptor
	// Common
	command: string; // command token without leading '/'
	config?: Record<string, unknown>; // service-specific configuration
	datasets?: Record<string, string>; // name -> pubky:// URL mappings
}

export interface PubkyBotServiceRef {
	serviceConfigRef: string; // pubky:// URL to service config
	overrides?: {
		command?: string; // override the command from service config
		config?: Record<string, unknown>; // merge with service config
		datasets?: Record<string, string>; // merge with service datasets
	};
	adminOnly?: boolean;
}

export interface PubkyBotConfig {
	configId: string;
	description?: string;
	version?: string;
	services: PubkyBotServiceRef[];
	listeners: PubkyBotServiceRef[];
}

// Legacy interface for backward compatibility
export interface PubkyServiceSpec {
	name: string;
	command: string;
	kind: "single_command" | "command_flow" | "listener";
	entry: string;
	version?: string;
	source?: string;
	config?: Record<string, unknown>;
	/** Explicit service ID from config; used as fallback when loadMeta fails */
	serviceId?: string;
	/** Allowed network domains for sandbox (e.g., ["nominatim.openstreetmap.org"]) */
	net?: string[];
	/** Delete the user's command message after the bot responds */
	deleteCommandMessage?: boolean;
}

export interface PubkyBotConfigTemplate {
	configId: string;
	services: PubkyServiceSpec[];
	listeners: PubkyServiceSpec[];
}

// Built-in template set for development/testing
const TEMPLATES: Record<string, PubkyBotConfigTemplate> = {
	default: {
		configId: "default",
		services: [
			{
				name: "Help",
				command: "help",
				kind: "single_command",
				entry: "./packages/core_services/help/service.ts",
				version: "1.0.0",
			},
			{
				name: "Simple Response",
				command: "hello",
				kind: "single_command",
				entry: "./packages/core_services/simple-response/service.ts",
				version: "1.0.0",
				config: { message: "Hello! I'm a Pubky bot." },
			},
			{
				name: "Links",
				command: "links",
				kind: "command_flow",
				entry: "./packages/core_services/links/service.ts",
			},
			{
				name: "Event Creator",
				command: "newevent",
				kind: "command_flow",
				entry: "./packages/core_services/event-creator/service.ts",
				serviceId: "event_creator",
				net: ["nominatim.openstreetmap.org"],
				config: {
					defaultTimezone: "UTC",
					requireLocation: false,
				},
			},
		],
		listeners: [
			{
				name: "New Member",
				command: "new_member",
				kind: "listener",
				entry: "./packages/core_services/new-member/service.ts",
			},
			{
				name: "Trigger Words",
				command: "triggerwords",
				kind: "listener",
				entry: "./packages/core_services/triggerwords/service.ts",
			},
			{
				name: "URL Cleaner",
				command: "url_cleaner",
				kind: "listener",
				entry: "./packages/core_services/url-cleaner/service.ts",
			},
		],
	},
	modular: {
		configId: "modular",
		services: [
			{
				name: "Simple Response (from modular)",
				command: "hello",
				kind: "single_command",
				entry: "./packages/core_services/simple-response/service.ts",
				config: { message: "Modular hello!" },
			},
		],
		listeners: [],
	},
	fake: {
		configId: "fake",
		services: [
			{
				name: "Simple Response",
				command: "hello",
				kind: "single_command",
				entry: "./packages/core_services/simple-response/service.ts",
				config: { message: "FAKE template override!" },
				version: "1.0.0",
				source: "local",
			},
			{
				name: "Links",
				command: "links",
				kind: "command_flow",
				entry: "./packages/core_services/links/service.ts",
			},
		],
		listeners: [
			{
				name: "Trigger Words",
				command: "triggerwords",
				kind: "listener",
				entry: "./packages/core_services/triggerwords/service.ts",
			},
		],
	},
};

/**
 * Normalize a calendar URI to the correct spec format:
 *   pubky://<authorId>/pub/eventky.app/calendars/<calendarId>
 */
function normalizeCalendarUri(uri: string): string {
	if (!uri.startsWith("pubky://")) return uri;
	const rest = uri.slice("pubky://".length);
	// Already correct format
	if (/^[a-z0-9]{52}\/pub\/eventky\.app\/calendars\/[A-Z0-9]+$/.test(rest)) return uri;
	// Malformed: pub/eventky.app/calendar(s?)/<pk>/<id>
	const malformed = rest.match(
		/^pub\/eventky\.app\/calendars?\/([a-z0-9]{52})\/([A-Z0-9]+)$/,
	);
	if (malformed) {
		return `pubky://${malformed[1]}/pub/eventky.app/calendars/${malformed[2]}`;
	}
	return uri;
}

/**
 * Parse a GitHub/GitLab URL into a structured source object.
 * E.g., "https://github.com/user/repo/tree/main/packages/services/hello"
 * becomes { type: "github", location: "user/repo", entry: "./packages/services/hello/service.ts" }
 */
function parseGitSourceUrl(url: string): PubkyServiceRegistryEntry["source"] {
	try {
		const parsed = new URL(url);
		const hostname = parsed.hostname.toLowerCase();
		const pathParts = parsed.pathname.split("/").filter(Boolean);

		if (pathParts.length < 2) {
			throw new Error(`Invalid git URL: ${url}`);
		}

		const owner = pathParts[0];
		const repo = pathParts[1];
		let branch = "master";
		let path = "";

		// Handle GitHub URLs: github.com/owner/repo/tree/branch/path
		if (hostname === "github.com" || hostname === "www.github.com") {
			if (pathParts.length > 3 && (pathParts[2] === "tree" || pathParts[2] === "blob")) {
				branch = pathParts[3];
				path = pathParts.slice(4).join("/");
			} else if (pathParts.length > 2) {
				path = pathParts.slice(2).join("/");
			}

			return {
				type: "github",
				location: `${owner}/${repo}`,
				entry: path ? `./${path}/service.ts` : "./service.ts",
				version: branch,
			};
		}

		// Handle GitLab URLs
		if (hostname === "gitlab.com" || hostname === "www.gitlab.com") {
			if (pathParts.length > 4 && pathParts[2] === "-" && pathParts[3] === "tree") {
				branch = pathParts[4];
				path = pathParts.slice(5).join("/");
			} else if (pathParts.length > 2) {
				path = pathParts.slice(2).join("/");
			}

			return {
				type: "github", // Use github type for GitLab too since they work similarly
				location: `${owner}/${repo}`,
				entry: path ? `./${path}/service.ts` : "./service.ts",
				version: branch,
			};
		}

		// Fallback for unknown providers
		return {
			type: "github",
			location: `${owner}/${repo}`,
			entry: path ? `./${path}/service.ts` : "./service.ts",
		};
	} catch (e) {
		throw new Error(`Failed to parse git source URL: ${url} - ${(e as Error).message}`);
	}
}

/**
 * Convert a pubky:// URL to Address format for publicStorage
 * The SDK accepts both 'pubky<pk>/pub/...' and 'pubky://<pk>/pub/...' formats
 */
function pubkyUrlToAddress(url: string): `pubky://${string}/pub/${string}` {
	if (!url.startsWith("pubky://")) {
		throw new Error(`Invalid pubky URL: ${url}`);
	}
	// pubky:// URLs are valid Address type as-is
	return url as `pubky://${string}/pub/${string}`;
}

/**
 * Fetch and resolve a complete bot configuration from Pubky.
 * Supports both legacy single-file configs and new modular configs.
 */
export async function fetchPubkyConfig(url: string): Promise<PubkyBotConfigTemplate> {
	const key = url.trim();

	if (key.startsWith("pubky://")) {
		const { Pubky } = await import("@synonymdev/pubky");
		const pubky = new Pubky();
		const publicStorage = pubky.publicStorage;
		console.log("Fetching Pubky config from", key);

		const address = pubkyUrlToAddress(key);
		const json = await publicStorage.getJson(address);
		console.log("Fetched Pubky config:", json);

		// Check if this is a new modular bot config (from web configurator)
		// Supports both serviceConfigRef (new format) and serviceConfigUri (legacy format)
		if (
			json && typeof json === "object"
		) {
			const botConfig = json as Record<string, unknown>;
			const services = botConfig.services as unknown[] | undefined;
			const listeners = botConfig.listeners as unknown[] | undefined;

			// Check if any service/listener has the modular format (serviceConfigRef or serviceConfigUri)
			const hasModularFormat = (arr: unknown[] | undefined): boolean => {
				if (!Array.isArray(arr) || arr.length === 0) return false;
				const first = arr[0];
				if (typeof first !== "object" || first === null) return false;
				const entry = first as Record<string, unknown>;
				return typeof entry.serviceConfigRef === "string" ||
					typeof entry.serviceConfigUri === "string";
			};

			if (hasModularFormat(services) || hasModularFormat(listeners)) {
				// Create a wrapper to match our PubkyClient interface
				const clientWrapper: PubkyClient = {
					async fetch(url: string) {
						try {
							const addr = pubkyUrlToAddress(url);
							const data = await publicStorage.getJson(addr);
							return {
								ok: true,
								status: 200,
								statusText: "OK",
								json: () => Promise.resolve(data),
							};
						} catch (e) {
							const err = e as { data?: { statusCode?: number } };
							const statusCode = err.data?.statusCode ?? 500;
							return {
								ok: false,
								status: statusCode,
								statusText: (e as Error).message,
								json: () => Promise.reject(e),
							};
						}
					},
				};
				// Normalize to use serviceConfigRef
				const normalizedConfig = normalizeModularBotConfig(botConfig);
				return await resolveModularBotConfig(normalizedConfig, clientWrapper);
			}
		}

		// Legacy single-file config
		return json as PubkyBotConfigTemplate;
	}

	// Local templates
	if (!TEMPLATES[key]) throw new Error(`Unknown Pubky config template: ${key}`);
	return structuredClone(TEMPLATES[key]);
}

export function listPubkyTemplateIds(): string[] {
	return Object.keys(TEMPLATES);
}

/**
 * Normalize a modular bot config from the web configurator format to the expected format.
 * Handles conversion from serviceConfigUri to serviceConfigRef and normalizes overrides.
 */
function normalizeModularBotConfig(config: Record<string, unknown>): PubkyBotConfig {
	const normalizeRef = (ref: Record<string, unknown>): PubkyBotServiceRef => {
		// Support both serviceConfigRef (new) and serviceConfigUri (legacy)
		const configUrl = (ref.serviceConfigRef || ref.serviceConfigUri) as string;
		if (!configUrl) {
			throw new Error("Service reference missing serviceConfigRef or serviceConfigUri");
		}

		// Normalize overrides from legacy format (commandOverride, configOverrides, datasetOverrides)
		// to new format (overrides.command, overrides.config, overrides.datasets)
		let overrides: PubkyBotServiceRef["overrides"] | undefined;

		if (ref.overrides && typeof ref.overrides === "object") {
			// Already in new format
			overrides = ref.overrides as PubkyBotServiceRef["overrides"];
		} else {
			// Legacy format
			const legacyOverrides: PubkyBotServiceRef["overrides"] = {};
			if (typeof ref.commandOverride === "string") {
				legacyOverrides.command = ref.commandOverride;
			}
			if (ref.configOverrides && typeof ref.configOverrides === "object") {
				legacyOverrides.config = ref.configOverrides as Record<string, unknown>;
			}
			if (ref.datasetOverrides && typeof ref.datasetOverrides === "object") {
				legacyOverrides.datasets = ref.datasetOverrides as Record<string, string>;
			}
			if (Object.keys(legacyOverrides).length > 0) {
				overrides = legacyOverrides;
			}
		}

		return {
			serviceConfigRef: configUrl,
			overrides,
			adminOnly: ref.adminOnly as boolean | undefined,
		};
	};

	const services = Array.isArray(config.services)
		? (config.services as Record<string, unknown>[])
			.filter((s) => (s.enabled !== false)) // Only include enabled services
			.map(normalizeRef)
		: [];

	const listeners = Array.isArray(config.listeners)
		? (config.listeners as Record<string, unknown>[])
			.filter((l) => (l.enabled !== false)) // Only include enabled listeners
			.map(normalizeRef)
		: [];

	return {
		configId: (config.configId as string) || "unknown",
		description: config.description as string | undefined,
		version: config.version as string | undefined,
		services,
		listeners,
	};
}

// Interface for Pubky client to avoid 'any' type
interface PubkyClient {
	fetch(url: string): Promise<{
		ok: boolean;
		status: number;
		statusText: string;
		json(): Promise<unknown>;
	}>;
}

/**
 * Resolve a modular bot config by fetching referenced service configs and registries
 */
async function resolveModularBotConfig(
	botConfig: PubkyBotConfig,
	client: PubkyClient,
): Promise<PubkyBotConfigTemplate> {
	const resolvedServices: PubkyServiceSpec[] = [];
	const resolvedListeners: PubkyServiceSpec[] = [];

	// Process services
	for (const serviceRef of botConfig.services) {
		const resolved = await resolveServiceRef(serviceRef, client);
		if (resolved.kind === "listener") {
			resolvedListeners.push(resolved);
		} else {
			resolvedServices.push(resolved);
		}
	}

	// Process listeners
	for (const listenerRef of botConfig.listeners) {
		const resolved = await resolveServiceRef(listenerRef, client);
		resolvedListeners.push(resolved);
	}

	return {
		configId: botConfig.configId,
		services: resolvedServices,
		listeners: resolvedListeners,
	};
}

/**
 * Resolve a single service reference by fetching its config and registry
 */
async function resolveServiceRef(
	serviceRef: PubkyBotServiceRef,
	client: PubkyClient,
): Promise<PubkyServiceSpec> {
	// Fetch service config
	const configResponse = await client.fetch(serviceRef.serviceConfigRef);
	if (!configResponse.ok) {
		throw new Error(`Failed to fetch service config from ${serviceRef.serviceConfigRef}`);
	}
	const rawConfig = await configResponse.json() as Record<string, unknown>;

	// Handle both formats:
	// A) Web configurator format: { source: "https://github.com/...", kind: "listener", command: "cmd" }
	// B) Structured format: { registryRef, serviceId } or { kind, source: { type, location } }

	let resolvedKind: PubkyServiceRegistryEntry["kind"];
	let resolvedSource: PubkyServiceRegistryEntry["source"];
	let resolvedName = rawConfig.name as string;
	let resolvedCommand = rawConfig.command as string | undefined;
	let resolvedVersion: string | undefined;

	// Check if source is a URL string (web configurator format)
	if (typeof rawConfig.source === "string" && rawConfig.source.startsWith("http")) {
		// Web configurator format - source is a GitHub/GitLab URL
		const sourceUrl = rawConfig.source as string;
		const parsedSource = parseGitSourceUrl(sourceUrl);

		resolvedKind = (rawConfig.kind as PubkyServiceRegistryEntry["kind"]) ||
			(rawConfig.manifest as Record<string, unknown>)?.kind as PubkyServiceRegistryEntry["kind"] ||
			"single_command";
		resolvedSource = parsedSource;
		resolvedVersion = rawConfig.sourceVersion as string | undefined;

		// Command can be at root level or in manifest
		resolvedCommand = rawConfig.command as string ||
			(rawConfig.manifest as Record<string, unknown>)?.command as string;
	} else {
		// Structured format (PubkyServiceConfig)
		const serviceConfig = rawConfig as unknown as PubkyServiceConfig;

		if (serviceConfig.registryRef && serviceConfig.serviceId) {
			// A) Registry-based resolution
			const registryResponse = await client.fetch(serviceConfig.registryRef);
			if (!registryResponse.ok) {
				throw new Error(`Failed to fetch service registry from ${serviceConfig.registryRef}`);
			}
			const registry = await registryResponse.json() as PubkyServiceRegistry;

			const registryEntry = registry.services.find((s) => s.id === serviceConfig.serviceId);
			if (!registryEntry) {
				throw new Error(
					`Service ${serviceConfig.serviceId} not found in registry ${serviceConfig.registryRef}`,
				);
			}
			resolvedKind = registryEntry.kind;
			resolvedSource = registryEntry.source;
			resolvedName = serviceConfig.name || registryEntry.name;
			resolvedVersion = registryEntry.source.version;
			resolvedCommand = serviceConfig.command;
		} else if (
			serviceConfig.kind && serviceConfig.source && typeof serviceConfig.source === "object"
		) {
			// B) Inline resolution with structured source
			resolvedKind = serviceConfig.kind;
			resolvedSource = serviceConfig.source;
			resolvedVersion = serviceConfig.source.version;
			resolvedCommand = serviceConfig.command;
		} else {
			throw new Error(
				"Invalid service config: expected either { registryRef, serviceId }, { kind, source: {...} }, or { source: 'url', kind, command }",
			);
		}
	}

	// Resolve datasets by fetching JSON blobs
	const resolvedDatasets: Record<string, unknown> = {};
	const allDatasets = {
		...(rawConfig.datasets as Record<string, string> | undefined),
		...serviceRef.overrides?.datasets,
	};

	for (const [name, url] of Object.entries(allDatasets || {})) {
		if (typeof url === "string" && url.startsWith("pubky://")) {
			try {
				const dataResponse = await client.fetch(url);
				if (dataResponse.ok) {
					const datasetJson = await dataResponse.json() as Record<string, unknown>;
					// Dataset from configurator has the actual data in a 'data' field
					resolvedDatasets[name] = datasetJson.data ?? datasetJson;
				} else {
					console.warn(`Failed to fetch dataset ${name} from ${url}`);
					resolvedDatasets[name] = { __error: `Failed to fetch: ${dataResponse.status}` };
				}
			} catch (error) {
				console.warn(`Error fetching dataset ${name} from ${url}:`, error);
				resolvedDatasets[name] = { __error: `Fetch error: ${error}` };
			}
		}
	}

	// Enrich calendar metadata by fetching from homeserver if names are missing
	const mergedConfig = {
		...(rawConfig.config as Record<string, unknown> | undefined),
		...serviceRef.overrides?.config,
	};
	if (Array.isArray(mergedConfig.calendars)) {
		// Normalize: convert plain URI strings to CalendarOption objects
		const normalized: Record<string, unknown>[] = [];
		for (const entry of mergedConfig.calendars) {
			if (typeof entry === "string") {
				normalized.push({ uri: normalizeCalendarUri(entry) });
			} else if (typeof entry === "object" && entry !== null) {
				const cal = entry as Record<string, unknown>;
				if (typeof cal.uri === "string") {
					cal.uri = normalizeCalendarUri(cal.uri);
				}
				normalized.push(cal);
			}
		}

		// Fetch names from homeserver for calendars missing names
		for (const cal of normalized) {
			if (typeof cal.uri === "string" && !cal.name) {
				try {
					const calResponse = await client.fetch(cal.uri as string);
					if (calResponse.ok) {
						const calData = await calResponse.json() as Record<string, unknown>;
						if (typeof calData.name === "string") {
							cal.name = calData.name;
						}
						if (typeof calData.description === "string" && !cal.description) {
							cal.description = calData.description;
						}
					}
				} catch {
					// Calendar fetch failed — name stays empty, will use URI fallback
				}
			}
		}
		mergedConfig.calendars = normalized;
	}

	// Build the resolved service spec
	const entry = determineServiceEntry({
		id: (rawConfig.manifest as Record<string, unknown>)?.serviceId as string ||
			rawConfig.id as string ||
			"unknown",
		name: resolvedName,
		kind: resolvedKind,
		source: resolvedSource,
	});

	// Command comes from: override > service config > manifest
	// Command is required for single_command and command_flow, but not for listeners
	const command = serviceRef.overrides?.command || resolvedCommand;
	if (!command && resolvedKind !== "listener") {
		throw new Error(
			`Service config missing required 'command' field: ${serviceRef.serviceConfigRef}`,
		);
	}

	const config: Record<string, unknown> = {
		...mergedConfig,
		datasets: Object.keys(resolvedDatasets).length > 0 ? resolvedDatasets : undefined,
	};

	// Filter out undefined values
	const filteredConfig = Object.fromEntries(
		Object.entries(config).filter(([, v]) => v !== undefined),
	);

	// Extract serviceId from config manifest (the web configurator stores it there)
	const serviceId = (rawConfig.manifest as Record<string, unknown>)?.serviceId as string ||
		undefined;

	// Extract net permissions from manifest or top-level config
	const net = (rawConfig.manifest as Record<string, unknown>)?.net as string[] ||
		rawConfig.net as string[] ||
		undefined;

	return {
		name: resolvedName,
		command: command || resolvedName.toLowerCase().replace(/\s+/g, "_"), // Fallback for listeners
		kind: resolvedKind,
		entry,
		version: resolvedVersion,
		source: `${resolvedSource.type}:${resolvedSource.location}`,
		config: Object.keys(filteredConfig).length > 0 ? filteredConfig : undefined,
		serviceId,
		net,
		deleteCommandMessage: rawConfig.deleteCommandMessage as boolean | undefined,
	};
}

/**
 * Determine the entry point for a service based on its registry entry.
 * For GitHub sources pointing to this repository, maps to local paths.
 */
function determineServiceEntry(registryEntry: PubkyServiceRegistryEntry): string {
	switch (registryEntry.source.type) {
		case "local":
			// For local services, the entry is a direct path or the configured entry point
			return registryEntry.source.entry || registryEntry.source.location;
		case "jsr":
			// For JSR packages, we'll need to resolve this at runtime
			return `jsr:${registryEntry.source.location}@${registryEntry.source.version || "latest"}`;
		case "github": {
			// For GitHub sources, check if it points to this repository and map to local path
			const location = registryEntry.source.location;
			const entry = registryEntry.source.entry || "./service.ts";

			// If this is the pubky_bot_builder_telegram repo, resolve to local path
			if (
				location.includes("pubky_bot_builder_telegram") ||
				location.includes("pubky-bot-builder-telegram")
			) {
				// The entry is already in the form "./packages/xxx/service.ts"
				return entry.startsWith("./") ? entry : `./${entry}`;
			}

			// For external GitHub repos, we'd need to fetch and bundle remotely
			// For now, treat the entry as a local path relative to the project
			console.warn(
				`GitHub source ${location} may not be available locally. Attempting to use entry: ${entry}`,
			);
			return entry.startsWith("./") ? entry : `./${entry}`;
		}
		default:
			throw new Error(`Unsupported service source type: ${registryEntry.source.type}`);
	}
}
