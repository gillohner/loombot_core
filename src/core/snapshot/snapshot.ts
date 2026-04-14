// src/core/snapshot/snapshot.ts
// Build a RoutingSnapshot for a chat by resolving operator config + per-chat
// overrides. Services are executed directly from their source path by the
// sandbox host — no pre-bundling and no content-addressing.

import { log } from "@core/util/logger.ts";
import {
	getChatFeatureOverrides,
	loadSnapshotByConfigHash,
	saveSnapshotByConfigHash,
	sha256Hex,
} from "@core/config/store.ts";
import { resolveChatConfig, type ResolvedFeature } from "@core/config/merge.ts";
import { getOperatorConfig, getOperatorConfigHash } from "@core/config/runtime.ts";
import type { CommandRoute, ListenerRoute, RouteMeta, RoutingSnapshot } from "@schema/routing.ts";

const SNAPSHOT_SCHEMA_VERSION = 3;
const SNAPSHOT_TTL_MS = 10_000;

interface CacheEntry {
	snapshot: RoutingSnapshot;
	expires: number;
}
const snapshotCache = new Map<string, CacheEntry>();

export async function buildSnapshot(
	chatId: string,
	opts?: { force?: boolean; chatType?: string },
): Promise<RoutingSnapshot> {
	const now = Date.now();
	const operatorConfig = getOperatorConfig();
	const operatorHash = getOperatorConfigHash();
	const overrides = getChatFeatureOverrides(chatId);
	const configHash = await sha256Hex(
		operatorHash + "|" + chatId + "|" + JSON.stringify(overrides),
	);

	log.debug("snapshot.build.start", { chatId, configHash, force: opts?.force || false });

	if (!opts?.force) {
		const cached = snapshotCache.get(chatId);
		if (cached && cached.expires > now && cached.snapshot.configHash === configHash) {
			log.debug("snapshot.cache.hit", { chatId, configHash });
			return cached.snapshot;
		}

		const persisted = loadSnapshotByConfigHash(configHash);
		if (persisted) {
			try {
				const snap = JSON.parse(persisted.snapshot_json) as RoutingSnapshot;
				if (
					snap.version === SNAPSHOT_SCHEMA_VERSION &&
					typeof snap.builtAt === "number" &&
					snap.configHash === configHash
				) {
					snapshotCache.set(chatId, { snapshot: snap, expires: now + SNAPSHOT_TTL_MS });
					return snap;
				}
			} catch (err) {
				log.warn("snapshot.persisted.parse_error", { error: (err as Error).message });
			}
		}
	}

	const resolved = resolveChatConfig(chatId, {
		chatType: opts?.chatType,
		operatorConfig,
	});

	const commandRoutes: Record<string, CommandRoute> = {};
	const listenerRoutes: ListenerRoute[] = [];

	for (const feature of resolved.enabledFeatures) {
		const meta = await loadMeta(feature);
		const configBlob = { ...feature.config };
		// Attach the override blob so services can read freeform per-chat data
		// if they care to (most don't).
		if (Object.keys(feature.overrideData).length > 0) {
			configBlob.__chatOverride = feature.overrideData;
		}

		const base = {
			serviceId: feature.featureId,
			entry: feature.entry,
			config: configBlob,
			meta,
			datasets: feature.datasets,
			net: feature.net ?? meta.net,
			manifestServiceId: meta.manifestServiceId,
		};

		if (feature.kind === "listener") {
			listenerRoutes.push({ ...base, kind: "listener" });
		} else {
			commandRoutes[feature.command] = {
				...base,
				kind: feature.kind === "command_flow" ? "command_flow" : "single_command",
			};
		}
	}

	const snapshot: RoutingSnapshot = {
		commands: commandRoutes,
		listeners: listenerRoutes,
		builtAt: now,
		version: SNAPSHOT_SCHEMA_VERSION,
		configHash,
	};
	saveSnapshotByConfigHash(configHash, snapshot);
	snapshotCache.set(chatId, { snapshot, expires: now + SNAPSHOT_TTL_MS });
	log.debug("snapshot.build", {
		chatId,
		commands: Object.keys(snapshot.commands).length,
		listeners: snapshot.listeners.length,
	});
	return snapshot;
}

// Dynamically import the service module to read its manifest. The feature id
// and command come from config.yaml (so duplicate instances get distinct
// namespaces), but we also capture the manifest's hardcoded service id — some
// services namespace their inline-keyboard callbacks against that string and
// the dispatcher uses it as a fallback lookup key.
async function loadMeta(
	feature: ResolvedFeature,
): Promise<RouteMeta & { net?: string[]; manifestServiceId?: string }> {
	try {
		const absoluteEntry = feature.entry.startsWith("./")
			? new URL(feature.entry, `file://${Deno.cwd()}/`).href
			: feature.entry;
		const mod = await import(absoluteEntry);
		const svc = mod.default as {
			manifest?: { id?: string; description?: string; net?: string[] };
		};
		const SENTINELS = new Set(["__runtime__", "__auto__"]);
		const desc = svc?.manifest?.description && !SENTINELS.has(svc.manifest.description)
			? svc.manifest.description
			: undefined;
		const manifestId = svc?.manifest?.id && !SENTINELS.has(svc.manifest.id)
			? svc.manifest.id
			: undefined;
		return {
			id: feature.featureId,
			command: feature.command,
			description: desc,
			net: svc?.manifest?.net,
			manifestServiceId: manifestId,
		};
	} catch (err) {
		log.warn("snapshot.loadMeta.error", {
			entry: feature.entry,
			error: (err as Error).message,
		});
		return { id: feature.featureId, command: feature.command };
	}
}
