// packages/core_services/when2meet/locales/en.ts
// English strings for the when2meet service.

const en = {
	command: {
		title: "📅 <b>New availability poll</b>",
		intro:
			"Let's find a time that works for everyone. First — what are we scheduling? (e.g. <i>Pizza night</i>)",
		step_title_hint: "Send a short title (max {{max}} characters).",
	},
	title: {
		empty: "Title can't be empty. Try again.",
		too_long: "Title is too long. Max {{max}} characters.",
		ok: "✅ Title: <b>{{title}}</b>",
	},
	slot: {
		prompt_start_date:
			"📝 <b>Slot {{index}}/{{max}}</b> — what's the start date? (DD.MM.YYYY)\n\nExample: 23.04.2026",
		prompt_start_time: "⏰ What's the start time? (HH:MM, 24h)\n\nExample: 19:30",
		prompt_end_date:
			"📝 And the end date? (DD.MM.YYYY)\n\nIf the slot is on the same day, just re-send the start date.",
		prompt_end_time: "⏰ What's the end time? (HH:MM, 24h)",
		added:
			"✅ Slot {{index}} added: <b>{{slot}}</b>\n\nYou have {{count}} slot(s) so far. Add another, or publish when ready.",
	},
	review: {
		header: "📋 <b>Review your poll</b>",
		title_line: "<b>Title:</b> {{title}}",
		slot_line: "{{index}}. {{slot}}",
		footer: "What next?",
		button_add_slot: "➕ Add another slot",
		button_publish: "✅ Publish to chat",
		button_cancel: "❌ Cancel",
		need_two: "You need at least {{min}} slots before publishing. Add another.",
		max_reached: "You've reached the maximum of {{max}} slots. Publish when ready.",
		publishing: "🚀 Publishing your poll…",
		cancelled: "❌ Poll creation cancelled.",
	},
	validation: {
		date_format_invalid: "Invalid date format. Please use DD.MM.YYYY\n\nExample: 23.04.2026",
		date_month_invalid: "Invalid month. Must be 1-12.",
		date_day_invalid: "Invalid day. Must be 1-31.",
		date_combination_invalid: "Invalid date. Check day/month combination.",
		date_in_past: "The slot date must be in the future.",
		time_format_invalid: "Invalid time format. Please use HH:MM (24-hour)\n\nExample: 19:30",
		time_range_invalid: "Invalid time. Hours must be 0-23, minutes 0-59.",
		end_before_start_date: "End date ({{end}}) is before the start date ({{start}}).",
		end_before_start_time: "End time must be after start time.",
	},
	menu: {
		start_first: "Please start by using the /{{command}} command.",
		unknown_action: "Unknown action. Please start over.",
	},
} as const;

export default en;
export type When2meetLocale = typeof en;
