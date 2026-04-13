// sdk/responses/factory.ts
// Generic response builders.
import type { StateDirective } from "../state.ts";
import type {
	AudioMessage,
	ContactMessage,
	DeleteMessage,
	DocumentMessage,
	EditMessage,
	ErrorMessage,
	LocationMessage,
	NoneMessage,
	PhotoMessage,
	PubkyWriteMessage,
	ReplyMessage,
	ServiceResponse,
	UIMessage,
	VideoMessage,
} from "./types.ts";
import type { UICard, UICarousel, UIKeyboard, UIMenu } from "../ui.ts";

/**
 * Common options for response helpers.
 * ttl: seconds until the platform should auto-delete the produced message.
 * If omitted, platform adapter will fallback to CONFIG.defaultMessageTtl (0 disables).
 */
interface BaseOpts {
	options?: Record<string, unknown>;
	state?: StateDirective;
	deleteTrigger?: boolean;
	ttl?: number; // in seconds
}

/**
 * Internal helper constructing a response with shared envelope fields including ttl.
 */
function base<K extends ServiceResponse["kind"], P extends Record<string, unknown>>(
	kind: K,
	payload: P,
	opts?: BaseOpts,
): Extract<ServiceResponse, { kind: K }> {
	return {
		kind,
		...payload,
		options: opts?.options,
		state: opts?.state,
		deleteTrigger: opts?.deleteTrigger,
		ttl: opts?.ttl,
	} as unknown as Extract<ServiceResponse, { kind: K }>;
}

export const reply = (text: string, opts?: BaseOpts): ReplyMessage => base("reply", { text }, opts);
export const edit = (text: string, opts?: BaseOpts): EditMessage => base("edit", { text }, opts);
export const none = (): NoneMessage => base("none", {});
export const error = (text: string): ErrorMessage => base("error", { text });
export const photo = (
	photo: string,
	opts?: BaseOpts & { caption?: string },
): PhotoMessage => base("photo", { photo, caption: opts?.caption }, opts);
export const del = (): DeleteMessage => base("delete", {});
export const audio = (
	audio: string,
	opts?: BaseOpts & { duration?: number; title?: string; performer?: string },
): AudioMessage =>
	base(
		"audio",
		{ audio, duration: opts?.duration, title: opts?.title, performer: opts?.performer },
		opts,
	);
export const video = (
	video: string,
	opts?: BaseOpts & { duration?: number; width?: number; height?: number; thumbnail?: string },
): VideoMessage =>
	base("video", {
		video,
		duration: opts?.duration,
		width: opts?.width,
		height: opts?.height,
		thumbnail: opts?.thumbnail,
	}, opts);
export const document = (
	document: string,
	opts?: BaseOpts & { filename?: string; mimeType?: string },
): DocumentMessage =>
	base("document", { document, filename: opts?.filename, mimeType: opts?.mimeType }, opts);
export const location = (
	latitude: number,
	longitude: number,
	opts?: BaseOpts & { title?: string; address?: string },
): LocationMessage =>
	base("location", { latitude, longitude, title: opts?.title, address: opts?.address }, opts);
export const contact = (
	phoneNumber: string,
	firstName: string,
	opts?: BaseOpts & { lastName?: string; userId?: string },
): ContactMessage =>
	base("contact", { phoneNumber, firstName, lastName: opts?.lastName, userId: opts?.userId }, opts);
export const ui = (
	uiElement: UIKeyboard | UIMenu | UICard | UICarousel,
	uiType: UIMessage["uiType"],
	text?: string,
	opts?: BaseOpts,
): UIMessage => base("ui", { text, ui: uiElement, uiType }, opts);
export const uiKeyboard = (kb: UIKeyboard, text?: string, opts?: BaseOpts): UIMessage =>
	ui(kb, "keyboard", text, opts);
export const uiMenu = (m: UIMenu, text?: string, opts?: BaseOpts): UIMessage =>
	ui(m, "menu", text, opts);
export const uiCard = (c: UICard, text?: string, opts?: BaseOpts): UIMessage =>
	ui(c, "card", text, opts);
export const uiCarousel = (c: UICarousel, text?: string, opts?: BaseOpts): UIMessage =>
	ui(c, "carousel", text, opts);

export const pubkyWrite = (
	path: string,
	data: unknown,
	opts: BaseOpts & {
		preview: string;
		onApprovalMessage?: string;
		onRejectionMessage?: string;
	},
): PubkyWriteMessage =>
	base(
		"pubky_write",
		{
			path,
			data,
			preview: opts.preview,
			onApprovalMessage: opts.onApprovalMessage,
			onRejectionMessage: opts.onRejectionMessage,
		},
		opts,
	);
