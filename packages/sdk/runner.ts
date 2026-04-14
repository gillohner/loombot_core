// sdk/runner.ts
// Service runtime entrypoint (sandbox harness)
import { error } from "./responses/factory.ts";
import type { DefinedService } from "./service.ts";
import type { GenericEvent } from "./events.ts";

// Redirect console.log/debug/info to stderr to avoid polluting JSON response on stdout
// This is important for npm packages that may output debug logs
const _originalConsole = {
	log: console.log.bind(console),
	debug: console.debug.bind(console),
	info: console.info.bind(console),
};
const stderrWrite = (msg: string) => Deno.stderr.writeSync(new TextEncoder().encode(msg + "\n"));
console.log = (...args: unknown[]) => stderrWrite(args.map(String).join(" "));
console.debug = (...args: unknown[]) => stderrWrite("[debug] " + args.map(String).join(" "));
console.info = (...args: unknown[]) => stderrWrite("[info] " + args.map(String).join(" "));

interface RawPayload {
	event: GenericEvent;
	ctx: {
		chatId?: string;
		userId?: string;
		serviceConfig?: Record<string, unknown>;
		routeMeta?: { id: string; command: string; description?: string };
		datasets?: Record<string, unknown>;
		botPublicKey?: string;
		locale?: string;
	};
}

function assertEvent(e: unknown): asserts e is GenericEvent {
	if (!e || typeof e !== "object" || !("type" in (e as { type?: unknown }))) {
		throw new Error("Invalid event");
	}
	const t = (e as { type?: unknown }).type;
	if (t !== "command" && t !== "callback" && t !== "message") throw new Error("Unknown event type");
}

export async function runService(svc: DefinedService) {
	let raw: string;
	try {
		raw = await new Response(Deno.stdin.readable).text();
	} catch {
		await Deno.stdout.write(new TextEncoder().encode(JSON.stringify(error("stdin read error"))));
		return;
	}
	let payload: RawPayload;
	try {
		payload = JSON.parse(raw);
	} catch {
		await Deno.stdout.write(new TextEncoder().encode(JSON.stringify(error("payload parse error"))));
		return;
	}
	try {
		assertEvent(payload.event);
	} catch (err) {
		await Deno.stdout.write(
			new TextEncoder().encode(JSON.stringify(error((err as Error).message))),
		);
		return;
	}
	const event = payload.event;
	const evtAny = event as {
		state?: Record<string, unknown>;
		stateVersion?: number;
		data?: string;
		message?: unknown;
	};
	// Derive runtime route metadata (host-provided) for automatic manifest alignment
	const routeMeta = payload.ctx?.routeMeta;
	if (routeMeta) {
		// Recognize either legacy "__runtime__" placeholder or new "__auto__" sentinel.
		const placeholders = new Set(["__runtime__", "__auto__"]);
		try {
			if (placeholders.has(svc.manifest.id)) {
				(svc.manifest as { id: string }).id = routeMeta.id;
			}
			if (placeholders.has(svc.manifest.command)) {
				(svc.manifest as { command: string }).command = routeMeta.command;
			}
			if (
				(svc.manifest.description === undefined || placeholders.has(svc.manifest.description)) &&
				routeMeta.description
			) {
				(svc.manifest as { description?: string }).description = routeMeta.description;
			}
		} catch (_err) {
			// Ignore mutation issues (frozen objects etc.) – service will still function with placeholders.
		}
	}

	const ctxBase = {
		chatId: payload.ctx?.chatId ?? "",
		userId: payload.ctx?.userId ?? "",
		serviceConfig: payload.ctx?.serviceConfig,
		state: evtAny.state,
		stateVersion: evtAny.stateVersion,
		routeMeta,
		datasets: payload.ctx?.datasets,
		botPublicKey: payload.ctx?.botPublicKey,
		language: payload.ctx?.locale ?? "en",
	};
	let resp;
	try {
		if (event.type === "command") {
			resp = await svc.handlers.command({ ...ctxBase, type: "command" });
		} else if (event.type === "callback") {
			resp = await svc.handlers.callback({ ...ctxBase, type: "callback", data: evtAny.data ?? "" });
		} else if (event.type === "message") {
			resp = await svc.handlers.message({ ...ctxBase, type: "message", message: evtAny.message });
		} else resp = error("unknown event type");
	} catch (err) {
		resp = error((err as Error).message || "service error");
	}
	await Deno.stdout.write(new TextEncoder().encode(JSON.stringify(resp)));
}
