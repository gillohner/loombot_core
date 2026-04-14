// src/core/pubky/writer.ts
// PubkyWriter: handles writing data to Pubky homeservers with admin approval flow.

import { log } from "@core/util/logger.ts";
import { blake3 } from "@noble/hashes/blake3";
import { t } from "@core/i18n/mod.ts";
import {
	getExpiredPendingWrites,
	getPendingWrite,
	type PendingWrite,
	savePendingWrite,
	updatePendingWriteStatus,
} from "./writer_store.ts";

// Session type from Pubky SDK
type PubkySession = Awaited<
	ReturnType<ReturnType<InstanceType<typeof import("@synonymdev/pubky").Pubky>["signer"]>["signin"]>
>;

export interface PubkyWriterConfig {
	recoveryFilePath?: string;
	passphrase?: string;
	adminGroup?: string;
	approvalTimeout?: number; // seconds, default 86400 (24h)
}

export interface QueueWriteParams {
	path: string;
	data: unknown;
	preview: string;
	serviceId: string;
	userId: string;
	chatId: string;
	onApprovalMessage?: string;
	onRejectionMessage?: string;
	/** Telegram username (without @) for admin display */
	userName?: string;
	/** Telegram display name for admin display */
	userDisplayName?: string;
}

// Telegram bot API interface (injected to avoid circular deps)
export interface BotApi {
	sendMessage(
		chatId: string | number,
		text: string,
		options?: {
			parse_mode?: string;
			reply_markup?: unknown;
		},
	): Promise<{ message_id: number }>;
	editMessageText(
		chatId: string | number,
		messageId: number,
		text: string,
		options?: { parse_mode?: string },
	): Promise<unknown>;
}

class PubkyWriter {
	private pubky: InstanceType<typeof import("@synonymdev/pubky").Pubky> | null = null;
	private session: PubkySession | null = null;
	private config: PubkyWriterConfig = {};
	private botApi: BotApi | null = null;
	private initialized = false;
	private publicKey: string | null = null;

	/**
	 * Initialize the writer with configuration.
	 * Call this once at startup after database is ready.
	 */
	async initialize(config?: PubkyWriterConfig, botApi?: BotApi): Promise<boolean> {
		this.config = {
			recoveryFilePath: config?.recoveryFilePath ?? Deno.env.get("PUBKY_RECOVERY_FILE"),
			passphrase: config?.passphrase ?? Deno.env.get("PUBKY_PASSPHRASE"),
			adminGroup: config?.adminGroup ?? Deno.env.get("PUBKY_ADMIN_GROUP"),
			approvalTimeout: config?.approvalTimeout ??
				Number(Deno.env.get("PUBKY_APPROVAL_TIMEOUT") || 86400),
		};

		if (botApi) {
			this.botApi = botApi;
		}

		// Check if we have credentials
		if (!this.config.recoveryFilePath || !this.config.passphrase) {
			log.info("pubky.writer.disabled", { reason: "missing credentials" });
			return false;
		}

		try {
			const { Pubky, Keypair } = await import("@synonymdev/pubky");

			this.pubky = new Pubky();

			// Load keypair from recovery file
			const recoveryData = await Deno.readFile(this.config.recoveryFilePath);
			const keypair = Keypair.fromRecoveryFile(recoveryData, this.config.passphrase);

			const rawKey = keypair.publicKey.toString();
			// Strip "pubky" prefix if present — toString() may include it
			this.publicKey = rawKey.startsWith("pubky") ? rawKey.slice(5) : rawKey;

			const signer = this.pubky.signer(keypair);

			// Sign in to homeserver (keypair must already be registered via Pubky Ring/CLI)
			this.session = await signer.signin();

			this.initialized = true;
			log.info("pubky.writer.initialized", { publicKey: this.publicKey });
			return true;
		} catch (err) {
			log.error("pubky.writer.init_failed", {
				error: (err as Error).message,
				hint: "Ensure keypair is registered with a homeserver using Pubky Ring or CLI",
			});
			return false;
		}
	}

	/**
	 * Check if writer is ready for use
	 */
	isReady(): boolean {
		return this.initialized && this.session !== null;
	}

	/**
	 * Get the public key of the configured identity
	 */
	getPublicKey(): string | null {
		return this.publicKey;
	}

	/**
	 * Get the configured admin group chat id (where approval requests are posted).
	 */
	getAdminGroup(): string | undefined {
		return this.config.adminGroup;
	}

	/**
	 * Set the bot API for sending messages (can be called after initialize)
	 */
	setBotApi(api: BotApi): void {
		this.botApi = api;
	}

	/**
	 * Queue a write request for admin approval.
	 * Returns the write ID for tracking.
	 */
	async queueWrite(params: QueueWriteParams): Promise<string> {
		const id = crypto.randomUUID();
		const timeout = this.config.approvalTimeout ?? 86400;

		const pending: PendingWrite = {
			id,
			path: params.path,
			data: params.data,
			preview: params.preview,
			serviceId: params.serviceId,
			userId: params.userId,
			chatId: params.chatId,
			createdAt: Date.now(),
			expiresAt: Date.now() + timeout * 1000,
			status: "pending",
			onApproval: params.onApprovalMessage
				? { chatId: params.chatId, message: params.onApprovalMessage }
				: undefined,
			onRejection: params.onRejectionMessage
				? { chatId: params.chatId, message: params.onRejectionMessage }
				: undefined,
		};

		// Store in database
		savePendingWrite(pending);

		// Forward to admin group for approval
		const adminMessageId = await this.forwardToAdminGroup(pending, {
			userName: params.userName,
			userDisplayName: params.userDisplayName,
		});
		if (adminMessageId) {
			updatePendingWriteStatus(id, "pending", { adminMessageId });
		}

		log.info("pubky.write.queued", {
			id,
			serviceId: params.serviceId,
			userId: params.userId,
			path: params.path,
		});

		return id;
	}

	/**
	 * Execute an approved write to Pubky.
	 * Enhanced to handle image uploads via __image_file_id metadata.
	 */
	async executeWrite(id: string): Promise<boolean> {
		if (!this.session) {
			log.error("pubky.write.not_initialized", { id });
			return false;
		}

		const pending = getPendingWrite(id);
		if (!pending) {
			log.warn("pubky.write.not_found", { id });
			return false;
		}

		if (pending.status !== "approved") {
			log.warn("pubky.write.not_approved", { id, status: pending.status });
			return false;
		}

		try {
			// Write to Pubky (path must be under /pub/)
			type PubPath = `/pub/${string}`;
			const pubPath = pending.path as PubPath;
			let dataToWrite = pending.data;

			log.debug("pubky.write.attempting", {
				id,
				path: pubPath,
				dataKeys: Object.keys(pending.data as object),
				publicKey: this.publicKey,
			});

			// Check for image metadata (event creator service enhancement)
			const data = pending.data as Record<string, unknown>;
			if (data.__image_file_id && data.__event_data) {
				log.info("pubky.write.image_detected", { id, fileId: data.__image_file_id });

				try {
					// 1. Download image from Telegram
					const imageBytes = await this.downloadTelegramFile(data.__image_file_id as string);

					// 2. Compute BLAKE3 content hash for blob ID (Crockford Base32)
					// pubky-app-specs requires: BLAKE3(content) → first 16 bytes → Crockford Base32
					const hash = blake3(new Uint8Array(imageBytes));
					const hashBytes = hash.slice(0, 16);
					const blobId = encodeCrockfordBase32(hashBytes);

					// 3. Upload blob bytes to /pub/pubky.app/blobs/{blobId}
					const { blobPathBuilder, filePathBuilder, generateTimestampId, getCurrentDtstamp } =
						await import("@eventky/mod.ts");
					const blobPath = blobPathBuilder(blobId);
					const blobUri = await this.uploadBytes(blobPath, imageBytes);

					if (blobUri) {
						// 4. Create PubkyAppFile metadata
						const fileId = generateTimestampId();
						const filePath = filePathBuilder(fileId);
						const fileData = {
							name: "event-image.jpg",
							created_at: getCurrentDtstamp(),
							src: blobUri,
							content_type: "image/jpeg",
							size: imageBytes.length,
						};

						// 5. Write file metadata to /pub/pubky.app/files/{fileId}
						type PubPath = `/pub/${string}`;
						await this.session!.storage.putJson(filePath as PubPath, fileData);
						const fileUri = `pubky://${this.publicKey}${filePath}`;

						// 6. Set image_uri on the event to the file URI
						const eventData = data.__event_data as Record<string, unknown>;
						eventData.image_uri = fileUri;
						dataToWrite = eventData;

						log.info("pubky.write.image_uploaded", {
							id,
							blobUri,
							fileUri,
							blobPath,
							filePath,
							imageSize: imageBytes.length,
						});
					} else {
						log.warn("pubky.write.image_upload_failed", { id });
						// Continue without image
						dataToWrite = data.__event_data;
					}
				} catch (imageErr) {
					log.error("pubky.write.image_error", {
						id,
						error: (imageErr as Error).message,
					});
					// Continue without image
					dataToWrite = data.__event_data;
				}
			}

			// Log the data being written for debugging calendar URIs
			const writeObj = dataToWrite as Record<string, unknown>;
			log.info("pubky.write.data_to_write", {
				id,
				path: pubPath,
				hasCalendarUris: !!writeObj.x_pubky_calendar_uris,
				calendarUris: writeObj.x_pubky_calendar_uris,
				dataKeys: Object.keys(writeObj),
			});

			await this.session.storage.putJson(pubPath, dataToWrite);

			// Verify the write by reading it back
			try {
				const readBack = await this.session.storage.getJson(pubPath);
				log.debug("pubky.write.verified", {
					id,
					path: pubPath,
					readBackExists: !!readBack,
					readBackKeys: readBack ? Object.keys(readBack as object) : [],
				});
			} catch (verifyErr) {
				log.warn("pubky.write.verify_failed", {
					id,
					path: pubPath,
					error: (verifyErr as Error).message,
				});
			}

			updatePendingWriteStatus(id, "written");

			log.info("pubky.write.success", { id, path: pending.path });

			// Notify user if service requested it (via onApprovalMessage)
			if (pending.onApproval && this.botApi) {
				try {
					await this.botApi.sendMessage(pending.onApproval.chatId, pending.onApproval.message, {
						parse_mode: "Markdown",
					});
				} catch (notifyErr) {
					log.warn("pubky.write.notify_failed", { error: (notifyErr as Error).message });
				}
			}

			return true;
		} catch (err) {
			updatePendingWriteStatus(id, "failed", { error: (err as Error).message });
			log.error("pubky.write.failed", { id, error: (err as Error).message });
			return false;
		}
	}

	/**
	 * Upload binary data (e.g., images) to Pubky.
	 * This is a direct write without approval flow - use for system uploads.
	 * Path must start with /pub/
	 */
	async uploadBytes(path: string, data: Uint8Array): Promise<string | null> {
		if (!this.session || !this.publicKey) {
			log.error("pubky.upload.not_initialized", {});
			return null;
		}

		try {
			type PubPath = `/pub/${string}`;
			await this.session.storage.putBytes(path as PubPath, data);
			const fullUri = `pubky://${this.publicKey}${path}`;
			log.info("pubky.upload.success", { path, size: data.length });
			return fullUri;
		} catch (err) {
			log.error("pubky.upload.failed", { path, error: (err as Error).message });
			return null;
		}
	}

	/**
	 * Download a file from Telegram by file_id.
	 * Returns the file bytes.
	 */
	private async downloadTelegramFile(fileId: string): Promise<Uint8Array> {
		const token = Deno.env.get("BOT_TOKEN");
		if (!token) {
			throw new Error("BOT_TOKEN not available for file download");
		}

		// Get file path from Telegram
		const fileInfoUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`;
		const fileInfoResponse = await fetch(fileInfoUrl);
		const fileInfo = await fileInfoResponse.json() as {
			ok: boolean;
			result?: { file_path: string };
		};

		if (!fileInfo.ok || !fileInfo.result?.file_path) {
			throw new Error("Failed to get file info from Telegram");
		}

		// Download file
		const fileUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`;
		const fileResponse = await fetch(fileUrl);

		if (!fileResponse.ok) {
			throw new Error(`Failed to download file: ${fileResponse.statusText}`);
		}

		const arrayBuffer = await fileResponse.arrayBuffer();
		return new Uint8Array(arrayBuffer);
	}

	/**
	 * Handle approval from admin.
	 */
	async approve(
		writeId: string,
		approvedBy: string,
	): Promise<{ success: boolean; message: string }> {
		const pending = getPendingWrite(writeId);
		if (!pending) {
			return { success: false, message: t("pubky.write_not_found") };
		}

		if (pending.status !== "pending") {
			return { success: false, message: t("pubky.already_status", { status: pending.status }) };
		}

		updatePendingWriteStatus(writeId, "approved", {
			approvedBy,
			approvedAt: Date.now(),
		});

		const writeSuccess = await this.executeWrite(writeId);
		return {
			success: writeSuccess,
			message: writeSuccess ? t("pubky.approve_result_ok") : t("pubky.approve_result_failed"),
		};
	}

	/**
	 * Handle rejection from admin.
	 */
	async reject(
		writeId: string,
		rejectedBy: string,
	): Promise<{ success: boolean; message: string }> {
		const pending = getPendingWrite(writeId);
		if (!pending) {
			return { success: false, message: t("pubky.write_not_found") };
		}

		if (pending.status !== "pending") {
			return { success: false, message: t("pubky.already_status", { status: pending.status }) };
		}

		updatePendingWriteStatus(writeId, "rejected", {
			approvedBy: rejectedBy,
			approvedAt: Date.now(),
		});

		// Notify user if service requested it (via onRejectionMessage).
		if (pending.onRejection && this.botApi) {
			try {
				await this.botApi.sendMessage(pending.onRejection.chatId, pending.onRejection.message, {
					parse_mode: "Markdown",
				});
			} catch (notifyErr) {
				log.warn("pubky.write.reject_notify_failed", {
					id: writeId,
					error: (notifyErr as Error).message,
				});
			}
		}

		return { success: true, message: t("pubky.reject_result") };
	}

	/**
	 * Clean up expired pending writes.
	 */
	async cleanupExpired(): Promise<number> {
		const expired = getExpiredPendingWrites();

		for (const write of expired) {
			updatePendingWriteStatus(write.id, "expired");

			// Try to edit admin message if accessible
			if (write.adminMessageId && this.config.adminGroup && this.botApi) {
				try {
					await this.botApi.editMessageText(
						this.config.adminGroup,
						write.adminMessageId,
						write.preview + "\n\n" + t("pubky.expired_notice"),
						{ parse_mode: "Markdown" },
					);
				} catch {
					// ignore edit failures (message may be too old)
				}
			}
		}

		if (expired.length > 0) {
			log.info("pubky.write.cleanup", { expired: expired.length });
		}

		return expired.length;
	}

	/**
	 * Forward a pending write to the admin group for approval.
	 */
	private async forwardToAdminGroup(
		pending: PendingWrite,
		userInfo?: { userName?: string; userDisplayName?: string },
	): Promise<number | undefined> {
		if (!this.config.adminGroup || !this.botApi) {
			log.warn("pubky.write.no_admin_group", {
				id: pending.id,
				hint:
					"Set pubky.approval_group_chat_id in config.yaml — pending writes have nowhere to go for approval.",
			});
			return undefined;
		}

		const expiresDate = new Date(pending.expiresAt).toISOString();
		// Build user display: clickable link if possible
		let userDisplay: string;
		if (userInfo?.userName) {
			userDisplay = `[@${userInfo.userName}](tg://user?id=${pending.userId})`;
		} else if (userInfo?.userDisplayName) {
			userDisplay = `[${userInfo.userDisplayName}](tg://user?id=${pending.userId})`;
		} else {
			userDisplay = `[User ${pending.userId}](tg://user?id=${pending.userId})`;
		}
		const message = t("pubky.admin_message", {
			userDisplay,
			userId: pending.userId,
			serviceId: pending.serviceId,
			path: pending.path,
			preview: pending.preview,
			expiresAt: expiresDate,
		});

		try {
			const result = await this.botApi.sendMessage(this.config.adminGroup, message, {
				parse_mode: "Markdown",
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: t("pubky.button_approve"),
								callback_data: `pubky:approve:${pending.id}`,
							},
							{
								text: t("pubky.button_reject"),
								callback_data: `pubky:reject:${pending.id}`,
							},
						],
					],
				},
			});
			return result.message_id;
		} catch (err) {
			log.error("pubky.write.forward_failed", { error: (err as Error).message });
			return undefined;
		}
	}
}

// Crockford Base32 encoder for blob IDs
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function encodeCrockfordBase32(bytes: Uint8Array): string {
	if (bytes.length === 0) return "";
	let bits = "";
	for (const b of bytes) bits += b.toString(2).padStart(8, "0");
	const pad = (5 - (bits.length % 5)) % 5;
	bits += "0".repeat(pad);
	let out = "";
	for (let i = 0; i < bits.length; i += 5) {
		out += CROCKFORD[parseInt(bits.slice(i, i + 5), 2)];
	}
	return out;
}

// Singleton instance
export const pubkyWriter = new PubkyWriter();
