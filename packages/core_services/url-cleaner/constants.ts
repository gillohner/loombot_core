// packages/core_services/url-cleaner/constants.ts
// URL Cleaner service constants, schemas, and validation
import type { DatasetSchemas, JSONSchema } from "@sdk/mod.ts";

export const URL_CLEANER_SERVICE_ID = "url_cleaner" as const;
export const URL_CLEANER_VERSION = "1.0.0" as const;

// ============================================================================
// Types
// ============================================================================

/**
 * Alternative frontend mapping configuration
 * When a URL matches the pattern, offer an alternative frontend
 */
export interface AltFrontendMapping {
	/** Human-readable name for this mapping */
	name: string;
	/** Regex pattern to match against the cleaned URL (matched against full URL) */
	pattern: string;
	/** Replacement URL pattern. Use $1, $2 etc for capture groups from pattern */
	replacement: string;
	/** Optional: only match specific paths (regex) */
	pathPattern?: string;
	/** Whether this mapping is enabled */
	enabled?: boolean;
}

/**
 * Complete alt-frontends dataset structure
 */
export interface AltFrontendsDataset {
	/** Version of the dataset schema */
	version: string;
	/** Description of this dataset */
	description?: string;
	/** The frontend mappings */
	mappings: AltFrontendMapping[];
}

// ============================================================================
// JSON Schemas
// ============================================================================

/**
 * Schema for a single alt-frontend mapping
 */
const ALT_FRONTEND_MAPPING_SCHEMA: JSONSchema = {
	type: "object",
	title: "Alternative Frontend Mapping",
	description: "Maps URLs matching a pattern to an alternative frontend",
	properties: {
		name: {
			type: "string",
			title: "Name",
			description: "Human-readable name for this mapping (e.g., 'Twitter to Xcancel')",
			minLength: 1,
			maxLength: 100,
		},
		pattern: {
			type: "string",
			title: "URL Pattern",
			description: "Regex pattern to match against the URL. Use capture groups () for replacement.",
			minLength: 1,
		},
		replacement: {
			type: "string",
			title: "Replacement URL",
			description:
				"Replacement URL pattern. Use $1, $2, etc. for captured groups from the pattern.",
			minLength: 1,
		},
		pathPattern: {
			type: "string",
			title: "Path Pattern (Optional)",
			description: "Optional regex to match only specific URL paths",
		},
		enabled: {
			type: "boolean",
			title: "Enabled",
			description: "Whether this mapping is active",
			default: true,
		},
	},
	required: ["name", "pattern", "replacement"],
};

/**
 * Schema for the alt-frontends dataset
 */
export const ALT_FRONTENDS_DATASET_SCHEMA: JSONSchema = {
	type: "object",
	title: "Alternative Frontends Dataset",
	description: "Configuration for alternative frontend URL mappings",
	$id: "url-cleaner/alt-frontends",
	properties: {
		version: {
			type: "string",
			title: "Schema Version",
			description: "Version of this dataset schema",
			pattern: "^\\d+\\.\\d+\\.\\d+$",
		},
		description: {
			type: "string",
			title: "Description",
			description: "Optional description of this dataset",
			maxLength: 500,
		},
		mappings: {
			type: "array",
			title: "Mappings",
			description: "List of alternative frontend mappings",
			items: ALT_FRONTEND_MAPPING_SCHEMA,
			minItems: 0,
		},
	},
	required: ["version", "mappings"],
};

/**
 * Schema for the service config
 */
export const URL_CLEANER_CONFIG_SCHEMA: JSONSchema = {
	type: "object",
	title: "URL Cleaner Configuration",
	description: "Configuration options for the URL cleaner service",
	properties: {
		showOriginalUrl: {
			type: "boolean",
			title: "Show Original URL",
			description: "Include the original URL in the response message",
			default: false,
		},
		showCleanedUrl: {
			type: "boolean",
			title: "Show Cleaned URL",
			description: "Show the cleaned URL even if no alt-frontend matches",
			default: true,
		},
		showRemovedParams: {
			type: "boolean",
			title: "Show Removed Parameters",
			description: "List which tracking parameters were removed",
			default: false,
		},
		silentIfUnchanged: {
			type: "boolean",
			title: "Silent If Unchanged",
			description: "Don't respond if URL is already clean and no alt-frontend matches",
			default: true,
		},
		maxUrlsPerMessage: {
			type: "integer",
			title: "Max URLs Per Message",
			description: "Maximum number of URLs to process per message",
			minimum: 1,
			maximum: 10,
			default: 5,
		},
		messageTtl: {
			type: "integer",
			title: "Message TTL",
			description: "Auto-delete bot messages after this many seconds (0 to keep forever)",
			minimum: 0,
			default: 300,
		},
	},
};

/**
 * Dataset schemas for the service
 */
export const URL_CLEANER_DATASET_SCHEMAS: DatasetSchemas = {
	altFrontends: {
		schema: ALT_FRONTENDS_DATASET_SCHEMA,
		description: "Alternative frontend mappings (e.g., Twitter → Xcancel, YouTube → Invidious)",
		required: false,
		example: {
			version: "1.1.0",
			description: "Default alternative frontends",
			mappings: [
				{
					name: "Twitter/X to Xcancel",
					pattern: "^https?://(?:www\\.)?(twitter\\.com|x\\.com)/(.+)$",
					replacement: "https://xcancel.com/$2",
					enabled: true,
				},
				{
					name: "YouTube to Invidious",
					pattern:
						"^https?://(?:(?:www\\.)?youtube\\.com/(?:watch\\?v=|shorts/|embed/)|youtu\\.be/)([^&?/]+).*$",
					replacement: "https://yewtu.be/watch?v=$1",
					enabled: true,
				},
				{
					name: "Reddit to Redlib",
					pattern: "^https?://(?:www\\.|old\\.)?reddit\\.com/(.+)$",
					replacement: "https://l.opnxng.com/$1",
					enabled: true,
				},
			],
		},
	},
};

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
	path: string;
	message: string;
}

export interface ValidationResult {
	valid: boolean;
	errors: ValidationError[];
}

/**
 * Validates an alt-frontend mapping
 */
export function validateMapping(mapping: unknown, index: number): ValidationError[] {
	const errors: ValidationError[] = [];
	const prefix = `mappings[${index}]`;

	if (typeof mapping !== "object" || mapping === null) {
		errors.push({ path: prefix, message: "Mapping must be an object" });
		return errors;
	}

	const m = mapping as Record<string, unknown>;

	// Required fields
	if (typeof m.name !== "string" || m.name.length === 0) {
		errors.push({
			path: `${prefix}.name`,
			message: "Name is required and must be a non-empty string",
		});
	} else if (m.name.length > 100) {
		errors.push({ path: `${prefix}.name`, message: "Name must be 100 characters or less" });
	}

	if (typeof m.pattern !== "string" || m.pattern.length === 0) {
		errors.push({
			path: `${prefix}.pattern`,
			message: "Pattern is required and must be a non-empty string",
		});
	} else {
		// Validate regex
		try {
			new RegExp(m.pattern);
		} catch (e) {
			errors.push({ path: `${prefix}.pattern`, message: `Invalid regex: ${(e as Error).message}` });
		}
	}

	if (typeof m.replacement !== "string" || m.replacement.length === 0) {
		errors.push({
			path: `${prefix}.replacement`,
			message: "Replacement is required and must be a non-empty string",
		});
	}

	// Optional fields
	if (m.pathPattern !== undefined) {
		if (typeof m.pathPattern !== "string") {
			errors.push({ path: `${prefix}.pathPattern`, message: "Path pattern must be a string" });
		} else if (m.pathPattern.length > 0) {
			try {
				new RegExp(m.pathPattern);
			} catch (e) {
				errors.push({
					path: `${prefix}.pathPattern`,
					message: `Invalid regex: ${(e as Error).message}`,
				});
			}
		}
	}

	if (m.enabled !== undefined && typeof m.enabled !== "boolean") {
		errors.push({ path: `${prefix}.enabled`, message: "Enabled must be a boolean" });
	}

	return errors;
}

/**
 * Validates the complete alt-frontends dataset
 */
export function validateAltFrontendsDataset(data: unknown): ValidationResult {
	const errors: ValidationError[] = [];

	if (typeof data !== "object" || data === null) {
		return { valid: false, errors: [{ path: "", message: "Dataset must be an object" }] };
	}

	const d = data as Record<string, unknown>;

	// Version
	if (typeof d.version !== "string") {
		errors.push({ path: "version", message: "Version is required and must be a string" });
	} else if (!/^\d+\.\d+\.\d+$/.test(d.version)) {
		errors.push({ path: "version", message: "Version must be in semver format (e.g., 1.0.0)" });
	}

	// Description (optional)
	if (d.description !== undefined) {
		if (typeof d.description !== "string") {
			errors.push({ path: "description", message: "Description must be a string" });
		} else if (d.description.length > 500) {
			errors.push({ path: "description", message: "Description must be 500 characters or less" });
		}
	}

	// Mappings
	if (!Array.isArray(d.mappings)) {
		errors.push({ path: "mappings", message: "Mappings is required and must be an array" });
	} else {
		for (let i = 0; i < d.mappings.length; i++) {
			errors.push(...validateMapping(d.mappings[i], i));
		}
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validates service config
 */
export function validateConfig(config: unknown): ValidationResult {
	const errors: ValidationError[] = [];

	if (config === undefined || config === null) {
		return { valid: true, errors: [] }; // Config is optional
	}

	if (typeof config !== "object") {
		return { valid: false, errors: [{ path: "", message: "Config must be an object" }] };
	}

	const c = config as Record<string, unknown>;

	const boolFields = [
		"showOriginalUrl",
		"showCleanedUrl",
		"showRemovedParams",
		"silentIfUnchanged",
	];
	for (const field of boolFields) {
		if (c[field] !== undefined && typeof c[field] !== "boolean") {
			errors.push({ path: field, message: `${field} must be a boolean` });
		}
	}

	if (c.maxUrlsPerMessage !== undefined) {
		if (typeof c.maxUrlsPerMessage !== "number" || !Number.isInteger(c.maxUrlsPerMessage)) {
			errors.push({ path: "maxUrlsPerMessage", message: "maxUrlsPerMessage must be an integer" });
		} else if (c.maxUrlsPerMessage < 1 || c.maxUrlsPerMessage > 10) {
			errors.push({
				path: "maxUrlsPerMessage",
				message: "maxUrlsPerMessage must be between 1 and 10",
			});
		}
	}

	return { valid: errors.length === 0, errors };
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_CONFIG = {
	showOriginalUrl: false,
	showCleanedUrl: true,
	showRemovedParams: false,
	silentIfUnchanged: true,
	maxUrlsPerMessage: 5,
} as const;

/**
 * Additional tracking parameters to strip that tidy-url misses.
 * Keyed by hostname pattern (regex), with an array of param names to remove.
 */
export const EXTRA_TRACKING_PARAMS: Record<string, string[]> = {
	// YouTube `si` is a sharing tracking identifier
	"(?:www\\.)?youtube\\.com|youtu\\.be": ["si"],
	// X/Twitter — tidy-url knows twitter.com but not x.com
	"(?:www\\.)?x\\.com": ["s", "t", "ref_src", "ref_url"],
	// Instagram tracking
	"(?:www\\.)?instagram\\.com": ["igsh"],
	// Reddit sharing trackers
	"(?:www\\.|old\\.)?reddit\\.com": ["share_id", "ref", "ref_source"],
	// TikTok sharing/device trackers
	"(?:www\\.)?tiktok\\.com": ["_t", "_r", "is_from_webapp", "sender_device", "sender_web_id"],
	// Medium source tracking
	"(?:www\\.)?medium\\.com": ["source"],
};

export const DEFAULT_ALT_FRONTENDS: AltFrontendsDataset = {
	version: "1.1.0",
	description: "Built-in alternative frontend mappings",
	mappings: [
		{
			name: "Twitter/X → Xcancel",
			pattern: "^https?://(?:www\\.)?(twitter\\.com|x\\.com)/(.+)$",
			replacement: "https://xcancel.com/$2",
			enabled: true,
		},
		{
			name: "YouTube → Invidious",
			pattern:
				"^https?://(?:(?:www\\.)?youtube\\.com/(?:watch\\?v=|shorts/|embed/)|youtu\\.be/)([^&?/]+).*$",
			replacement: "https://yewtu.be/watch?v=$1",
			enabled: true,
		},
		{
			name: "Reddit → Redlib",
			pattern: "^https?://(?:www\\.|old\\.)?reddit\\.com/(.+)$",
			replacement: "https://l.opnxng.com/$1",
			enabled: true,
		},
{
			name: "Medium → Scribe",
			pattern: "^https?://(?:www\\.)?medium\\.com/(.+)$",
			replacement: "https://scribe.rip/$1",
			enabled: true,
		},
	],
};
