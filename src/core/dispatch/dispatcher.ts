// src/core/dispatch/dispatcher.ts
// Moved from src/core/dispatcher.ts
import { buildSnapshot } from "@core/snapshot/snapshot.ts";
import { sandboxHost } from "@core/sandbox/host.ts";
import { getServiceBundle } from "@core/config/store.ts";
import { log } from "@core/util/logger.ts";
import { pubkyWriter } from "@core/pubky/writer.ts";
import {
	applyStateDirective,
	clearActiveFlow,
	getActiveFlow,
	getServiceState,
	setActiveFlow,
} from "@core/state/state.ts";
import { DispatcherResult } from "@sdk/mod.ts";
import type { ServiceResponse } from "@sdk/mod.ts";
import type { SandboxPayload } from "@sdk/mod.ts";
import type { ExecutePayload } from "@schema/sandbox.ts";

/**
 * Apply per-service messageTtl from config if the response doesn't already have a ttl.
 * Priority: service code ttl > config messageTtl > global DEFAULT_MESSAGE_TTL.
 */
function applyConfigTtl(
	response: ServiceResponse,
	config?: Record<string, unknown>,
): void {
	if (!config) return;
	const configTtl = config.messageTtl;
	if (typeof configTtl !== "number") return;
	// Only override if the service didn't set an explicit ttl
	if ((response as { ttl?: number }).ttl === undefined) {
		(response as { ttl?: number }).ttl = configTtl;
	}
}

type BaseCtx = { chatId: string; userId: string };
type CommandEvent = { kind: "command"; command: string; ctx: BaseCtx };
type CallbackEvent = { kind: "callback"; data: string; ctx: BaseCtx };
type MessageEvent = { kind: "message"; message: unknown; ctx: BaseCtx };
export type DispatchEvent = CommandEvent | CallbackEvent | MessageEvent;

export async function dispatch(evt: DispatchEvent): Promise<DispatcherResult> {
	if (evt.kind === "command") {
		const snapshot = await buildSnapshot(evt.ctx.chatId);
		const route = snapshot.commands[evt.command];
		if (!route) {
			log.debug("dispatch.miss", { command: evt.command });
			return { response: null };
		}
		// Load existing state (if any)
		const existing = getServiceState({
			chatId: evt.ctx.chatId,
			userId: evt.ctx.userId,
			serviceId: route.serviceId,
		});
		const payload: SandboxPayload = {
			event: { type: "command", token: evt.command, state: existing?.value },
			ctx: {
				chatId: evt.ctx.chatId,
				userId: evt.ctx.userId,
				serviceConfig: route.config,
				routeMeta: route.meta,
				datasets: route.datasets,
				botPublicKey: pubkyWriter.getPublicKey() ?? undefined,
			},
			manifest: { schemaVersion: 1 },
		};
		const bundle = getServiceBundle(route.bundleHash);
		if (!bundle) {
			log.error("dispatch.bundle.missing", { bundleHash: route.bundleHash });
			return { response: { kind: "error", text: "bundle missing" } } as DispatcherResult;
		}
		// Pass the payload directly (matches sdk runtime expectation)
		const res = await sandboxHost.run<ServiceResponse>(
			bundle.data_url,
			payload as unknown as ExecutePayload,
			{
				timeoutMs: route.net ? 10000 : 2000,
				hasNpm: bundle.has_npm === 1,
				net: route.net,
			},
		);
		if (!res.ok) {
			log.error("sandbox.command.error", {
				command: evt.command,
				error: res.error,
			});
			return { response: { kind: "error", text: res.error ?? "sandbox error" } };
		}
		log.debug("sandbox.command.ok", { command: evt.command });
		// Apply state directive if present
		if (res.value?.state) {
			const after = applyStateDirective({
				directive: res.value.state,
				chatId: evt.ctx.chatId,
				userId: evt.ctx.userId,
				serviceId: route.serviceId,
			});
			// Manage active flow pointer
			if (route.kind === "command_flow") {
				if (res.value.state.op === "clear") {
					clearActiveFlow(evt.ctx.chatId, evt.ctx.userId);
				} else {
					setActiveFlow(evt.ctx.chatId, evt.ctx.userId, route.serviceId);
				}
			}
			log.debug("dispatch.state.applied", {
				serviceId: route.serviceId,
				op: res.value.state.op,
				version: after?.version,
			});
		} else if (route.kind === "command_flow") {
			// If command invoked a flow but did not emit a state directive and no existing state, mark active
			const existing = getServiceState({
				chatId: evt.ctx.chatId,
				userId: evt.ctx.userId,
				serviceId: route.serviceId,
			});
			if (existing) {
				setActiveFlow(evt.ctx.chatId, evt.ctx.userId, route.serviceId);
			}
		}
		const response = res.value ?? { kind: "none" } as ServiceResponse;
		if (response.kind !== "none" && route.deleteCommandMessage) {
			response.deleteTrigger = true;
		}
		// Apply per-service messageTtl from config (overrides global default, overridden by service code)
		applyConfigTtl(response, route.config);
		return { response };
	}
	if (evt.kind === "callback") {
		const snapshot = await buildSnapshot(evt.ctx.chatId);
		// Expected format: svc:<identifier>|<payload>
		// The identifier can be either a serviceId or a command name
		let identifier: string | undefined;
		let payloadData = evt.data;
		if (payloadData.startsWith("svc:")) {
			const pipeIdx = payloadData.indexOf("|");
			if (pipeIdx > 4) {
				identifier = payloadData.slice(4, pipeIdx);
				payloadData = payloadData.slice(pipeIdx + 1);
			} else {
				identifier = payloadData.slice(4);
				payloadData = "";
			}
		}
		if (!identifier) {
			log.debug("dispatch.callback.unparsed", { data: evt.data });
			return { response: null };
		}
		// First try direct command lookup (most reliable - command is always stable)
		let route = snapshot.commands[identifier];
		// Fall back to searching by serviceId (for backward compatibility)
		if (!route) {
			route = Object.values(snapshot.commands).find(
				(r) => r.serviceId === identifier,
			) as typeof route;
		}
		if (!route) {
			log.debug("dispatch.callback.unknown_service", { identifier });
			return { response: null };
		}
		const existing = getServiceState({
			chatId: evt.ctx.chatId,
			userId: evt.ctx.userId,
			serviceId: route.serviceId,
		});
		const payload: SandboxPayload = {
			event: { type: "callback", data: payloadData, state: existing?.value },
			ctx: {
				chatId: evt.ctx.chatId,
				userId: evt.ctx.userId,
				serviceConfig: route.config,
				routeMeta: route.meta,
				datasets: route.datasets,
				botPublicKey: pubkyWriter.getPublicKey() ?? undefined,
			},
			manifest: { schemaVersion: 1 },
		};
		const bundle = getServiceBundle(route.bundleHash);
		if (!bundle) {
			log.error("dispatch.bundle.missing", { bundleHash: route?.bundleHash });
			return { response: { kind: "error", text: "bundle missing" } };
		}
		const res = await sandboxHost.run<ServiceResponse>(
			bundle.data_url,
			payload as unknown as ExecutePayload,
			{
				timeoutMs: route.net ? 10000 : 2000,
				hasNpm: bundle.has_npm === 1,
				net: route.net,
			},
		);
		if (!res.ok) {
			log.error("sandbox.callback.error", { error: res.error, serviceId: route.serviceId });
			return { response: { kind: "error", text: res.error ?? "sandbox error" } };
		}
		if (res.value?.state) {
			const after = applyStateDirective({
				directive: res.value.state,
				chatId: evt.ctx.chatId,
				userId: evt.ctx.userId,
				serviceId: route.serviceId,
			});
			if (route.kind === "command_flow") {
				if (res.value.state.op === "clear") {
					clearActiveFlow(evt.ctx.chatId, evt.ctx.userId);
				} else setActiveFlow(evt.ctx.chatId, evt.ctx.userId, route.serviceId);
			}
			log.debug("dispatch.callback.state", {
				serviceId: route.serviceId,
				op: res.value.state.op,
				version: after?.version,
			});
		}
		log.debug("dispatch.callback.ok", { serviceId: route.serviceId, kind: res.value?.kind });
		const cbResponse = res.value ?? { kind: "none" } as ServiceResponse;
		// Apply per-service messageTtl from config (overrides global default, overridden by service code)
		applyConfigTtl(cbResponse, route.config);
		return { response: cbResponse };
	}
	if (evt.kind === "message") {
		const snapshot = await buildSnapshot(evt.ctx.chatId);
		const msgText = (evt.message as { text?: string } | undefined)?.text;
		log.debug("dispatch.message.start", {
			chatId: evt.ctx.chatId,
			listenerCount: snapshot.listeners.length,
			textPreview: msgText?.slice(0, 50),
		});
		// Skip active-flow interception for new_chat_members events so listener
		// services (e.g. new-member welcome) always get a chance to respond.
		const hasNewMembers = !!(evt.message as { new_chat_members?: unknown[] } | undefined)
			?.new_chat_members;
		const active = hasNewMembers ? null : getActiveFlow(evt.ctx.chatId, evt.ctx.userId);
		if (active) {
			log.debug("dispatch.message.active_flow", {
				chatId: evt.ctx.chatId,
				serviceId: active.serviceId,
			});
			// Route directly to active flow service (command_flow)
			const route = Object.values(snapshot.commands).find(
				(r) => r.serviceId === active.serviceId && r.kind === "command_flow",
			);
			if (route) {
				const existing = getServiceState({
					chatId: evt.ctx.chatId,
					userId: evt.ctx.userId,
					serviceId: route.serviceId,
				});
				const payload: SandboxPayload = {
					event: { type: "message", message: evt.message, state: existing?.value },
					ctx: {
						chatId: evt.ctx.chatId,
						userId: evt.ctx.userId,
						serviceConfig: route.config,
						routeMeta: route.meta,
						datasets: route.datasets,
						botPublicKey: pubkyWriter.getPublicKey() ?? undefined,
					},
					manifest: { schemaVersion: 1 },
				};
				const bundle = getServiceBundle(route.bundleHash);
				if (!bundle) {
					log.error("dispatch.bundle.missing", { bundleHash: route.bundleHash });
					return { response: { kind: "error", text: "bundle missing" } };
				}
				const res = await sandboxHost.run<ServiceResponse>(
					bundle.data_url,
					payload as unknown as ExecutePayload,
					{
						timeoutMs: route.net ? 10000 : 2000,
						hasNpm: bundle.has_npm === 1,
						net: route.net,
					},
				);
				if (!res.ok) {
					log.error("sandbox.flow.message.error", {
						error: res.error,
						serviceId: route.serviceId,
					});
					return { response: { kind: "error", text: res.error ?? "sandbox error" } };
				}
				if (res.value?.state) {
					const after = applyStateDirective({
						directive: res.value.state,
						chatId: evt.ctx.chatId,
						userId: evt.ctx.userId,
						serviceId: route.serviceId,
					});
					if (res.value.state.op === "clear") {
						clearActiveFlow(evt.ctx.chatId, evt.ctx.userId);
					}
					log.debug("dispatch.flow.state", {
						serviceId: route.serviceId,
						op: res.value.state.op,
						version: after?.version,
					});
				}
				// If the active flow returned a real response, use it.
				// If it returned "none", fall through to listeners so they
				// can still process the message (e.g. url-cleaner, triggerwords).
				if (res.value && res.value.kind !== "none") {
					return { response: res.value };
				}
				log.debug("dispatch.flow.passthrough", {
					serviceId: route.serviceId,
				});
			}
		}
		// Fallback to listeners
		log.debug("dispatch.listeners.start", {
			chatId: evt.ctx.chatId,
			count: snapshot.listeners.length,
			ids: snapshot.listeners.map((l) => l.serviceId),
		});
		for (const listener of snapshot.listeners) {
			log.debug("dispatch.listener.exec", {
				serviceId: listener.serviceId,
				hasConfig: !!listener.config,
				hasDatasets: !!listener.datasets,
				datasetKeys: listener.datasets ? Object.keys(listener.datasets) : [],
			});
			const payload: SandboxPayload = {
				event: { type: "message", message: evt.message },
				ctx: {
					chatId: evt.ctx.chatId,
					userId: evt.ctx.userId,
					serviceConfig: listener.config,
					routeMeta: listener.meta,
					datasets: listener.datasets,
					botPublicKey: pubkyWriter.getPublicKey() ?? undefined,
				},
				manifest: { schemaVersion: 1 },
			};
			const bundle = getServiceBundle(listener.bundleHash);
			if (!bundle) {
				log.error("dispatch.listener.bundle.missing", { bundleHash: listener.bundleHash });
				continue;
			}
			const res = await sandboxHost.run<ServiceResponse>(
				bundle.data_url,
				payload as unknown as ExecutePayload,
				{
					timeoutMs: listener.net ? 10000 : bundle.has_npm === 1 ? 5000 : 2000,
					hasNpm: bundle.has_npm === 1,
					net: listener.net,
				},
			);
			if (!res.ok) {
				log.warn("sandbox.listener.error", {
					error: res.error,
					serviceId: listener.serviceId,
				});
				continue;
			}
			log.debug("sandbox.listener.result", {
				serviceId: listener.serviceId,
				kind: res.value?.kind,
				hasText: !!(res.value as { text?: string } | undefined)?.text,
			});
			if (res.value && res.value.kind !== "none") {
				log.debug("sandbox.listener.ok", {
					serviceId: listener.serviceId,
					kind: res.value.kind,
				});
				if (listener.deleteCommandMessage) {
					res.value.deleteTrigger = true;
				}
				return { response: res.value };
			}
		}
		return { response: null };
	}
	return { response: null };
}
