// src/bot.ts
// Wire up the bot: load operator config, init DB, optionally bring up the
// Pubky writer, and attach middleware. Exposed as createBot() so main.ts can
// await the initialization in a clean sequence.

import { Bot } from "grammy";
import { clearAllSnapshots, getDb, initDb, sha256Hex } from "@core/config/store.ts";
import { buildMiddleware } from "@middleware/router.ts";
import { pubkyWriter } from "@core/pubky/writer.ts";
import { setWriterDb } from "@core/pubky/writer_store.ts";
import { loadOperatorConfig } from "@core/config/loader.ts";
import { setOperatorConfig } from "@core/config/runtime.ts";
import { log } from "@core/util/logger.ts";

export async function createBot(): Promise<Bot> {
	const token = Deno.env.get("BOT_TOKEN");
	if (!token) throw new Error("BOT_TOKEN is required");

	// 1. Load + validate config.yaml
	const { config, sourcePath } = await loadOperatorConfig();
	const configHash = await sha256Hex(JSON.stringify(config));
	setOperatorConfig(config, configHash);
	log.info("config.loaded", {
		path: sourcePath,
		features: Object.keys(config.features).length,
		pubkyEnabled: config.pubky.enabled,
	});

	// 2. Database + snapshot reset
	initDb();
	clearAllSnapshots();

	// 3. Grammy bot instance
	const bot = new Bot(token);
	setWriterDb(getDb());

	// 4. Optional Pubky writer initialization
	if (config.pubky.enabled) {
		const passphrase = Deno.env.get(config.pubky.passphrase_env) ?? "";
		if (!passphrase) {
			log.warn("pubky.writer.no_passphrase", {
				hint: `Set ${config.pubky.passphrase_env} in .env.local`,
			});
		}
		// approval_group_chat_id: 0 is the placeholder value — treat as unset
		// so writes without an admin group surface a clear warning instead of
		// silently posting to chat 0.
		const rawAdminGroup = config.pubky.approval_group_chat_id;
		const adminGroup = rawAdminGroup && String(rawAdminGroup) !== "0"
			? String(rawAdminGroup)
			: undefined;
		if (!adminGroup) {
			log.warn("pubky.writer.no_admin_group", {
				hint:
					"Set pubky.approval_group_chat_id in config.yaml to the Telegram chat id of your admin group. Without it, Pubky write requests cannot be approved and will expire.",
			});
		}
		const ready = await pubkyWriter.initialize({
			recoveryFilePath: config.pubky.recovery_file,
			passphrase,
			adminGroup,
			approvalTimeout: config.pubky.approval_timeout_hours * 3600,
		});
		if (ready) {
			pubkyWriter.setBotApi({
				sendMessage: (chatId, text, options) =>
					bot.api.sendMessage(chatId, text, options as Parameters<typeof bot.api.sendMessage>[2]),
				editMessageText: async (chatId, messageId, text, options) => {
					await bot.api.editMessageText(
						chatId,
						messageId,
						text,
						options as Parameters<typeof bot.api.editMessageText>[3],
					);
				},
			});
		}
	} else {
		log.info("pubky.writer.disabled", { reason: "pubky.enabled=false" });
	}

	// 5. Attach middleware
	bot.use(buildMiddleware());
	return bot;
}
