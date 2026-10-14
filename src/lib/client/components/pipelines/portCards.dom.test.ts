/**
 * The builder inspector's Receives and Carries out cards (owner ruling
 * 2026-10-12): one line per port, a received line's source step by heading,
 * the shape as a tooltip, one muted line for an empty list, the step's effect
 * as a chip — and no cards at all for an older server that sends no lists.
 * An agent's heading in the step list picks the agent, whose own lists draw.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))

import PortCards from "./PortCards.svelte"
import StepList from "./workspace/StepList.svelte"
import { adventureGroups } from "./settingsGroups.fixture"
import { builderGroupsOf, builderStepsOf, portCardsOf } from "./settingsGroups"

let app: ReturnType<typeof mount> | null = null
let host: HTMLElement

beforeEach(() => {
	host = document.createElement("div")
	document.body.append(host)
})
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

const steps = builderStepsOf(adventureGroups())
const agents = builderGroupsOf(adventureGroups())
const headingOf = (key: string) => steps.find((s) => s.key === key)?.heading
const step = (key: string) => steps.find((s) => s.key === key)!
const card = (name: string) => host.querySelector<HTMLElement>(`section[aria-label="${name}"]`)

function draw(cards: ReturnType<typeof portCardsOf>) {
	app = mount(PortCards, { target: host, props: { cards } })
	flushSync()
}

describe("a step's ports, carried through the builder", () => {
	test("each step takes its receives, carries out and effect from its group row", () => {
		expect(step("g1-call").receives).toEqual([
			{ port: "plan", shape: "Plan", label: "The turn's plan", from: "g0-call" }
		])
		expect(step("g1-call").carriesOut).toEqual([])
		expect(step("g1-call").effect).toBe("write")
		expect(step("g1-call").group).toBe("g1")
		expect(step("g2-call").receives).toBeUndefined()
		expect(step("g2-call").carriesOut).toBeUndefined()
	})

	test("each agent carries its own two lists and its steps", () => {
		const narrator = agents.find((g) => g.key === "g1")!
		expect(narrator.heading).toBe("Narrator")
		expect(narrator.receives?.[0]?.from).toBe("g0-call")
		expect(narrator.carriesOut?.map((l) => l.label)).toEqual(["The scene"])
		expect(narrator.steps).toEqual(["g1-context", "g1-call"])
		expect(agents.find((g) => g.key === "g2")!.receives).toBeUndefined()
	})

	test("names every effect but none in words", () => {
		const words = (effect: "none" | "external" | "write" | "emit") =>
			portCardsOf({ receives: [], carriesOut: [], effect }, headingOf)!.effect
		expect(words("write")).toBe("Writes the session")
		expect(words("emit")).toBe("Raises an event")
		expect(words("external")).toBe("Reaches outside")
		expect(words("none")).toBeUndefined()
	})
})

describe("the Receives and Carries out cards", () => {
	test("draw each line, a received line's source step by heading, the shape as a tooltip", () => {
		draw(portCardsOf(step("g1-call"), headingOf))
		const line = card("Receives")!.querySelector<HTMLElement>("[data-port-line]")!
		expect(line.textContent?.replace(/\s+/g, " ").trim()).toBe(
			"The turn's plan from Plan the turn"
		)
		expect(line.title).toBe("Plan")
	})

	test("draw one muted line for an empty list", () => {
		draw(portCardsOf(step("g0-call"), headingOf))
		expect(card("Receives")!.querySelector("[data-port-empty]")?.textContent).toBe(
			"Nothing from other steps: it reads the session and the event."
		)
		expect(card("Carries out")!.querySelector("[data-port-line]")?.textContent?.trim()).toBe(
			"The turn's plan"
		)
		app && unmount(app)
		host.innerHTML = ""
		draw(portCardsOf(step("g1-call"), headingOf))
		expect(card("Carries out")!.querySelector("[data-port-empty]")?.textContent).toBe(
			"Nothing it writes: its result feeds the next step."
		)
	})

	test("chip the step's effect on Carries out, and nothing for none", () => {
		draw(portCardsOf(step("g1-call"), headingOf))
		expect(card("Carries out")!.querySelector("[data-effect-chip]")?.textContent?.trim()).toBe(
			"Writes the session"
		)
		unmount(app!)
		host.innerHTML = ""
		draw(portCardsOf(step("g0-call"), headingOf))
		expect(host.querySelector("[data-effect-chip]")).toBeNull()
	})

	test("draw nothing at all when the server sent neither list", () => {
		expect(portCardsOf(step("g2-call"), headingOf)).toBeNull()
		draw(portCardsOf(step("g2-call"), headingOf))
		expect(card("Receives")).toBeNull()
		expect(card("Carries out")).toBeNull()
	})
})

describe("picking an agent", () => {
	test("its heading in the step list is a button that picks the agent, whose lists draw", () => {
		const picked: string[] = []
		app = mount(StepList, {
			target: host,
			props: {
				steps,
				activeKey: null,
				pendingFor: () => 0,
				onSelect: () => {},
				onSelectGroup: (key: string) => picked.push(key)
			}
		})
		flushSync()
		const heading = [...host.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "Narrator"
		)!
		heading.click()
		expect(picked).toEqual(["g1"])
		unmount(app)
		host.innerHTML = ""

		draw(portCardsOf(agents.find((g) => g.key === picked[0])!, headingOf))
		expect(card("Receives")!.textContent).toContain("The turn's plan")
		expect(card("Receives")!.textContent).toContain("from Plan the turn")
		expect(card("Carries out")!.textContent).toContain("The scene")
		expect(host.querySelector("[data-effect-chip]")).toBeNull()
	})

	test("without a picker the heading stays plain text", () => {
		app = mount(StepList, {
			target: host,
			props: { steps, activeKey: null, pendingFor: () => 0, onSelect: () => {} }
		})
		flushSync()
		expect(
			[...host.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Narrator")
		).toBe(false)
	})
})
