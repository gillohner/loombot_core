// packages/core_services/event-creator/flows/location.ts
// Location selection flow with Nominatim geocoding, confirmation, and message cleanup

import { type CallbackEvent, type MessageEvent, state, UIBuilder, uiKeyboard } from "@sdk/mod.ts";
import { LOC_REPLACE_GROUP, SERVICE_ID } from "../constants.ts";
import type { EventCreatorState } from "../types.ts";
import { escapeHtml } from "../utils/formatting.ts";
import { showOptionalMenu } from "./optional_menu.ts";
import { validateLocationName } from "../utils/validation.ts";
import { tev, tfor } from "../utils/i18n.ts";

interface NominatimResult {
	place_id: number;
	osm_type: string;
	osm_id: number;
	display_name: string;
	lat: string;
	lon: string;
	type: string;
}

type EvLike = CallbackEvent | MessageEvent;

/**
 * Show the location type selection menu (Physical vs Online)
 */
export function showLocationTypeMenu(st: EventCreatorState, ev: EvLike) {
	const t = tfor(ev.language);
	const keyboard = UIBuilder.keyboard()
		.namespace(SERVICE_ID)
		.callback(t("location.button_physical"), "location:type:physical")
		.row()
		.callback(t("location.button_online"), "location:type:online")
		.row()
		.callback(t("menu.back_to_menu"), "location:back");

	return uiKeyboard(
		keyboard.build(),
		t("location.title") + "\n\n" + t("location.type_prompt"),
		{
			state: state.replace(st),
			options: { replaceGroup: LOC_REPLACE_GROUP },
		},
	);
}

/**
 * Handle location type selection callback
 */
export function handleLocationTypeSelect(ev: CallbackEvent, locationType: string) {
	const st = (ev.state ?? {}) as EventCreatorState;
	const t = tfor(ev.language);

	if (locationType === "physical") {
		const keyboard = UIBuilder.keyboard()
			.namespace(SERVICE_ID)
			.callback(t("location.cancel_button"), "location:back");

		return uiKeyboard(
			keyboard.build(),
			t("location.physical_title") + "\n\n" + t("location.physical_prompt"),
			{
				state: state.replace({
					...st,
					waitingFor: "location_search",
				}),
				options: { replaceGroup: LOC_REPLACE_GROUP },
			},
		);
	}

	if (locationType === "online") {
		const keyboard = UIBuilder.keyboard()
			.namespace(SERVICE_ID)
			.callback(t("location.cancel_button"), "location:back");

		return uiKeyboard(
			keyboard.build(),
			t("location.online_title") + "\n\n" + t("location.online_prompt") + "\n\n" +
				t("location.online_prompt_skip"),
			{
				state: state.replace({
					...st,
					waitingFor: "location_online_url",
				}),
				options: { replaceGroup: LOC_REPLACE_GROUP },
			},
		);
	}

	return showLocationTypeMenu(st, ev);
}

/**
 * Show confirmation after location selection
 */
function showLocationConfirmation(st: EventCreatorState, ev: EvLike) {
	const loc = st.location!;
	const isOnline = loc.location_type === "ONLINE";
	const retryAction = isOnline ? "location:type:online" : "location:type:physical";
	const t = tfor(ev.language);

	const keyboard = UIBuilder.keyboard()
		.namespace(SERVICE_ID)
		.callback(t("location.button_confirm"), "location:confirm")
		.row()
		.callback(t("location.button_search_again"), retryAction)
		.row()
		.callback(t("menu.back_to_menu"), "location:back");

	let text: string;
	if (isOnline) {
		text = t("location.online_selected_title") + "\n\n" +
			t("location.online_selected_url", { url: escapeHtml(loc.structured_data || "") });
	} else {
		text = t("location.physical_selected_title") + "\n\n" +
			t("location.physical_selected_name", { name: escapeHtml(loc.name || "") });
		if (loc.structured_data) {
			text += `\n🔗 <a href="${escapeHtml(loc.structured_data)}">OpenStreetMap</a>`;
		}
		if (loc.lat != null && loc.lng != null) {
			text += `\n📍 ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
		}
	}
	text += "\n\n" + t("location.confirm_question");

	return uiKeyboard(keyboard.build(), text, {
		state: state.replace(st),
		options: { replaceGroup: LOC_REPLACE_GROUP },
	});
}

/**
 * Handle Nominatim search results callback (user selecting a result)
 */
export function handleLocationSelect(ev: CallbackEvent, index: string) {
	const st = (ev.state ?? {}) as EventCreatorState;
	const results = (st as Record<string, unknown>)._nominatimResults as
		| NominatimResult[]
		| undefined;
	const t = tfor(ev.language);

	const idx = parseInt(index, 10);
	if (!results || isNaN(idx) || idx < 0 || idx >= results.length) {
		const keyboard = UIBuilder.keyboard()
			.namespace(SERVICE_ID)
			.callback(t("location.button_search_again_short"), "location:type:physical")
			.row()
			.callback(t("menu.back_to_menu"), "location:back");

		return uiKeyboard(keyboard.build(), t("location.invalid_selection"), {
			state: state.replace(st),
			options: { replaceGroup: LOC_REPLACE_GROUP },
		});
	}

	const selected = results[idx];
	const osmUrl = `https://www.openstreetmap.org/${selected.osm_type}/${selected.osm_id}`;

	const updatedState = { ...st };
	updatedState.location = {
		name: selected.display_name,
		location_type: "PHYSICAL",
		structured_data: osmUrl,
		lat: parseFloat(selected.lat),
		lng: parseFloat(selected.lon),
	};
	delete (updatedState as Record<string, unknown>).waitingFor;

	return showLocationConfirmation(updatedState, ev);
}

/**
 * Handle location search text input (query Nominatim)
 */
export async function handleLocationSearchInput(
	text: string,
	st: EventCreatorState,
	ev: MessageEvent,
) {
	const t = tfor(ev.language);
	const validation = validateLocationName(text, ev.language);
	if (!validation.valid) {
		const keyboard = UIBuilder.keyboard()
			.namespace(SERVICE_ID)
			.callback(t("location.cancel_button"), "location:back");

		return uiKeyboard(keyboard.build(), validation.error!, {
			state: state.replace(st),
			options: { replaceGroup: LOC_REPLACE_GROUP },
		});
	}

	// Query Nominatim
	try {
		const url = new URL("https://nominatim.openstreetmap.org/search");
		url.searchParams.set("q", text);
		url.searchParams.set("format", "json");
		url.searchParams.set("addressdetails", "1");
		url.searchParams.set("limit", "5");

		const response = await fetch(url.toString(), {
			headers: {
				"User-Agent": "PubkyBotBuilder/1.0",
			},
		});

		if (!response.ok) {
			throw new Error(`Nominatim returned ${response.status}`);
		}

		const results = (await response.json()) as NominatimResult[];

		if (results.length === 0) {
			// No results — offer to use as plain name or retry
			const keyboard = UIBuilder.keyboard()
				.namespace(SERVICE_ID)
				.callback(
					t("location.button_use_as_name", { text: text.substring(0, 30) }),
					"location:use_name",
				)
				.row()
				.callback(t("location.button_search_again_short"), "location:type:physical")
				.row()
				.callback(t("menu.back_to_menu"), "location:back");

			const updatedState = {
				...st,
				_pendingLocationName: text,
			};
			delete (updatedState as Record<string, unknown>).waitingFor;

			return uiKeyboard(
				keyboard.build(),
				t("location.no_results_title", { text }) + "\n\n" +
					t("location.no_results_prompt"),
				{
					state: state.replace(updatedState),
					options: { replaceGroup: LOC_REPLACE_GROUP },
					deleteTrigger: true,
				},
			);
		}

		// Show results as keyboard buttons
		const keyboard = UIBuilder.keyboard().namespace(SERVICE_ID);
		for (let i = 0; i < results.length; i++) {
			const r = results[i];
			// Truncate display name for button
			const label = r.display_name.length > 60
				? r.display_name.substring(0, 57) + "..."
				: r.display_name;
			keyboard.callback(`📍 ${label}`, `location:select:${i}`).row();
		}
		keyboard
			.callback(
				t("location.button_use_as_name", { text: text.substring(0, 30) }),
				"location:use_name",
			)
			.row()
			.callback(t("menu.back_to_menu"), "location:back");

		// Store results in state for selection
		const updatedState = {
			...st,
			_nominatimResults: results,
			_pendingLocationName: text,
		};
		delete (updatedState as Record<string, unknown>).waitingFor;

		return uiKeyboard(
			keyboard.build(),
			t("location.search_results_header", { text: escapeHtml(text) }) + "\n\n" +
				t("location.search_results_prompt"),
			{
				state: state.replace(updatedState),
				options: { replaceGroup: LOC_REPLACE_GROUP },
				deleteTrigger: true,
			},
		);
	} catch (_err) {
		// Nominatim failed — fall back to using the text as plain name
		const updatedState = { ...st };
		updatedState.location = {
			name: text,
			location_type: "PHYSICAL",
		};
		delete (updatedState as Record<string, unknown>).waitingFor;
		delete (updatedState as Record<string, unknown>)._nominatimResults;
		delete (updatedState as Record<string, unknown>)._pendingLocationName;

		return showOptionalMenu(updatedState, ev, { cleanupGroup: LOC_REPLACE_GROUP });
	}
}

/**
 * Handle "use as plain name" button
 */
export function handleUseAsName(ev: CallbackEvent) {
	const st = (ev.state ?? {}) as EventCreatorState;
	const name = (st as Record<string, unknown>)._pendingLocationName as string | undefined;

	if (!name) {
		return showLocationTypeMenu(st, ev);
	}

	const updatedState = { ...st };
	updatedState.location = {
		name,
		location_type: "PHYSICAL",
	};
	delete (updatedState as Record<string, unknown>).waitingFor;

	return showLocationConfirmation(updatedState, ev);
}

/**
 * Handle location confirmation — accept and return to optional menu
 */
export function handleLocationConfirm(ev: CallbackEvent) {
	const st = (ev.state ?? {}) as EventCreatorState;

	// Clean temp fields
	const cleaned = { ...st };
	delete (cleaned as Record<string, unknown>)._nominatimResults;
	delete (cleaned as Record<string, unknown>)._pendingLocationName;
	delete (cleaned as Record<string, unknown>).waitingFor;

	return showOptionalMenu(cleaned, ev, { cleanupGroup: LOC_REPLACE_GROUP });
}

/**
 * Handle location back — clean up and return to optional menu
 */
export function handleLocationBack(ev: CallbackEvent) {
	const st = (ev.state ?? {}) as EventCreatorState;

	// Clean temp fields
	const cleaned = { ...st };
	delete (cleaned as Record<string, unknown>)._nominatimResults;
	delete (cleaned as Record<string, unknown>)._pendingLocationName;
	delete (cleaned as Record<string, unknown>).waitingFor;

	return showOptionalMenu(cleaned, ev, { cleanupGroup: LOC_REPLACE_GROUP });
}

/**
 * Handle online meeting URL input
 */
export function handleOnlineUrlInput(
	text: string,
	st: EventCreatorState,
	ev: MessageEvent,
) {
	const t = tfor(ev.language);
	// Basic URL validation
	try {
		const url = new URL(text);
		if (!url.protocol.startsWith("http")) {
			const keyboard = UIBuilder.keyboard()
				.namespace(SERVICE_ID)
				.callback(t("location.cancel_button"), "location:back");

			return uiKeyboard(keyboard.build(), t("location.invalid_url_protocol"), {
				state: state.replace(st),
				options: { replaceGroup: LOC_REPLACE_GROUP },
			});
		}
	} catch {
		const keyboard = UIBuilder.keyboard()
			.namespace(SERVICE_ID)
			.callback(t("location.cancel_button"), "location:back");

		return uiKeyboard(keyboard.build(), t("location.invalid_url_generic"), {
			state: state.replace(st),
			options: { replaceGroup: LOC_REPLACE_GROUP },
		});
	}

	const updatedState = { ...st };
	updatedState.location = {
		name: tev(ev, "location.online_name_default"),
		location_type: "ONLINE",
		structured_data: text,
	};
	delete (updatedState as Record<string, unknown>).waitingFor;

	return showLocationConfirmation(updatedState, ev);
}
