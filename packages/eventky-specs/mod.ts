// packages/eventky-specs/mod.ts
// Local implementation of Eventky utilities for creating calendar events.
// Provides validation, type definitions, and path builders for Eventky data.

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

// IANA timezone validation (simplified - accepts common patterns)
const TIMEZONE_REGEX = /^[A-Za-z_]+\/[A-Za-z_]+$/;
export function validateTimezone(tz: string): boolean {
	// Accept common IANA timezone patterns like "America/New_York", "Europe/Vienna"
	return TIMEZONE_REGEX.test(tz) || tz === "UTC";
}

// Hex color validation (#RRGGBB)
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
export function validateColor(color: string): boolean {
	return HEX_COLOR_REGEX.test(color);
}

// ISO 8601 duration validation (e.g., PT1H30M)
const DURATION_REGEX = /^P(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/;
export function validateDuration(duration: string): boolean {
	return DURATION_REGEX.test(duration) && duration !== "P" && duration !== "PT";
}

// Geo coordinates validation ("lat;lon" format)
const GEO_REGEX = /^-?\d+\.?\d*;-?\d+\.?\d*$/;
export function validateGeoCoordinates(geo: string): boolean {
	if (!GEO_REGEX.test(geo)) return false;
	const [lat, lon] = geo.split(";").map(Number);
	return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

// RFC 5545 RRULE basic validation
const RRULE_REGEX = /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/;
export function validateRrule(rrule: string): boolean {
	return RRULE_REGEX.test(rrule);
}

// Valid event statuses (RFC 5545)
export function getValidEventStatuses(): string[] {
	return ["CONFIRMED", "TENTATIVE", "CANCELLED"];
}

// Valid RSVP statuses
export function getValidRsvpStatuses(): string[] {
	return ["NEEDS-ACTION", "ACCEPTED", "DECLINED", "TENTATIVE"];
}

// ============================================================================
// TYPES
// ============================================================================

export type LocationType = "PHYSICAL" | "ONLINE";

export interface Location {
	name: string;
	location_type: LocationType;
	description?: string;
	structured_data?: string; // OSM URL for physical, meeting URL for online
}

export interface PubkyAppEvent {
	uid: string;
	dtstamp: number; // Unix microseconds
	dtstart: string; // ISO 8601 datetime
	summary: string;
	dtend?: string;
	duration?: string;
	dtstart_tzid?: string;
	dtend_tzid?: string;
	description?: string;
	status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
	image_uri?: string;
	url?: string;
	rrule?: string;
	rdate?: string[];
	exdate?: string[];
	recurrence_id?: string;
	x_pubky_calendar_uris?: string[];
	x_pubky_rsvp_access?: string;
	locations?: Location[];
}

// ============================================================================
// PATH/URI BUILDERS
// ============================================================================

export function eventPathBuilder(eventId: string): string {
	return `/pub/eventky.app/events/${eventId}`;
}

export function calendarPathBuilder(calendarId: string): string {
	return `/pub/eventky.app/calendars/${calendarId}`;
}

export function eventUriBuilder(userId: string, eventId: string): string {
	return `pubky://${userId}/pub/eventky.app/events/${eventId}`;
}

export function calendarUriBuilder(userId: string, calendarId: string): string {
	return `pubky://${userId}/pub/eventky.app/calendars/${calendarId}`;
}

export function blobPathBuilder(blobId: string): string {
	return `/pub/pubky.app/blobs/${blobId}`;
}

export function filePathBuilder(fileId: string): string {
	return `/pub/pubky.app/files/${fileId}`;
}

export function blobUriBuilder(userId: string, blobId: string): string {
	return `pubky://${userId}/pub/pubky.app/blobs/${blobId}`;
}

export function fileUriBuilder(userId: string, fileId: string): string {
	return `pubky://${userId}/pub/pubky.app/files/${fileId}`;
}

export interface PubkyAppFile {
	name: string;
	created_at: number; // Unix microseconds
	src: string; // pubky:// URI to the blob
	content_type: string;
	size: number;
}

// ============================================================================
// ID GENERATION (Crockford Base32 on bytes)
// ============================================================================

// Crockford Base32 alphabet (excludes I, L, O, U to avoid ambiguity)
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Encode bytes to Crockford Base32
 * This matches Rust's base32::encode(Alphabet::Crockford, &bytes) behavior
 *
 * The Rust base32 crate processes bits left-to-right and pads at the END.
 * For 8 bytes (64 bits), we get 13 characters with 1 bit of padding at the end.
 */
function encodeBytesToCrockford(bytes: Uint8Array): string {
	if (bytes.length === 0) return "";

	// Convert bytes to a bit string
	let bits = "";
	for (const byte of bytes) {
		bits += byte.toString(2).padStart(8, "0");
	}

	// Pad to multiple of 5 bits at the END (append zeros) - this is how Rust base32 works
	const padLen = (5 - (bits.length % 5)) % 5;
	bits = bits + "0".repeat(padLen);

	// Encode 5-bit groups
	let result = "";
	for (let i = 0; i < bits.length; i += 5) {
		const group = bits.slice(i, i + 5);
		const value = parseInt(group, 2);
		result += CROCKFORD_ALPHABET[value];
	}

	return result;
}

/**
 * Convert i64 timestamp to big-endian bytes (matches Rust's to_be_bytes())
 */
function i64ToBigEndianBytes(value: bigint): Uint8Array {
	const bytes = new Uint8Array(8);
	for (let i = 7; i >= 0; i--) {
		bytes[i] = Number(value & 0xFFn);
		value = value >> 8n;
	}
	return bytes;
}

/**
 * Generate a timestamp-based ID in Crockford Base32 format
 * Used for events, calendars, etc.
 *
 * This matches the Pubky specs algorithm:
 * 1. Get current time in MICROSECONDS since UNIX epoch
 * 2. Convert to big-endian i64 bytes
 * 3. Encode bytes using Crockford Base32
 *
 * Result is 13 characters (64 bits / 5 bits per char = 12.8, rounds to 13)
 */
export function generateTimestampId(): string {
	// Current time in MICROSECONDS (matches Rust implementation)
	const timestampMicros = BigInt(Date.now()) * 1000n;
	const bytes = i64ToBigEndianBytes(timestampMicros);
	return encodeBytesToCrockford(bytes);
}

/**
 * Get current timestamp in microseconds (for dtstamp field)
 */
export function getCurrentDtstamp(): number {
	return Date.now() * 1000;
}

// ============================================================================
// META RESULT (mimics PubkySpecsBuilder output)
// ============================================================================

export interface EventMeta {
	id: string;
	path: string;
	url: string;
}

export interface EventResult {
	event: PubkyAppEvent;
	meta: EventMeta;
}

/**
 * Create an event with auto-generated ID, path, and dtstamp
 */
export function createEvent(opts: {
	summary: string;
	dtstart: string;
	dtend?: string;
	duration?: string;
	dtstart_tzid?: string;
	dtend_tzid?: string;
	description?: string;
	status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
	image_uri?: string;
	url?: string;
	rrule?: string;
	rdate?: string[];
	exdate?: string[];
	recurrence_id?: string;
	x_pubky_calendar_uris?: string[];
	x_pubky_rsvp_access?: string;
	locations?: Location[];
}): EventResult {
	const eventId = generateTimestampId();
	const event: PubkyAppEvent = {
		uid: eventId,
		dtstamp: getCurrentDtstamp(),
		dtstart: opts.dtstart,
		summary: opts.summary,
		...(opts.dtend && { dtend: opts.dtend }),
		...(opts.duration && { duration: opts.duration }),
		...(opts.dtstart_tzid && { dtstart_tzid: opts.dtstart_tzid }),
		...(opts.dtend_tzid && { dtend_tzid: opts.dtend_tzid }),
		...(opts.description && { description: opts.description }),
		...(opts.status && { status: opts.status }),
		...(opts.image_uri && { image_uri: opts.image_uri }),
		...(opts.url && { url: opts.url }),
		...(opts.rrule && { rrule: opts.rrule }),
		...(opts.rdate && { rdate: opts.rdate }),
		...(opts.exdate && { exdate: opts.exdate }),
		...(opts.recurrence_id && { recurrence_id: opts.recurrence_id }),
		...(opts.x_pubky_calendar_uris && { x_pubky_calendar_uris: opts.x_pubky_calendar_uris }),
		...(opts.x_pubky_rsvp_access && { x_pubky_rsvp_access: opts.x_pubky_rsvp_access }),
		...(opts.locations && { locations: opts.locations }),
	};

	return {
		event,
		meta: {
			id: eventId,
			path: eventPathBuilder(eventId),
			url: eventPathBuilder(eventId), // placeholder - full URL requires pubkyId
		},
	};
}
