// src/adapters/telegram/adapter.ts
// Telegram platform adapter implementing PlatformAdapter interface.
import { type Context, InputFile } from "grammy";
import type { ServiceResponse } from "@sdk/mod.ts";
import { log } from "@core/util/logger.ts";
import type { AdapterApplyContext, PlatformAdapter } from "@adapters/types.ts";
import { convertCard, convertCarousel, convertKeyboard, convertMenu } from "./ui_converter.ts";
import { CONFIG } from "@core/config.ts";
import { trackMessage } from "@core/ttl/store.ts";
import { pubkyWriter } from "@core/pubky/writer.ts";
import { t } from "@core/i18n/mod.ts";

// Narrow helper type for edit options compatibility
type BasicMessageOptions = Record<string, unknown> | undefined;

// --- Replacement Group Tracking -------------------------------------------------
// Simple per (chat, group) tracking of a single last message id so we can delete
// the previously displayed media and keep only the latest selection visible.
const groupLastMessage = new Map<string, number>();
function groupKey(chatId: number | string, group: string): string {
	return `${chatId}:${group}`;
}
// --- Pinned Message Protection -------------------------------------------------
// By default we will NOT delete a pinned message (to avoid nuking curated info).
async function isPinned(ctx: Context, id: number): Promise<boolean> {
	try {
		// getChat returns the currently pinned message (if any); there is only one
		const chat = await ctx.api.getChat(ctx.chat!.id as number);
		// @ts-ignore grammy may not include pinned_message type in minimal build
		const pinned = (chat as unknown as { pinned_message?: { message_id: number } }).pinned_message;
		return !!pinned && pinned.message_id === id;
	} catch (_err) {
		// On failure assume not pinned (fail open) to avoid leaving stale spam.
		return false;
	}
}

async function deleteMessageSafe(ctx: Context, id: number) {
	try {
		if (!CONFIG.enableDeletePinned && await isPinned(ctx, id)) {
			log.debug("delete.skip.pinned", { id });
			return;
		}
		await ctx.api.deleteMessage(ctx.chat!.id, id);
	} catch (err) {
		log.debug("replace.delete.failed", { error: (err as Error).message });
	}
}
async function applyReplacementPolicy(ctx: Context, replaceGroup?: string) {
	if (!replaceGroup) return;
	const key = groupKey(ctx.chat!.id, replaceGroup);
	const prev = groupLastMessage.get(key);
	if (prev) await deleteMessageSafe(ctx, prev);
}
function recordReplacement(
	ctx: Context,
	replaceGroup: string | undefined,
	newId: number | undefined,
) {
	if (!replaceGroup || !newId) return;
	const key = groupKey(ctx.chat!.id, replaceGroup);
	groupLastMessage.set(key, newId);
}
async function cleanupGroup(ctx: Context, cleanupGroup?: string) {
	if (!cleanupGroup) return;
	const key = groupKey(ctx.chat!.id, cleanupGroup);
	const prev = groupLastMessage.get(key);
	if (prev) await deleteMessageSafe(ctx, prev);
	groupLastMessage.delete(key);
}

async function handleReply(ctx: Context, r: Extract<ServiceResponse, { kind: "reply" }>) {
	await ctx.reply(
		r.text ?? "", // reply kind expected to carry text; fallback to empty
		{
			parse_mode: "HTML",
			...(r.options as Record<string, unknown> ?? {}),
		},
	);
}

async function handleEdit(ctx: Context, r: Extract<ServiceResponse, { kind: "edit" }>) {
	const editOpts = {
		parse_mode: "HTML" as const,
		...(r.options as Record<string, unknown> ?? {}),
	};
	try {
		if (ctx.callbackQuery?.message) {
			const msg = ctx.callbackQuery.message;
			const text = r.text ?? "";
			await ctx.api.editMessageText(
				ctx.chat!.id,
				msg.message_id,
				text,
				editOpts as BasicMessageOptions,
			);
		} else if (ctx.msg?.message_id) {
			const text = r.text ?? "";
			await ctx.api.editMessageText(
				ctx.chat!.id,
				ctx.msg.message_id,
				text,
				editOpts as BasicMessageOptions,
			);
		} else {
			const text = r.text ?? "";
			await ctx.reply(text, editOpts);
		}
	} catch (err: unknown) {
		type WithDescription = { description: string };
		const maybe = err as unknown;
		let desc = "";
		if (typeof maybe === "object" && maybe !== null) {
			if (
				"description" in maybe &&
				typeof (maybe as WithDescription).description === "string"
			) {
				desc = (maybe as WithDescription).description;
			} else if (maybe instanceof Error && typeof maybe.message === "string") {
				desc = maybe.message;
			}
		} else if (maybe instanceof Error) {
			desc = maybe.message;
		}
		if (/message is not modified/i.test(desc)) {
			log.debug("edit.noop", { reason: desc });
			return;
		}
		log.warn("edit.fallback.reply", { error: err });
		try {
			const text = r.text ?? "";
			await ctx.reply(text, editOpts);
		} catch (replyErr) {
			log.error("edit.fallback.failed", { error: replyErr });
		}
	}
}

async function resolvePhotoInput(photo: string): Promise<string | InputFile> {
	if (typeof photo === "string" && photo.startsWith("pubky://")) {
		try {
			const { Pubky } = await import("@synonymdev/pubky");
			const pubky = new Pubky();
			// pubky:// URLs are valid Address type for publicStorage
			type Address = `pubky://${string}/pub/${string}`;
			const bytes = await pubky.publicStorage.getBytes(photo as Address);
			// Best-effort filename
			const name = photo.split("/").pop() || "image.bin";
			return new InputFile(new Blob([bytes as BlobPart]), name);
		} catch (e) {
			log.warn("pubky.photo.fetch.failed", { error: (e as Error).message });
			// Fallback: return original (will likely fail on Telegram)
			return photo;
		}
	}
	return photo;
}

async function handlePhoto(ctx: Context, r: Extract<ServiceResponse, { kind: "photo" }>) {
	try {
		const input = await resolvePhotoInput(r.photo);
		const msg = await ctx.replyWithPhoto(
			input as unknown as Parameters<typeof ctx.replyWithPhoto>[0],
			{
				caption: r.caption,
				...(r.options as Record<string, unknown> | undefined),
			},
		);
		return msg.message_id;
	} catch (err) {
		log.error("photo.send.failed", { error: err });
		await ctx.reply(r.caption ?? t("adapter.photo_failed"));
	}
}

async function handleDelete(ctx: Context, _r: Extract<ServiceResponse, { kind: "delete" }>) {
	try {
		const msg = ctx.callbackQuery?.message || ctx.msg;
		if (msg?.message_id) {
			await ctx.api.deleteMessage(ctx.chat!.id, msg.message_id);
			return;
		}
	} catch (err) {
		log.warn("delete.fallback.reply", { error: err });
		// Removed unsupported fallbackText property handling
	}
}

async function handleAudio(ctx: Context, r: Extract<ServiceResponse, { kind: "audio" }>) {
	try {
		const msg = await ctx.replyWithAudio(r.audio, {
			duration: r.duration,
			title: r.title,
			performer: r.performer,
		});
		return msg.message_id;
	} catch (err) {
		log.error("audio.send.failed", { error: err });
		await ctx.reply(t("adapter.audio_failed"));
	}
}

async function handleVideo(ctx: Context, r: Extract<ServiceResponse, { kind: "video" }>) {
	try {
		const msg = await ctx.replyWithVideo(r.video, {
			duration: r.duration,
			width: r.width,
			height: r.height,
		});
		return msg.message_id;
	} catch (err) {
		log.error("video.send.failed", { error: err });
		await ctx.reply(t("adapter.video_failed"));
	}
}

async function handleDocument(ctx: Context, r: Extract<ServiceResponse, { kind: "document" }>) {
	try {
		const msg = await ctx.replyWithDocument(r.document);
		return msg.message_id;
	} catch (err) {
		log.error("document.send.failed", { error: err });
		await ctx.reply(t("adapter.document_failed"));
	}
}

async function handleLocation(ctx: Context, r: Extract<ServiceResponse, { kind: "location" }>) {
	try {
		if (r.title || r.address) {
			const msg = await ctx.replyWithVenue(
				r.latitude,
				r.longitude,
				r.title || "Location",
				r.address || "",
			);
			return msg.message_id;
		} else {
			const msg = await ctx.replyWithLocation(r.latitude, r.longitude);
			return msg.message_id;
		}
	} catch (err) {
		log.error("location.send.failed", { error: err });
		await ctx.reply(t("adapter.location_fallback", { lat: r.latitude, lon: r.longitude }));
	}
}

async function handleContact(ctx: Context, r: Extract<ServiceResponse, { kind: "contact" }>) {
	try {
		const msg = await ctx.replyWithContact(r.phoneNumber, r.firstName, {
			last_name: r.lastName,
		});
		return msg.message_id;
	} catch (err) {
		log.error("contact.send.failed", { error: err });
		await ctx.reply(
			t("adapter.contact_fallback", {
				name: `${r.firstName} ${r.lastName || ""}`.trim(),
				phone: r.phoneNumber,
			}),
		);
	}
}

async function handlePubkyWrite(
	ctx: Context,
	r: Extract<ServiceResponse, { kind: "pubky_write" }>,
): Promise<void> {
	// Queue the write request with PubkyWriter
	if (!pubkyWriter.isReady()) {
		await ctx.reply(t("adapter.pubky_not_configured"));
		return;
	}

	try {
		const userId = String(ctx.from?.id ?? "unknown");
		const chatId = String(ctx.chat?.id ?? "");

		// Get service ID from context (set by dispatcher)
		const serviceId = (ctx as unknown as { _serviceId?: string })._serviceId ?? "unknown";

		await pubkyWriter.queueWrite({
			path: r.path,
			data: r.data,
			preview: r.preview,
			serviceId,
			userId,
			chatId,
			onApprovalMessage: r.onApprovalMessage,
			onRejectionMessage: r.onRejectionMessage,
			userName: ctx.from?.username,
			userDisplayName: ctx.from?.first_name
				? `${ctx.from.first_name}${ctx.from.last_name ? " " + ctx.from.last_name : ""}`
				: undefined,
		});

		await ctx.reply(t("adapter.pubky_queued"));
	} catch (err) {
		log.error("pubky.write.queue.failed", { error: (err as Error).message });
		await ctx.reply(t("adapter.pubky_queue_failed"));
	}
}

async function handleUI(ctx: Context, r: Extract<ServiceResponse, { kind: "ui" }>) {
	try {
		let result: { text: string; reply_markup?: unknown; photo?: string };

		switch (r.uiType) {
			case "keyboard":
				result = {
					text: r.text || t("adapter.ui_choose_option"),
					reply_markup: convertKeyboard(r.ui as import("@sdk/mod.ts").UIKeyboard),
				};
				break;
			case "menu":
				result = {
					text: r.text || (r.ui as import("@sdk/mod.ts").UIMenu).title || "Menu:",
					reply_markup: convertMenu(r.ui as import("@sdk/mod.ts").UIMenu),
				};
				break;
			case "card":
				result = convertCard(r.ui as import("@sdk/mod.ts").UICard);
				if (r.text) {
					result.text = r.text + "\n\n" + result.text;
				}
				break;
			case "carousel":
				result = convertCarousel(r.ui as import("@sdk/mod.ts").UICarousel);
				if (r.text) {
					result.text = r.text + "\n\n" + result.text;
				}
				break;
			default:
				result = { text: r.text || "Unsupported UI element" };
				break;
		}

		// Extract service options (e.g. disable_web_page_preview) but exclude
		// internal-only keys that the adapter handles separately.
		const { replaceGroup: _rg, cleanupGroup: _cg, ...serviceOpts } =
			(r.options as Record<string, unknown>) ?? {};

		let msg;
		if (result.photo) {
			msg = await ctx.replyWithPhoto(result.photo, {
				caption: result.text,
				parse_mode: "HTML",
				// @ts-ignore - Grammy types are strict, but this is valid
				reply_markup: result.reply_markup,
				...serviceOpts,
			});
		} else {
			msg = await ctx.reply(result.text, {
				parse_mode: "HTML",
				// @ts-ignore - Grammy types are strict, but this is valid
				reply_markup: result.reply_markup,
				...serviceOpts,
			});
		}
		return msg?.message_id;
	} catch (err) {
		log.error("ui.send.failed", { error: err });
		await ctx.reply(r.text || "UI element failed to render");
	}
}

async function applyResponseInternal(ctx: Context, resp: ServiceResponse | null): Promise<void> {
	if (!resp) return;
	let shouldDeleteTrigger = false;
	if ("deleteTrigger" in resp && resp.deleteTrigger) {
		shouldDeleteTrigger = true;
	}
	// Replacement/cleanup groups (internal convention via options.replaceGroup / options.cleanupGroup)
	const replaceGroup = (resp as { options?: Record<string, unknown> }).options?.replaceGroup as
		| string
		| undefined;
	const cleanup = (resp as { options?: Record<string, unknown> }).options?.cleanupGroup as
		| string
		| undefined;
	if (replaceGroup) await applyReplacementPolicy(ctx, replaceGroup);

	let sentId: number | undefined;
	switch (resp.kind) {
		case "reply":
			await handleReply(ctx, resp);
			break;
		case "edit":
			await handleEdit(ctx, resp);
			break;
		case "delete":
			await handleDelete(ctx, resp);
			shouldDeleteTrigger = false;
			break;
		case "error": {
			const text = (resp as { text?: string }).text || "Error";
			await ctx.reply(`⚠️ ${text}`);
			break;
		}
		case "photo":
			sentId = await handlePhoto(ctx, resp);
			break;
		case "audio":
			sentId = await handleAudio(ctx, resp);
			break;
		case "video":
			sentId = await handleVideo(ctx, resp);
			break;
		case "document":
			sentId = await handleDocument(ctx, resp);
			break;
		case "location":
			sentId = await handleLocation(ctx, resp);
			break;
		case "contact":
			sentId = await handleContact(ctx, resp);
			break;
		case "ui":
			sentId = await handleUI(ctx, resp);
			break;
		case "pubky_write":
			await handlePubkyWrite(ctx, resp);
			break;
		case "none":
		default:
			return;
	}
	if (replaceGroup) await recordReplacement(ctx, replaceGroup, sentId);
	if (cleanup) await cleanupGroup(ctx, cleanup);

	// TTL handling: explicit resp.ttl overrides defaultMessageTtl
	const ttlSeconds = (resp as { ttl?: number }).ttl ?? CONFIG.defaultMessageTtl;
	if (sentId && ttlSeconds && ttlSeconds > 0) {
		// Persist in KV so we can delete on restart (startup cleanup) and schedule best-effort in-process deletion.
		try {
			await trackMessage({
				platform: "telegram",
				chatId: ctx.chat!.id,
				messageId: sentId,
				ttlSeconds,
			});
			setTimeout(async () => {
				try {
					await ctx.api.deleteMessage(ctx.chat!.id as number, sentId);
				} catch (_err) {
					// ignore
				}
			}, ttlSeconds * 1000);
		} catch (err) {
			log.debug("ttl.track.failed", { error: (err as Error).message });
		}
	}

	if (shouldDeleteTrigger) {
		try {
			const msg = ctx.msg || ctx.callbackQuery?.message;
			if (msg?.message_id) {
				await ctx.api.deleteMessage(ctx.chat!.id, msg.message_id);
			}
		} catch (err) {
			log.debug("deleteTrigger.failed", { error: (err as Error).message });
		}
	}
}

export const telegramAdapter: PlatformAdapter = {
	id: "telegram",
	async applyResponse(ctx: AdapterApplyContext, resp: ServiceResponse | null) {
		await applyResponseInternal(ctx.platformCtx as Context, resp);
	},
};

// Internal helpers exported ONLY for tests (not part of public API surface)
export const _internals: Record<string, unknown> = {
	enableDeletePinned: CONFIG.enableDeletePinned,
	isPinned,
};
