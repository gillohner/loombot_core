// sdk/services_types.ts
// Unified supplemental service-related types not already covered by the
// existing sdk/service.ts and sdk/responses/types.ts. For overlapping symbols
// we re-export rather than redefine to avoid conflicts.

export type { ServiceKind } from "./service.ts";

export const SERVICE_PROTOCOL_SCHEMA_VERSION = 1 as const;

export type ServiceCapability = "net" | "crypto" | "timers";
export interface ServiceCapabilityRequest {
	capability: ServiceCapability;
	scope?: string[];
}
export interface ServiceManifestProtocol {
	schemaVersion: number; // protocol schema version (not sdk schema version)
	capabilities?: ServiceCapabilityRequest[];
}

// State directives are re-exported from existing sdk/state.ts to avoid duplication.
import type { StateDirective } from "./state.ts";
import type { ServiceResponse as CanonicalServiceResponse } from "./responses/types.ts";

// Re-export the canonical ServiceResponse union.
export type { ServiceResponse } from "./responses/types.ts";

export interface DispatcherResult {
	response: import("./responses/types.ts").ServiceResponse | null;
}

// Sandbox event & payload types
export interface SandboxExecuteEventCommand {
	type: "command";
	token: string;
	state?: Record<string, unknown>;
	stateVersion?: number;
}
export interface SandboxExecuteEventMessage {
	type: "message";
	message?: unknown;
	state?: Record<string, unknown>;
	stateVersion?: number;
}
export interface SandboxExecuteEventCallback {
	type: "callback";
	data: string;
	state?: Record<string, unknown>;
	stateVersion?: number;
}
export type SandboxExecuteEvent =
	| SandboxExecuteEventCommand
	| SandboxExecuteEventMessage
	| SandboxExecuteEventCallback;

export interface SandboxManifest {
	schemaVersion: number;
}
export interface SandboxPayload {
	event: SandboxExecuteEvent;
	ctx: {
		chatId: string;
		userId: string;
		serviceConfig?: Record<string, unknown>;
		routeMeta?: { id: string; command: string; description?: string };
		datasets?: Record<string, unknown>;
		botPublicKey?: string;
		/** Operator-level language code (e.g. "en", "de"). Fall back to "en". */
		locale?: string;
	};
	manifest?: SandboxManifest;
}
export interface SandboxExecuteResult {
	ok: boolean;
	response?: CanonicalServiceResponse;
	error?: string;
	state?: Record<string, unknown>;
}

export type { StateDirective };
