/**
 * The legend, drawn (owner request 2026-09-28): the "?" is a named button,
 * and the open sheet lists exactly the rows `legendSections` resolved — the
 * name, the description, the slash command, the collects note, and a
 * greyed row's reason. Compared by attributes and text, never by node.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import ActionLegend from "./ActionLegend.svelte"
import { legendSections, type LegendVenues } from "./actionLegend"

type Action = LegendVenues[string]["primary"][number]
const act = (over: Partial<Action> & Pick<Action, "key" | "name">): Action => ({
	specSlug: "core",
	slash: over.key,
	quick: true,
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
				key: "whisper",
				specSlug: "core:spec/lair-whisper",
				name: "Whisper",
				description: "Say something only one delver hears.",
				icon: "ear",
				collects: { text: { need: "required", label: "What do you whisper?" } }
			}),
			act({
				key: "trap",
				specSlug: "core:spec/lair-trap",
				name: "Trigger trap",
				description: "Spring a trap on the party.",
				enabled: false,
				reason: { i18n: { en: "Nobody is in a room" } }
			})
		],
		overflow: []
	},
	message: {
		primary: [
			act({
				key: "retry",
				name: "Regenerate",
				venue: "message",
				description: "Write the newest reply again, in place of the one there.",
				icon: "refresh-cw"
			})
		],
		overflow: []
	}
}

const sections = legendSections(venues, (a) =>
	a.enabled === false ? { disabled: true, reason: a.reason?.i18n.en } : { disabled: false }
)

let app: ReturnType<typeof mount> | undefined
afterEach(() => {
	if (app) unmount(app)
	app = undefined
	document.body.innerHTML = ""
})

const rows = () =>
	[...document.querySelectorAll<HTMLElement>("[data-legend-action]")].map((li) => ({
		identity: li.dataset.legendAction,
		name: li.querySelector("[data-legend-name]")?.textContent?.trim(),
		description: li.querySelector("[data-legend-description]")?.textContent?.trim() ?? null,
		slash: li.querySelector("[data-legend-slash]")?.textContent?.trim() ?? null,
		asks: li.querySelector("[data-legend-collects]")?.textContent?.trim() ?? null,
		reason: li.querySelector("[data-legend-reason]")?.textContent?.trim() ?? null
	}))

describe("ActionLegend", () => {
	test("the ? is a button with an accessible name, and closed its panel is hidden", async () => {
		const host = document.createElement("div")
		document.body.append(host)
		app = mount(ActionLegend, { target: host, props: { sections } })
		flushSync()
		await tick()
		const trigger = host.querySelector("button")!
		expect(trigger.getAttribute("aria-label")).toBe("What do these do?")
		expect(trigger.textContent?.trim()).toBe("")
		expect(trigger.getAttribute("aria-expanded")).toBe("false")
		// Closed, the panel is in the DOM but hidden from everyone.
		const panel = document.querySelector<HTMLElement>("[role='dialog']")!
		expect(panel.hasAttribute("hidden")).toBe(true)
	})

	test.each(["sheet", "popover"] as const)("open as a %s, it is a labelled dialog listing exactly the resolved actions", async (presentation) => {
		const host = document.createElement("div")
		document.body.append(host)
		app = mount(ActionLegend, { target: host, props: { sections, open: true, presentation } })
		flushSync()
		await tick()
		const dialog = document.querySelector<HTMLElement>("[role='dialog']")!
		expect(dialog).not.toBeNull()
		const labelledBy = dialog.getAttribute("aria-labelledby")
		expect(labelledBy && document.getElementById(labelledBy)?.textContent?.trim()).toBe(
			"What these do"
		)
		expect(
			[...document.querySelectorAll("section h3")].map((h) => h.textContent?.trim())
		).toEqual(["In the composer", "On a message"])
		expect(rows()).toEqual([
			{
				identity: "core:spec/lair-whisper#whisper",
				name: "Whisper",
				description: "Say something only one delver hears.",
				slash: "/whisper",
				asks: "Asks for text",
				reason: null
			},
			{
				identity: "core:spec/lair-trap#trap",
				name: "Trigger trap",
				description: "Spring a trap on the party.",
				slash: "/trap",
				asks: null,
				reason: "Not now: Nobody is in a room"
			},
			{
				identity: "core#retry",
				name: "Regenerate",
				description: "Write the newest reply again, in place of the one there.",
				slash: null,
				asks: null,
				reason: null
			}
		])
		// Every icon in a row is decoration: the row's words name it.
		for (const svg of document.querySelectorAll("[data-legend-action] svg"))
			expect(svg.getAttribute("aria-hidden")).toBe("true")
		expect(dialog.hasAttribute("hidden")).toBe(false)
		// Every icon-only button in it carries a name — the sheet's Close.
		for (const b of dialog.querySelectorAll("button"))
			if (!b.textContent?.trim()) expect(b.getAttribute("aria-label")).toBeTruthy()
		if (presentation === "sheet")
			expect(
				[...dialog.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))
			).toContain("Close")
	})
})
