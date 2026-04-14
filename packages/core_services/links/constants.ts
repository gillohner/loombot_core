// packages/core_services/links/constants.ts
// Links - Command flow service that displays categorized links with inline keyboard navigation

import { createI18n, type DatasetSchemas, escapeHtml, type JSONSchema } from "@sdk/mod.ts";
import en from "./locales/en.ts";
import de from "./locales/de.ts";

const tRaw = createI18n({ en, de }, "en");
export function tLinks(key: string, locale?: string): string {
	return tRaw(key, undefined, locale ?? "en");
}

// ============================================================================
// Service Identity
// ============================================================================

export const LINKS_SERVICE_ID = "links" as const;
export const LINKS_VERSION = "1.0.0" as const;
export const LINKS_COMMAND = "links" as const;
export const LINKS_REPLACE_GROUP = "links_menu" as const;

// ============================================================================
// Types
// ============================================================================

export interface LinkCategory {
	name: string;
	links: { title: string; url: string }[];
}

export interface LinksConfig {
	/** Header message shown above category buttons */
	title?: string;
	/** Disable URL previews in messages (default: true) */
	disableLinkPreview?: boolean;
}

export interface LinksDataset {
	categories: LinkCategory[];
}

// ============================================================================
// JSON Schemas
// ============================================================================

export const LINKS_CONFIG_SCHEMA: JSONSchema = {
	type: "object",
	properties: {
		title: {
			type: "string",
			title: "Header Message",
			description: "Message shown above the category buttons (default: 'Select a category:')",
			maxLength: 200,
		},
		disableLinkPreview: {
			type: "boolean",
			title: "Disable Link Preview",
			description: "Disable URL previews in messages (Telegram only renders the first URL preview)",
			default: true,
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

export const CATEGORIES_DATASET_SCHEMA: JSONSchema = {
	type: "object",
	title: "Link Categories",
	description: "Categories of links to display in the bot",
	properties: {
		categories: {
			type: "array",
			title: "Categories",
			description: "List of link categories",
			items: {
				type: "object",
				properties: {
					name: {
						type: "string",
						title: "Category Name",
						description: "Display name for this category",
						minLength: 1,
						maxLength: 50,
					},
					links: {
						type: "array",
						title: "Links",
						description: "Links in this category",
						items: {
							type: "object",
							properties: {
								title: {
									type: "string",
									title: "Link Title",
									minLength: 1,
									maxLength: 100,
								},
								url: {
									type: "string",
									title: "URL",
									format: "uri",
								},
							},
							required: ["title", "url"],
						},
						minItems: 1,
					},
				},
				required: ["name", "links"],
			},
			minItems: 1,
		},
	},
	required: ["categories"],
};

export const LINKS_DATASET_SCHEMAS: DatasetSchemas = {
	categories: {
		schema: CATEGORIES_DATASET_SCHEMA,
		description: "Link categories to display in the /links command",
		required: false,
		example: {
			categories: [
				{
					name: "Resources",
					links: [
						{ title: "Documentation", url: "https://docs.example.com" },
						{ title: "GitHub", url: "https://github.com/example" },
					],
				},
			],
		},
	},
};

// ============================================================================
// Default Data
// ============================================================================

export const DEFAULT_CATEGORIES: LinkCategory[] = [
	{
		name: "General",
		links: [
			{ title: "Pubky", url: "https://pubky.org" },
			{ title: "Docs", url: "https://docs.pubky.org" },
		],
	},
	{
		name: "Community",
		links: [{ title: "Dezentralschweiz", url: "https://dezentralschweiz.ch" }],
	},
];

export const DEFAULT_CONFIG: LinksConfig = {
	// `title` intentionally omitted — service falls back to
	// tLinks("default_title", locale) when the operator doesn't set one.
	disableLinkPreview: true,
};

// ============================================================================
// Helpers
// ============================================================================

export function getCategories(datasets?: Record<string, unknown>): LinkCategory[] {
	if (datasets?.categories) {
		const ds = datasets.categories as LinksDataset;
		if (ds.categories && Array.isArray(ds.categories) && ds.categories.length > 0) {
			return ds.categories;
		}
	}
	return DEFAULT_CATEGORIES;
}

export function renderCategory(
	categories: LinkCategory[],
	idx: number,
	locale?: string,
): string {
	const cat = categories[idx];
	if (!cat) return tLinks("unknown_category", locale);
	return `<b>${escapeHtml(cat.name)}</b>\n` +
		cat.links.map((l) => `• <a href="${l.url}">${escapeHtml(l.title)}</a>`).join("\n");
}
