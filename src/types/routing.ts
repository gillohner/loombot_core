// src/types/routing.ts
// Routing snapshot & route type definitions extracted from snapshot builder.
export interface RouteMeta {
	id: string;
	command: string;
	description?: string;
}
export interface BaseRoute {
	serviceId: string; // feature id — what the dispatcher routes by
	/** Source file path (relative to project root) executed by the sandbox. */
	entry: string;
	config?: Record<string, unknown>;
	meta: RouteMeta;
	datasets?: Record<string, unknown>; // resolved dataset blobs (json / future binary refs)
	net?: string[]; // allowed network domains for sandbox
	deleteCommandMessage?: boolean; // delete user's command message after bot responds
	/**
	 * The hardcoded service id from the service module's manifest (e.g.
	 * "event_creator", "meetups"). Services use this to namespace inline-
	 * keyboard callback data, so the dispatcher needs it as a fallback
	 * lookup key when the feature id in config.yaml differs from the
	 * underlying service's manifest id.
	 */
	manifestServiceId?: string;
}
export interface CommandRoute extends BaseRoute {
	kind: "single_command" | "command_flow";
}
export interface ListenerRoute extends BaseRoute {
	kind: "listener";
}
export type AnyRoute = CommandRoute | ListenerRoute;
export interface RoutingSnapshot {
	commands: Readonly<Record<string, CommandRoute>>;
	listeners: Readonly<ListenerRoute[]>;
	builtAt: number;
	version: number;
	configHash?: string;
}
