/**
 * The action legend (owner request 2026-09-28): what every action available
 * in this session does — the server's resolved list, section by venue, each
 * with its description, its slash command and what it collects (R3),
 * greyed ones with their reason.
 */
import { describe, expect, test } from "vitest"
import { legendSections, type LegendVenues } from "./actionLegend"

type Action = LegendVenues[string]["primary"][number]

const act = (over: Partial<Action> & Pick<Action, "key" | "name">): Action => ({
	specSlug: "core",
	slash: over.key,
	quick: false,
	audience: { see: ["participant"], act: ["participant"] },
	venue: "composer",
	origin: "core",
	floor: false,
	canAct: true,
	itemGated: false,
	isNew: false,
	enabled: true,
	...over
})

const venues: LegendVenues = {
	composer: {
		primary: [
			act({
				key: "narrate",
				specSlug: "core:spec/chat-narrate",
				name: "Narrate",
				description: "Ask the narrator to describe what happens next.",
				icon: "book-open-text",
				quick: true
			}),
			act({
				key: "build-room",
				specSlug: "core:spec/lair-build-room",
				name: "Build room",
				description: "Draft a new room.",
				slash: "build-room",
				collects: { text: { need: "required", label: "Room name" } },
				quick: true
			})
		],
		overflow: [
			act({
				key: "look",
				specSlug: "core:spec/adventure-look",
				name: "Look",
				description: "Describe where the party is.",
				enabled: false,
				reason: { i18n: { en: "Set a location first" } }
			})
		]
	},
	extra: {
		primary: [],
		overflow: [
			act({
				key: "advance",
				name: "Continue",
				venue: "extra",
				description: "Let whoever is next in the turn order speak."
			})
		]
	},
	message: {
		primary: [
			act({
				key: "edit",
				name: "Edit",
				venue: "message",
				slash: "edit",
				description: "Change the text of this message.",
				icon: "pencil",
				iconAlt: "Edit this message"
			})
		],
		overflow: []
	},
	widget: {
		primary: [act({ key: "fire", name: "Fire", venue: "widget", description: "Shoot." })],
		overflow: []
	}
}

const open = () => ({ disabled: false as const })

describe("legendSections", () => {
	test("lists exactly the resolved actions of the composer, extra and message venues, with descriptions", () => {
		const sections = legendSections(venues, open)
		expect(sections.map((s) => s.venue)).toEqual(["composer", "extra", "message"])
		expect(sections.map((s) => s.title)).toEqual([
			"In the composer",
			"Turn controls",
			"On a message"
		])
		expect(
			sections.flatMap((s) => s.entries.map((e) => `${s.venue}:${e.identity}:${e.description}`))
		).toEqual([
			"composer:core:spec/chat-narrate#narrate:Ask the narrator to describe what happens next.",
			"composer:core:spec/lair-build-room#build-room:Draft a new room.",
			"composer:core:spec/adventure-look#look:Describe where the party is.",
			"extra:core#advance:Let whoever is next in the turn order speak.",
			"message:core#edit:Change the text of this message."
		])
	})

	test("the slash command is shown where the / palette reaches — the composer and the extra tab — never on a message", () => {
		const bySlash = legendSections(venues, open).flatMap((s) =>
			s.entries.map((e) => [e.name, e.slash ?? null])
		)
		expect(bySlash).toEqual([
			["Narrate", "narrate"],
			["Build room", "build-room"],
			["Look", "look"],
			["Continue", "advance"],
			["Edit", null]
		])
	})

	test("what it collects rides along", () => {
		const build = legendSections(venues, open)[0]!.entries[1]!
		expect(build.collects).toEqual({ text: { need: "required", label: "Room name" } })
		expect(legendSections(venues, open)[0]!.entries[0]!.collects).toBeUndefined()
	})

	test("a greyed action is listed, with the reason the verdict gives", () => {
		const sections = legendSections(venues, (a) =>
			a.enabled === false
				? { disabled: true, reason: a.reason?.i18n.en }
				: { disabled: false }
		)
		const look = sections[0]!.entries.find((e) => e.name === "Look")!
		expect(look).toMatchObject({ disabled: true, reason: "Set a location first" })
		expect(sections[0]!.entries.filter((e) => e.disabled)).toHaveLength(1)
	})

	test("the verdict is asked per venue, so a message row is judged as one", () => {
		const asked: string[] = []
		legendSections(venues, (a, venue) => {
			asked.push(`${venue}:${a.key}`)
			return { disabled: false }
		})
		expect(asked).toEqual([
			"composer:narrate",
			"composer:build-room",
			"composer:look",
			"extra:advance",
			"message:edit"
		])
	})

	test("the icon's own name falls back to the action's", () => {
		const entries = legendSections(venues, open).flatMap((s) => s.entries)
		expect(entries.find((e) => e.name === "Edit")!.iconAlt).toBe("Edit this message")
		expect(entries.find((e) => e.name === "Narrate")!.iconAlt).toBe("Narrate")
	})

	test("an action listed twice in one venue (two channels) is one row; empty venues are no section", () => {
		const twice: LegendVenues = {
			composer: { primary: [venues.composer!.primary[0]!], overflow: [venues.composer!.primary[0]!] },
			message: { primary: [], overflow: [] }
		}
		const sections = legendSections(twice, open)
		expect(sections).toHaveLength(1)
		expect(sections[0]!.entries).toHaveLength(1)
	})
})
