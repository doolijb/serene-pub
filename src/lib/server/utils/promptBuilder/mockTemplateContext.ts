import type { TemplateContext } from "./types"
import { joinWithAnd } from "$lib/shared/utils/joinWithAnd"

// Static fictional demo story/cast for rendering a context template preview without a real chat.
export function buildMockTemplateContext(): TemplateContext {
	const characters = [
		{
			name: "Kestrel Vane",
			nickname: "Kestrel",
			description:
				"A sharp-eyed airship navigator with a mechanical left arm, forever tinkering with maps that refuse to stay accurate.",
			personality:
				"Pragmatic and dry-witted, warms up slowly, fiercely loyal once she does."
		},
		{
			name: "Old Marrow",
			description:
				"A moss-covered stone golem who has guarded the Sunken Archive for three hundred years and is very tired of it.",
			personality: "Patient to the point of exasperation. Speaks in short, weighty sentences."
		}
	]

	const personas = [
		{
			name: "Ana",
			description: "A freelance cartographer chasing rumors of a library that moves itself."
		}
	]

	const worldLore = [
		{
			name: "The Sunken Archive",
			content: "A library that submerges itself at dawn and resurfaces at dusk, somewhere different each time."
		}
	]

	const history = [
		{
			name: "The Storm Over Verath",
			content: "Three nights ago, Kestrel's airship was grounded by a storm that wasn't on any chart."
		}
	]

	const narrativeGraph = [
		{ a: "Kestrel Vane", b: "Old Marrow", relation: "uneasy allies", strength: 2 },
		{ a: "Ana", b: "The Sunken Archive", relation: "seeking", strength: 3 }
	]

	return {
		instructions:
			"Write Kestrel's next reply in this fictional roleplay with Ana. Stay in character, be descriptive, and never speak for Ana.",
		characters: JSON.stringify(characters, null, 2),
		personas: JSON.stringify(personas, null, 2),
		scenario:
			"Kestrel's airship sits grounded at the edge of a cliff, one day's walk from the last known surfacing of the Sunken Archive.",
		exampleDialogue:
			'Kestrel: "Maps lie. Mine just lie less than most." She tapped the brass casing of her arm against the hull, listening for the hollow spot that meant trouble.',
		postHistoryInstructions:
			"Keep responses to 2-3 paragraphs. End on a hook that invites Ana to act.",
		chatMessages: [
			{ id: 1, role: "user", name: "Ana", message: "How much further to the ridge?" },
			{
				id: 2,
				role: "assistant",
				name: "Kestrel",
				message:
					'Kestrel squinted at the horizon, then at the map, then back at the horizon. "If the map\'s honest today, an hour. If it\'s lying, could be three."'
			},
			{ id: 3, role: "user", name: "Ana", message: "And if it's lying?" }
		],
		char: "Kestrel",
		character: "Kestrel",
		user: "Ana",
		persona: "Ana",
		characterNames: joinWithAnd(["Kestrel", "Old Marrow"]),
		personaNames: joinWithAnd(["Ana"]),
		worldLore: JSON.stringify(worldLore, null, 2),
		history: JSON.stringify(history, null, 2),
		currentDate: "Year 3 of the Long Descent, early Autumn",
		narrativeGraph: JSON.stringify(narrativeGraph, null, 2)
	}
}
