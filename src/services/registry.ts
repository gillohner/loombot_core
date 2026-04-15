// src/services/registry.ts
// Static registry of operator-shipped services. Maps the `service:` key in
// config.yaml to the service's source file path + its natural kind. New
// services are added here.

export type ServiceKind = "single_command" | "command_flow" | "listener";

export interface ServiceRegistryEntry {
	/** Source file path, relative to project root. The sandbox host spawns
	 *  `deno run` against this path directly — no pre-bundling. */
	entry: string;
	/** Natural kind of the service. Determines whether the feature becomes a
	 *  command route or a listener route in the snapshot. */
	kind: ServiceKind;
	/** Default allowed network domains for the sandbox. Can be extended per-feature. */
	net?: string[];
	/** Default request timeout override (ms). */
	timeoutMs?: number;
	/** If true, features using this service are auto-disabled unless
	 *  pubky.enabled is true in the operator config. */
	requiresPubky?: boolean;
}

export const SERVICE_REGISTRY: Record<string, ServiceRegistryEntry> = {
	help: {
		entry: "./packages/core_services/help/service.ts",
		kind: "single_command",
	},
	simple_response: {
		entry: "./packages/core_services/simple-response/service.ts",
		kind: "single_command",
	},
	links: {
		entry: "./packages/core_services/links/service.ts",
		kind: "command_flow",
	},
	meetups: {
		entry: "./packages/core_services/meetups/service.ts",
		kind: "command_flow",
		net: ["nexus.eventky.app"],
	},
	event_creator: {
		entry: "./packages/core_services/event-creator/service.ts",
		kind: "command_flow",
		net: ["nominatim.openstreetmap.org"],
		requiresPubky: true,
	},
	when2meet: {
		entry: "./packages/core_services/when2meet/service.ts",
		kind: "command_flow",
	},
	triggerwords: {
		entry: "./packages/core_services/triggerwords/service.ts",
		kind: "listener",
	},
	url_cleaner: {
		entry: "./packages/core_services/url-cleaner/service.ts",
		kind: "listener",
	},
	new_member: {
		entry: "./packages/core_services/new-member/service.ts",
		kind: "listener",
	},
};

export function serviceExists(name: string): boolean {
	return name in SERVICE_REGISTRY;
}

export function getServiceEntry(name: string): string {
	const entry = SERVICE_REGISTRY[name];
	if (!entry) throw new Error(`Unknown service: ${name}`);
	return entry.entry;
}

export function getServiceKind(name: string): ServiceKind {
	const entry = SERVICE_REGISTRY[name];
	if (!entry) throw new Error(`Unknown service: ${name}`);
	return entry.kind;
}

export function getServiceNet(name: string): string[] | undefined {
	return SERVICE_REGISTRY[name]?.net;
}

export function serviceRequiresPubky(name: string): boolean {
	return SERVICE_REGISTRY[name]?.requiresPubky === true;
}

export function listServiceNames(): string[] {
	return Object.keys(SERVICE_REGISTRY);
}
