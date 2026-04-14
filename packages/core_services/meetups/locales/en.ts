// packages/core_services/meetups/locales/en.ts
// English strings for the meetups service. Key-for-key parity with de.ts is
// enforced by ../meetups_locales_test.ts.

const en = {
	not_configured: "Meetups service is not configured. Please set at least one calendar URI.",
	select_calendar: "Select a calendar:",
	select_time_range: "Select a time range:",
	all_calendars: "All Calendars",
	close_button: "\u2716 Close",
	back_button: "\u2190 Back",
	change_timeframe: "\u2190 Change timeframe",
	change_calendar: "\u2190 Change calendar",
	fetch_failed: "Failed to fetch upcoming events. Please try again.",
	no_events: "No upcoming events found.",
	default_title: "Upcoming Events",
	timeline: {
		today: "Today",
		week: "This week",
		"2weeks": "Next 2 weeks",
		"30days": "Next 30 days",
	},
} as const;

export default en;
export type MeetupsLocale = typeof en;
