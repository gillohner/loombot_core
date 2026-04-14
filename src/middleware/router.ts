// src/middleware/router.ts
import { Composer, type Context } from "grammy";
import { buildSnapshot } from "@core/snapshot/snapshot.ts";
import { dispatch } from "@core/dispatch/dispatcher.ts";
import { applyServiceResponse } from "@middleware/response.ts";
import { isBotCommand, normalizeCommand } from "@core/util/utils.ts";
import { log } from "@core/util/logger.ts";
import { userIsAdmin } from "@middleware/admin.ts";
import { pubkyWriter } from "@core/pubky/writer.ts";
import { rememberChat } from "@core/config/store.ts";
import { registerConfigUi, routeConfigTextInput, sendMainMenu } from "@middleware/config_ui/mod.ts";

const CORE_PUBLIC_COMMANDS: string[] = ["start"];
const CORE_ADMIN_ONLY: string[] = ["config"];

function buildCommandLists(allServiceCommands: string[]) {
	const serviceUnique = allServiceCommands.filter((c) =>
		!CORE_PUBLIC_COMMANDS.includes(c) && !CORE_ADMIN_ONLY.includes(c)
	);
	const publicCommands = [...CORE_PUBLIC_COMMANDS, ...serviceUnique].sort();
	const adminCommands = [...publicCommands, ...CORE_ADMIN_ONLY].sort();
	return { publicCommands, adminCommands };
}

async function publishCommands(ctx: Context, chatId: string) {
	try {
		const snap = await buildSnapshot(chatId, { chatType: ctx.chat?.type });
		const serviceCommands = Object.keys(snap.commands);
		const { publicCommands, adminCommands } = buildCommandLists(serviceCommands);
		const toTelegram = (list: string[]) => list.map((c) => ({ command: c, description: c }));
		const isPrivateChat = ctx.chat?.type === "private";

		if (isPrivateChat) {
			if (adminCommands.length > 0) {
				await ctx.api.setMyCommands(toTelegram(adminCommands), {
					scope: { type: "chat", chat_id: Number(chatId) },
				});
			}
		} else {
			if (publicCommands.length > 0) {
				await ctx.api.setMyCommands(toTelegram(publicCommands), {
					scope: { type: "chat", chat_id: Number(chatId) },
				});
			}
			if (adminCommands.length > 0) {
				await ctx.api.setMyCommands(toTelegram(adminCommands), {
					scope: { type: "chat_administrators", chat_id: Number(chatId) },
				});
			}
		}
	} catch (err) {
		log.warn("commands.publish.error", { error: (err as Error).message });
	}
}

export const _testPublishCommands = publishCommands;

/**
 * Best-effort deletion of the user's triggering command message
 * (e.g. `/start`, `/config`). Silently swallows permission errors so
 * the bot still works in groups where it lacks Delete Messages rights.
 */
async function deleteTriggerSafe(ctx: Context): Promise<void> {
	try {
		const messageId = ctx.msg?.message_id;
		const chatId = ctx.chat?.id;
		if (messageId && chatId !== undefined) {
			await ctx.api.deleteMessage(chatId, messageId);
		}
	} catch (err) {
		log.debug("router.deleteTrigger.failed", { error: (err as Error).message });
	}
}

export function buildMiddleware() {
	const composer = new Composer<Context>();

	composer.use(async (_ctx: Context, next: () => Promise<void>) => {
		try {
			await next();
		} catch (err) {
			log.error("middleware.error", { error: (err as Error).message });
		}
	});

	// /config inline-keyboard handlers.
	registerConfigUi(composer);

	composer.on(
		"message:text",
		async (ctx: Context, next: () => Promise<void>) => {
			const text = ctx.message?.text ?? "";

			// Handoff for a user in the middle of a /config freeform-input step.
			if (await routeConfigTextInput(ctx)) return;

			if (!isBotCommand(text)) return await next();

			const chatId = String(ctx.chat?.id ?? "");
			rememberChat(chatId);
			const token = text.split(" ")[0] ?? "";
			const command = normalizeCommand(token.replace(/@[^\s]+$/, ""));

			if (command === "start") {
				await publishCommands(ctx, chatId);
				await ctx.reply("Hi! I'm configured per-chat. Admins can run /config to pick features.");
				await deleteTriggerSafe(ctx);
				return;
			}

			if (command === "config") {
				if (!(await userIsAdmin(ctx))) {
					await ctx.reply("Admin only.");
					await deleteTriggerSafe(ctx);
					return;
				}
				await publishCommands(ctx, chatId);
				await sendMainMenu(ctx, chatId);
				await deleteTriggerSafe(ctx);
				return;
			}

			// Service dispatch
			await buildSnapshot(chatId, { chatType: ctx.chat?.type });
			const result = await dispatch({
				kind: "command",
				command,
				ctx: { chatId, userId: String(ctx.from?.id ?? "") },
			});
			await applyServiceResponse(ctx, result.response);
		},
	);

	// Pubky approval callbacks (unchanged)
	composer.callbackQuery(/^pubky:(approve|reject):(.+)$/, async (ctx: Context) => {
		const match = /^pubky:(approve|reject):(.+)$/.exec(ctx.callbackQuery?.data ?? "");
		if (!match) {
			await ctx.answerCallbackQuery({ text: "Invalid callback" });
			return;
		}
		const action = match[1];
		const writeId = match[2];

		const adminGroup = pubkyWriter.getAdminGroup();
		if (adminGroup && String(ctx.chat?.id) !== String(adminGroup)) {
			await ctx.answerCallbackQuery({ text: "Not authorized" });
			return;
		}

		const adminId = String(ctx.from?.id ?? "");
		const adminName = ctx.from?.first_name ?? "Admin";

		if (action === "approve") {
			const result = await pubkyWriter.approve(writeId, adminId);
			try {
				const originalText = ctx.callbackQuery?.message?.text ?? "";
				await ctx.editMessageText(
					originalText + `\n\n✅ **Approved** by ${adminName}` +
						(result.success ? " - Written successfully" : " - ⚠️ Write failed"),
					{ parse_mode: "Markdown" },
				);
			} catch { /* ignore */ }
			await ctx.answerCallbackQuery({ text: result.message });
		} else {
			const result = await pubkyWriter.reject(writeId, adminId);
			try {
				const originalText = ctx.callbackQuery?.message?.text ?? "";
				await ctx.editMessageText(
					originalText + `\n\n❌ **Rejected** by ${adminName}`,
					{ parse_mode: "Markdown" },
				);
			} catch { /* ignore */ }
			await ctx.answerCallbackQuery({ text: result.message });
		}
	});

	// Generic service callback queries
	composer.on("callback_query:data", async (ctx: Context) => {
		const data = ctx.callbackQuery?.data ?? "";
		if (data.startsWith("cfg:") || data.startsWith("pubky:")) {
			// Handled above; stop fallthrough.
			return;
		}
		const chatId = String(ctx.chat?.id ?? "");
		rememberChat(chatId);
		log.debug("callback.received", { chatId, data });
		await buildSnapshot(chatId, { chatType: ctx.chat?.type });
		const result = await dispatch({
			kind: "callback",
			data,
			ctx: { chatId, userId: String(ctx.from?.id ?? "") },
		});
		await applyServiceResponse(ctx, result.response);
		await ctx.answerCallbackQuery();
		log.debug("callback.processed", { chatId, data });
	});

	// New chat members → forward to listener services
	composer.on("message:new_chat_members", async (ctx: Context) => {
		const chatId = String(ctx.chat?.id ?? "");
		rememberChat(chatId);
		await buildSnapshot(chatId, { chatType: ctx.chat?.type });
		const result = await dispatch({
			kind: "message",
			message: ctx.message,
			ctx: { chatId, userId: String(ctx.from?.id ?? "") },
		});
		await applyServiceResponse(ctx, result.response);
	});

	// Generic message listeners
	composer.on("message", async (ctx: Context, next: () => Promise<void>) => {
		const chatId = String(ctx.chat?.id ?? "");
		rememberChat(chatId);
		await buildSnapshot(chatId, { chatType: ctx.chat?.type });
		const result = await dispatch({
			kind: "message",
			message: ctx.message,
			ctx: { chatId, userId: String(ctx.from?.id ?? "") },
		});
		await applyServiceResponse(ctx, result.response);
		await next();
	});

	return composer;
}
