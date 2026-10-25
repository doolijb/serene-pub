/**
 * What the state widgets draw (R21), as `drawn()` in
 * `remoteStateWidgets.dom.test.ts` reads it, keyed by widget and case. First
 * recorded from the native components by the live parity run before they
 * were deleted (R79); re-recorded from the remote on 2026-10-18 after the
 * sheet redesign (PLAN-sheet-widget-redesign: the card head's face, read-only
 * rows as words, World State as Stats' module) — a regression snapshot since.
 * Re-recorded 2026-10-19 (PLAN-dc-after-walk2 Q3-6: an empty stat reads _none_).
 * Regenerate with `SP_RECORD_DREW=<json> npx vitest run …remoteStateWidgets.dom.test.ts`.
 * Test data only.
 */
export const NATIVE_DREW: Record<string, unknown> = {
	"world-state {}": {
		"widget": "world-state",
		"owner": "world",
		"alerts": [],
		"cards": [],
		"slots": [
			{
				"id": "core:slot/weather@1",
				"type": "enum",
				"label": "Weather",
				"title": "Sky",
				"button": "rain",
				"aria": "Weather, edit",
				"pressed": null,
				"disabled": false,
				"fill": null
			},
			{
				"id": "core:slot/lit@1",
				"type": "boolean",
				"label": "Lit",
				"title": "Lit",
				"button": "on",
				"aria": null,
				"pressed": "true",
				"disabled": false,
				"fill": null
			},
			{
				"id": "core:slot/omen@1",
				"type": "text",
				"label": "Omen",
				"title": "Omen",
				"button": "grey",
				"aria": "Omen, edit",
				"pressed": null,
				"disabled": false,
				"fill": null
			},
			{
				"id": "core:slot/danger@1",
				"type": "integer",
				"label": "Danger",
				"title": "Danger",
				"button": "3/5",
				"aria": "Danger 3/5, edit",
				"pressed": null,
				"disabled": false,
				"fill": 60
			},
			{
				"id": "core:slot/tension@1",
				"type": "derived",
				"label": "Tension",
				"title": "Tension",
				"button": null,
				"aria": null,
				"pressed": null,
				"disabled": null,
				"fill": null
			}
		],
		"empty": null
	},
	"world-state {\"layout\":\"list\",\"slots\":\"pick\",\"pickSlots\":[\"Omen\",\"danger\"]}": {
		"widget": "world-state",
		"owner": "world",
		"alerts": [],
		"cards": [],
		"slots": [
			{
				"id": "core:slot/omen@1",
				"type": "text",
				"label": "Omen",
				"title": "Omen",
				"button": "grey",
				"aria": "Omen, edit",
				"pressed": null,
				"disabled": false,
				"fill": null
			},
			{
				"id": "core:slot/danger@1",
				"type": "integer",
				"label": "Danger",
				"title": "Danger",
				"button": "3/5",
				"aria": "Danger 3/5, edit",
				"pressed": null,
				"disabled": false,
				"fill": 60
			}
		],
		"empty": null
	},
	"stats {}": {
		"widget": "stats",
		"owner": null,
		"alerts": [],
		"cards": [
			[
				"mira",
				"Mira"
			]
		],
		"slots": [
			{
				"id": "core:slot/hp@1",
				"type": "integer",
				"label": "Hp",
				"title": "Hp",
				"button": "14/20",
				"aria": "Hp 14/20, edit",
				"pressed": null,
				"disabled": false,
				"fill": 70
			},
			{
				"id": "core:slot/gold@1",
				"type": "integer",
				"label": "Gold",
				"title": "Gold",
				"button": "30",
				"aria": "Gold, edit",
				"pressed": null,
				"disabled": false,
				"fill": null
			}
		],
		"empty": null
	},
	"stats {\"members\":\"all\",\"density\":\"compact\"}": {
		"widget": "stats",
		"owner": null,
		"alerts": [],
		"cards": [
			[
				"mira",
				"Mira"
			],
			[
				"bram",
				"Bram"
			]
		],
		"slots": [
			{
				"id": "core:slot/hp@1",
				"type": "integer",
				"label": "Hp",
				"title": "Hp",
				"button": "14/20",
				"aria": "Hp 14/20, edit",
				"pressed": null,
				"disabled": false,
				"fill": 70
			},
			{
				"id": "core:slot/gold@1",
				"type": "integer",
				"label": "Gold",
				"title": "Gold",
				"button": "30",
				"aria": "Gold, edit",
				"pressed": null,
				"disabled": false,
				"fill": null
			},
			{
				"id": "core:slot/hp@1",
				"type": "integer",
				"label": "Hp",
				"title": "Hp",
				"button": "none",
				"aria": "Hp, edit",
				"pressed": null,
				"disabled": false,
				"fill": null
			}
		],
		"empty": null
	},
	"stats {\"members\":\"pick\",\"pickMembers\":[\"bram\"]}": {
		"widget": "stats",
		"owner": null,
		"alerts": [],
		"cards": [
			[
				"bram",
				"Bram"
			]
		],
		"slots": [
			{
				"id": "core:slot/hp@1",
				"type": "integer",
				"label": "Hp",
				"title": "Hp",
				"button": "none",
				"aria": "Hp, edit",
				"pressed": null,
				"disabled": false,
				"fill": null
			}
		],
		"empty": null
	},
	"stats {\"members\":\"pick\",\"pickMembers\":[\"nobody\"]}": {
		"widget": "stats",
		"owner": null,
		"alerts": [],
		"cards": [],
		"slots": [],
		"empty": "Nothing in this session matches the names in this widget's settings."
	},
	"world-state {\"slots\":[]}": {
		"widget": "world-state",
		"owner": "world",
		"alerts": [],
		"cards": [],
		"slots": [],
		"empty": "This session's rules declare no attributes."
	},
	"stats {\"slots\":[]}": {
		"widget": "stats",
		"owner": null,
		"alerts": [],
		"cards": [],
		"slots": [],
		"empty": "This session's rules declare no attributes."
	},
	"stats {\"castValues\":false}": {
		"widget": "stats",
		"owner": null,
		"alerts": [],
		"cards": [],
		"slots": [],
		"empty": "No one in the cast has a stat in play yet. Set one on a cast member's page, or let the story change one."
	},
	"world-state no world owner": {
		"widget": "world-state",
		"owner": "world",
		"alerts": [],
		"cards": [],
		"slots": [],
		"empty": "This session's world declares no stats to show here."
	},
	"world-state failed read": {
		"widget": "world-state",
		"owner": "world",
		"alerts": [
			"Could not read this session's state."
		],
		"cards": [],
		"slots": [
			{
				"id": "core:slot/weather@1",
				"type": "enum",
				"label": "Weather",
				"title": "Sky",
				"button": "rain",
				"aria": "Weather, edit",
				"pressed": null,
				"disabled": false,
				"fill": null
			},
			{
				"id": "core:slot/lit@1",
				"type": "boolean",
				"label": "Lit",
				"title": "Lit",
				"button": "on",
				"aria": null,
				"pressed": "true",
				"disabled": false,
				"fill": null
			},
			{
				"id": "core:slot/omen@1",
				"type": "text",
				"label": "Omen",
				"title": "Omen",
				"button": "grey",
				"aria": "Omen, edit",
				"pressed": null,
				"disabled": false,
				"fill": null
			},
			{
				"id": "core:slot/danger@1",
				"type": "integer",
				"label": "Danger",
				"title": "Danger",
				"button": "3/5",
				"aria": "Danger 3/5, edit",
				"pressed": null,
				"disabled": false,
				"fill": 60
			},
			{
				"id": "core:slot/tension@1",
				"type": "derived",
				"label": "Tension",
				"title": "Tension",
				"button": null,
				"aria": null,
				"pressed": null,
				"disabled": null,
				"fill": null
			}
		],
		"empty": null
	}
}
