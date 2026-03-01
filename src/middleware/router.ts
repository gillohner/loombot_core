// src/middleware/router.ts
import { Composer, type Context } from "grammy";
import { buildSnapshot } from "@core/snapshot/snapshot.ts";
import { dispatch } from "@core/dispatch/dispatcher.ts";
import { applyServiceResponse } from "@middleware/response.ts";
import { isBotCommand, normalizeCommand } from "@core/util/utils.ts";
import { log } from "@core/util/logger.ts";
import { fetchPubkyConfig } from "@core/pubky/pubky.ts";
import { getChatConfig, setChatConfig } from "@core/config/store.ts";
import { userIsAdmin } from "@middleware/admin.ts";
import { CONFIG } from "@core/config.ts";
import { pubkyWriter } from "@core/pubky/writer.ts";

// Non-admin commands exposed to users (dynamic services appended later via snapshot)
const CORE_PUBLIC_COMMANDS: string[] = ["start"]; // plus service commands resolved dynamically
const CORE_ADMIN_ONLY: string[] = ["setconfig", "updateconfig", "showconfig", "resetconfig"]; // maintenance/config operations

function buildCommandLists(allServiceCommands: string[]) {
	// De-duplicate dynamic commands against core lists
	const serviceUnique = allServiceCommands.filter((c) =>
		!CORE_PUBLIC_COMMANDS.includes(c) && !CORE_ADMIN_ONLY.includes(c)
	);
	const publicCommands = [...CORE_PUBLIC_COMMANDS, ...serviceUnique].sort();
	const adminCommands = [...publicCommands, ...CORE_ADMIN_ONLY].sort();
	return { publicCommands, adminCommands };
}

async function publishCommands(ctx: Context, chatId: string) {
	try {
		const snap = await buildSnapshot(chatId);
		const serviceCommands = Object.keys(snap.commands);
		const { publicCommands, adminCommands } = buildCommandLists(serviceCommands);

		// Map to Telegram BotCommand objects (simple same-name description for now)
		const toTelegram = (list: string[]) => list.map((c) => ({ command: c, description: c }));

		// Check if this is a private chat (Telegram chat types: "private", "group", "supergroup", "channel")
		const isPrivateChat = ctx.chat?.type === "private";

		if (isPrivateChat) {
			// Private chat: set admin commands by default (user is implicitly the admin)
			if (adminCommands.length > 0) {
				await ctx.api.setMyCommands(toTelegram(adminCommands), {
					scope: { type: "chat", chat_id: Number(chatId) },
				});
			}
		} else {
			// Group/supergroup: use dual scope approach
			// 1) Public scope (all chat members)
			if (publicCommands.length > 0) {
				await ctx.api.setMyCommands(toTelegram(publicCommands), {
					scope: { type: "chat", chat_id: Number(chatId) },
				});
			}

			// 2) Admin scope (chat administrators). Telegram will show this superset only to admins.
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

// Test-only export (not part of public runtime API)
// Allows unit test to invoke command publication with a fabricated context.
export const _testPublishCommands = publishCommands;

export function buildMiddleware() {
	const composer = new Composer<Context>();

	// 1) Error boundary to guard downstream handlers
	composer.use(async (_ctx: Context, next: () => Promise<void>) => {
		try {
			await next();
		} catch (err) {
			log.error("middleware.error", { error: (err as Error).message });
		}
	});

	composer.on(
		"message:text",
		async (ctx: Context, next: () => Promise<void>) => {
			const text = ctx.message?.text ?? "";
			if (!isBotCommand(text)) return await next();

			const chatId = String(ctx.chat?.id ?? "");
			// Extract command token, strip leading '/', and drop optional @BotName suffix
			const token = text.split(" ")[0] ?? "";
			const command = normalizeCommand(token.replace(/@[^\s]+$/, ""));

			// /start (always allowed)
			if (command === "start") {
				await publishCommands(ctx, chatId);
				await ctx.reply(
					"Hi! Commands loaded. Admins see extra maintenance commands.",
				);
				return;
			}

			// Handle administrative config commands inline (admin only)
			if (command === "setconfig") {
				if (!(await userIsAdmin(ctx))) {
					await ctx.reply("Admin only.");
					return;
				}
				const parts = text.trim().split(/\s+/);
				if (parts.length < 2) {
					await ctx.reply("Usage: /setconfig <templateId>");
					return;
				}
				const rawArg = parts[1]!;
				const templateId = rawArg.startsWith("pubky://") ? rawArg : normalizeCommand(rawArg);
				try {
					const cfg = await fetchPubkyConfig(templateId);
					setChatConfig(chatId, templateId, cfg);
					// Snapshot invalidation: chat-level snapshots removed; config hash change triggers rebuild automatically.
					await publishCommands(ctx, chatId); // update lists if dynamic commands changed
					await ctx.reply(`Config set to '${cfg.configId}'. Admin/public command lists refreshed.`);
				} catch (err) {
					await ctx.reply(`Config error: ${(err as Error).message}`);
				}
				return;
			}
			if (command === "updateconfig") {
				if (!(await userIsAdmin(ctx))) {
					await ctx.reply("Admin only.");
					return;
				}
				// Re-fetch current config and force rebuild snapshot
				try {
					let configId = CONFIG.defaultTemplateId;
					const existingConfig = getChatConfig(chatId);
					if (existingConfig) configId = existingConfig.config_id;

					log.debug("updateconfig.start", { chatId, configId });

					// Re-fetch the config (this will pick up any changes from Pubky)
					const cfg = await fetchPubkyConfig(configId);
					setChatConfig(chatId, configId, cfg);

					log.debug("updateconfig.config_updated", {
						chatId,
						originalConfigId: configId,
						fetchedConfigId: cfg.configId,
					});

					// Force rebuild snapshot with the updated config
					await buildSnapshot(chatId, { force: true });
					await publishCommands(ctx, chatId);
					await ctx.reply("Config re-fetched and snapshot updated; commands refreshed.");
				} catch (err) {
					await ctx.reply(`Update failed: ${(err as Error).message}`);
				}
				return;
			}

			if (command === "showconfig") {
				if (!(await userIsAdmin(ctx))) {
					await ctx.reply("Admin only.");
					return;
				}
				const existingConfig = getChatConfig(chatId);
				if (!existingConfig) {
					await ctx.reply(
						`No custom config set for this chat.\nUsing default: <code>${CONFIG.defaultTemplateId}</code>`,
						{ parse_mode: "HTML" },
					);
					return;
				}
				try {
					const cfg = JSON.parse(existingConfig.config_json);
					const services = (cfg.services ?? []).map(
						(s: { name?: string; command?: string }) => s.command ?? s.name ?? "?",
					);
					const listeners = (cfg.listeners ?? []).map(
						(l: { name?: string }) => l.name ?? "?",
					);
					const lines = [
						`<b>Config:</b> <code>${existingConfig.config_id}</code>`,
						`<b>Updated:</b> ${new Date(existingConfig.updated_at).toISOString()}`,
					];
					if (services.length > 0) {
						lines.push(`<b>Services:</b> ${services.map((s: string) => `/${s}`).join(", ")}`);
					}
					if (listeners.length > 0) {
						lines.push(`<b>Listeners:</b> ${listeners.join(", ")}`);
					}
					await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
				} catch {
					await ctx.reply(
						`Config ID: <code>${existingConfig.config_id}</code>\n(Could not parse config details)`,
						{ parse_mode: "HTML" },
					);
				}
				return;
			}
			if (command === "resetconfig") {
				if (!(await userIsAdmin(ctx))) {
					await ctx.reply("Admin only.");
					return;
				}
				try {
					const defaultId = CONFIG.defaultTemplateId;
					const cfg = await fetchPubkyConfig(defaultId);
					setChatConfig(chatId, defaultId, cfg);
					await buildSnapshot(chatId, { force: true });
					await publishCommands(ctx, chatId);
					await ctx.reply(
						`Config reset to default: <code>${defaultId}</code>. Commands refreshed.`,
						{ parse_mode: "HTML" },
					);
				} catch (err) {
					await ctx.reply(`Reset failed: ${(err as Error).message}`);
				}
				return;
			}

			// Build or fetch a routing snapshot (placeholder)
			await buildSnapshot(chatId);

			// Dispatch to a service based on the snapshot and translate response
			const result = await dispatch({
				kind: "command",
				command,
				ctx: { chatId, userId: String(ctx.from?.id ?? "") },
			});
			await applyServiceResponse(ctx, result.response);
		},
	);

	// Callback queries (inline keyboards) forwarder
	// Handle Pubky approval callbacks (before generic callback handler)
	composer.callbackQuery(/^pubky:(approve|reject):(.+)$/, async (ctx: Context) => {
		const match = /^pubky:(approve|reject):(.+)$/.exec(ctx.callbackQuery?.data ?? "");
		if (!match) {
			await ctx.answerCallbackQuery({ text: "Invalid callback" });
			return;
		}

		const action = match[1];
		const writeId = match[2];

		// Verify caller is in admin group
		const adminGroup = Deno.env.get("PUBKY_ADMIN_GROUP");
		if (adminGroup && String(ctx.chat?.id) !== adminGroup) {
			await ctx.answerCallbackQuery({ text: "Not authorized" });
			return;
		}

		const adminId = String(ctx.from?.id ?? "");
		const adminName = ctx.from?.first_name ?? "Admin";

		if (action === "approve") {
			const result = await pubkyWriter.approve(writeId, adminId);

			// Edit the admin message to show approval status
			try {
				const originalText = ctx.callbackQuery?.message?.text ?? "";
				await ctx.editMessageText(
					originalText +
						`\n\n✅ **Approved** by ${adminName}` +
						(result.success ? " - Written successfully" : " - ⚠️ Write failed"),
					{ parse_mode: "Markdown" },
				);
			} catch {
				// ignore edit failures
			}

			await ctx.answerCallbackQuery({ text: result.message });
		} else {
			const result = await pubkyWriter.reject(writeId, adminId);

			// Edit the admin message to show rejection status
			try {
				const originalText = ctx.callbackQuery?.message?.text ?? "";
				await ctx.editMessageText(originalText + `\n\n❌ **Rejected** by ${adminName}`, {
					parse_mode: "Markdown",
				});
			} catch {
				// ignore edit failures
			}

			await ctx.answerCallbackQuery({ text: result.message });
		}
	});

	// Generic callback queries (inline keyboards) forwarder
	composer.on("callback_query:data", async (ctx: Context) => {
		const chatId = String(ctx.chat?.id ?? "");
		const data = ctx.callbackQuery?.data ?? "";
		log.debug("callback.received", { chatId, data });

		await buildSnapshot(chatId);
		const result = await dispatch({
			kind: "callback",
			data,
			ctx: { chatId, userId: String(ctx.from?.id ?? "") },
		});

		await applyServiceResponse(ctx, result.response);
		await ctx.answerCallbackQuery();
		log.debug("callback.processed", { chatId, data });
	});

	// Handler for new chat members - forward to listeners
	composer.on("message:new_chat_members", async (ctx: Context) => {
		const chatId = String(ctx.chat?.id ?? "");
		const members = ctx.message?.new_chat_members ?? [];
		log.info("new_chat_members.received", {
			chatId,
			count: members.length,
			members: JSON.stringify(members),
		});

		await buildSnapshot(chatId);
		const result = await dispatch({
			kind: "message",
			message: ctx.message,
			ctx: { chatId, userId: String(ctx.from?.id ?? "") },
		});
		await applyServiceResponse(ctx, result.response);
		log.debug("new_chat_members.processed", { chatId });
	});

	// Generic message listeners (forward as messages)
	composer.on("message", async (ctx: Context, next: () => Promise<void>) => {
		const chatId = String(ctx.chat?.id ?? "");
		// Log new_chat_members for debugging
		const msg = ctx.message as { new_chat_members?: unknown[] } | undefined;
		if (msg?.new_chat_members) {
			log.info("message.new_chat_members", {
				chatId,
				count: msg.new_chat_members.length,
				members: JSON.stringify(msg.new_chat_members),
			});
		}
		await buildSnapshot(chatId);
		const result = await dispatch({
			kind: "message",
			message: ctx.message,
			ctx: { chatId, userId: String(ctx.from?.id ?? "") },
		});
		await applyServiceResponse(ctx, result.response);
		await next();
		log.debug("message.processed", { chatId });
	});

	return composer;
}
