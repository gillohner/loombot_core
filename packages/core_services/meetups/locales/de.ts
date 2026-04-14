// packages/core_services/meetups/locales/de.ts
// German strings for the meetups service.

const de = {
	not_configured:
		"Der Meetups-Service ist nicht konfiguriert. Bitte mindestens eine Kalender-URI angeben.",
	select_calendar: "Kalender auswählen:",
	select_time_range: "Zeitraum auswählen:",
	all_calendars: "Alle Kalender",
	close_button: "\u2716 Schliessen",
	back_button: "\u2190 Zurück",
	change_timeframe: "\u2190 Zeitraum ändern",
	change_calendar: "\u2190 Kalender ändern",
	fetch_failed: "Konnte anstehende Events nicht laden. Bitte später erneut versuchen.",
	no_events: "Keine bevorstehenden Events.",
	default_title: "Kommende Events",
	timeline: {
		today: "Heute",
		week: "Diese Woche",
		"2weeks": "Nächste 2 Wochen",
		"30days": "Nächste 30 Tage",
	},
} as const;

export default de;
