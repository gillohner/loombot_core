// src/core/scheduler/pin_store.ts
// SQLite-backed persistence for the periodic meetups scheduler:
//   - pinned message id (so the next broadcast can unpin it)
//   - last-fired slot (so a restart within the same hour doesn't double-send)
//
// The storage is a single `periodic_pin_state` row per chat (see migration 6).
// The functions are `async` only to preserve the historical API signature;
// the underlying SQLite calls are synchronous.

import {
	getPeriodicLastFired,
	getPeriodicPinnedMessage,
	setPeriodicLastFired,
	setPeriodicPinnedMessage,
} from "@core/config/store.ts";

export function savePinnedMessage(chatId: string, messageId: number): Promise<void> {
	setPeriodicPinnedMessage(chatId, messageId);
	return Promise.resolve();
}

export function getPinnedMessage(chatId: string): Promise<number | null> {
	return Promise.resolve(getPeriodicPinnedMessage(chatId));
}

export function clearPinnedMessage(chatId: string): Promise<void> {
	setPeriodicPinnedMessage(chatId, null);
	return Promise.resolve();
}

export function getLastFired(chatId: string): Promise<string | null> {
	return Promise.resolve(getPeriodicLastFired(chatId));
}

export function setLastFired(chatId: string, slot: string): Promise<void> {
	setPeriodicLastFired(chatId, slot);
	return Promise.resolve();
}
