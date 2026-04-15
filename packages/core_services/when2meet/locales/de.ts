// packages/core_services/when2meet/locales/de.ts
// German strings for the when2meet service.

const de = {
	command: {
		title: "📅 <b>Neue Terminumfrage</b>",
		intro:
			"Lass uns eine Zeit finden, die allen passt. Zuerst — worum geht's? (z.B. <i>Pizza-Abend</i>)",
		step_title_hint: "Sende einen kurzen Titel (max. {{max}} Zeichen).",
	},
	title: {
		empty: "Der Titel darf nicht leer sein. Bitte erneut versuchen.",
		too_long: "Der Titel ist zu lang. Maximal {{max}} Zeichen.",
		ok: "✅ Titel: <b>{{title}}</b>",
	},
	slot: {
		prompt_start_date:
			"📝 <b>Slot {{index}}/{{max}}</b> — Startdatum? (TT.MM.JJJJ)\n\nBeispiel: 23.04.2026",
		prompt_start_time: "⏰ Startzeit? (HH:MM, 24h)\n\nBeispiel: 19:30",
		prompt_end_date:
			"📝 Und das Enddatum? (TT.MM.JJJJ)\n\nFalls der Slot am gleichen Tag ist, sende das Startdatum erneut.",
		prompt_end_time: "⏰ Endzeit? (HH:MM, 24h)",
		added:
			"✅ Slot {{index}} hinzugefügt: <b>{{slot}}</b>\n\nDu hast bisher {{count}} Slot(s). Füge weitere hinzu oder veröffentliche die Umfrage.",
	},
	review: {
		header: "📋 <b>Deine Umfrage prüfen</b>",
		title_line: "<b>Titel:</b> {{title}}",
		slot_line: "{{index}}. {{slot}}",
		footer: "Was nun?",
		button_add_slot: "➕ Weiteren Slot hinzufügen",
		button_publish: "✅ Im Chat veröffentlichen",
		button_cancel: "❌ Abbrechen",
		need_two:
			"Du brauchst mindestens {{min}} Slots vor dem Veröffentlichen. Füge einen weiteren hinzu.",
		max_reached:
			"Du hast das Maximum von {{max}} Slots erreicht. Veröffentliche, wenn du bereit bist.",
		publishing: "🚀 Umfrage wird veröffentlicht…",
		cancelled: "❌ Umfrage-Erstellung abgebrochen.",
	},
	validation: {
		date_format_invalid:
			"Ungültiges Datumsformat. Bitte TT.MM.JJJJ verwenden\n\nBeispiel: 23.04.2026",
		date_month_invalid: "Ungültiger Monat. Muss 1-12 sein.",
		date_day_invalid: "Ungültiger Tag. Muss 1-31 sein.",
		date_combination_invalid: "Ungültiges Datum. Prüfe die Kombination Tag/Monat.",
		date_in_past: "Das Slot-Datum muss in der Zukunft liegen.",
		time_format_invalid: "Ungültiges Zeitformat. Bitte HH:MM (24h) verwenden\n\nBeispiel: 19:30",
		time_range_invalid: "Ungültige Zeit. Stunden 0-23, Minuten 0-59.",
		end_before_start_date: "Das Enddatum ({{end}}) liegt vor dem Startdatum ({{start}}).",
		end_before_start_time: "Die Endzeit muss nach der Startzeit liegen.",
	},
	menu: {
		start_first: "Bitte starte mit dem /{{command}} Befehl.",
		unknown_action: "Unbekannte Aktion. Bitte von vorne beginnen.",
	},
} as const;

export default de;
