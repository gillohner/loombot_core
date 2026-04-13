// sdk/responses/types.ts
// Response message discriminated union & related interfaces.
import type { StateDirective } from "../state.ts";
import type { UICard, UICarousel, UIKeyboard, UIMenu } from "../ui.ts";

export interface BaseReply {
	kind: string;
	text?: string;
	options?: Record<string, unknown>;
	state?: StateDirective;
	deleteTrigger?: boolean;
	ttl?: number; // seconds until auto-deletion (overrides CONFIG.defaultMessageTtl if provided)
}
export interface ReplyMessage extends BaseReply {
	kind: "reply";
}
export interface EditMessage extends BaseReply {
	kind: "edit";
}
export interface NoneMessage extends BaseReply {
	kind: "none";
}
export interface ErrorMessage extends BaseReply {
	kind: "error";
	text?: string; // optional human-safe error message
}
export interface PhotoMessage extends BaseReply {
	kind: "photo";
	photo: string;
	caption?: string;
}
export interface DeleteMessage extends BaseReply {
	kind: "delete";
}
export interface AudioMessage extends BaseReply {
	kind: "audio";
	audio: string;
	duration?: number;
	title?: string;
	performer?: string;
}
export interface VideoMessage extends BaseReply {
	kind: "video";
	video: string;
	duration?: number;
	width?: number;
	height?: number;
	thumbnail?: string;
}
export interface DocumentMessage extends BaseReply {
	kind: "document";
	document: string;
	filename?: string;
	mimeType?: string;
}
export interface LocationMessage extends BaseReply {
	kind: "location";
	latitude: number;
	longitude: number;
	title?: string;
	address?: string;
}
export interface ContactMessage extends BaseReply {
	kind: "contact";
	phoneNumber: string;
	firstName: string;
	lastName?: string;
	userId?: string;
}
export interface UIMessage extends BaseReply {
	kind: "ui";
	ui: UIKeyboard | UIMenu | UICard | UICarousel;
	uiType: "keyboard" | "menu" | "card" | "carousel";
}

export interface PubkyWriteMessage extends BaseReply {
	kind: "pubky_write";
	path: string; // Must start with /pub/
	data: unknown; // JSON-serializable
	preview: string; // Human-readable preview for admins
	onApprovalMessage?: string; // Message to send user on approval
	onRejectionMessage?: string; // Message to send user on rejection
}

export type ServiceResponse =
	| ReplyMessage
	| EditMessage
	| NoneMessage
	| ErrorMessage
	| PhotoMessage
	| DeleteMessage
	| AudioMessage
	| VideoMessage
	| DocumentMessage
	| LocationMessage
	| ContactMessage
	| UIMessage
	| PubkyWriteMessage;

export type { StateDirective };
