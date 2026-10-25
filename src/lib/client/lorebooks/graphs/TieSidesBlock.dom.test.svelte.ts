/**
 * 🚧 Screen 3 of "Ties on the graph" (lane T2, 2026-10-23): a relationship
 * the rules feed shows its type marked _from the rules_ and read-only; under
 * it, each person's side — its words and its number — with **Set…**, which
 * files a change for review and writes nothing; and **How it changed**, read
 * from the runs that wrote it. A row worded by hand keeps its own fields.
 *
 * ⚠ No DOM node is ever handed to `expect`.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

const { emitted, listeners } = vi.hoisted(() => ({
	emitted: [] as Array<[string, any]>,
	listeners: new Map<string, Set<(msg: any) => void>>()
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (msg: any) => void) => {
		let set = listeners.get(key)
		if (!set) listeners.set(key, (set = new Set()))
		set.add(handler)
		return () => set!.delete(handler)
	}
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({ useTypedSocket: () => ({ emit: () => {} }) }))

import TieSidesBlock from "./TieSidesBlock.svelte"
import RelationshipFields from "./RelationshipFields.svelte"

const socket = { emit: (event: string, payload: unknown) => void emitted.push([event, payload]) }
const answer = (event: string, data: unknown) => {
	for (const h of [...(listeners.get(event) ?? [])]) h(data)
	flushSync()
}

const SIDES: Sockets.NarrativeGraph.TieSides.Response = {
	relationshipId: 41,
	sides: [
		{
			sessionId: 7,
			owner: "character:1",
			ownerName: "Wren",
			towards: "character:2",
			zone: "bonds",
			entryType: "bond",
			onto: [{ field: "standing", target: "relationship-type", label: "Standing", value: "warm" }],
			numbers: [{ field: "affection", label: "Affection", value: 7, min: 0, max: 10 }],
			exposed: false
		}
	],
	history: [
		{
			runId: "run-1",
			at: Date.UTC(2026, 9, 23, 18, 0),
			sessionId: 7,
			owner: "character:1",
			ownerName: "Wren",
			towards: "character:2",
			towardsName: "Mara",
			columns: [{ target: "relationship-type", from: "wary", to: "warm" }],
			moved: { affection: { from: 6, to: 7 }, standing: { from: "wary", to: "warm" } }
		}
	]
}

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	emitted.length = 0
	listeners.clear()
})
const text = (sel: string) => (document.querySelector(sel)?.textContent ?? "").replace(/\s+/g, " ").trim()

describe("a tie the rules feed, on the lorebook (screen 3)", () => {
	test("the type is the rules': shown, marked and never typed", () => {
		const host = document.createElement("div")
		document.body.append(host)
		app = mount(RelationshipFields, {
			target: host,
			props: {
				value: { relationshipType: "warm", reverseRelationshipType: null, name: "crush", description: "", status: "active", visibility: "acknowledged", historyEntryId: null },
				pairing: "cast-cast",
				typeFromTheRules: true,
				onChange: () => {}
			}
		})
		flushSync()
		expect(text("[data-type-from-the-rules]")).toBe("Relationship type warm from the rules read-only here")
		expect(document.querySelector('input[placeholder="or type your own…"]')).toBeNull()
		expect(document.querySelectorAll("button.chip").length).toBe(0)
	})

	test("each side's words and number; Set… files a change for review; how it changed reads from the runs", async () => {
		const host = document.createElement("div")
		document.body.append(host)
		app = mount(TieSidesBlock, { target: host, props: { relationshipId: 41, socket } })
		flushSync()
		await tick()
		expect(emitted).toEqual([["narrativeGraph:tieSides", { relationshipId: 41 }]])
		answer("narrativeGraph:tieSides", SIDES)
		await tick()
		const side = '[data-tie-side="character:1"]'
		expect(text(`${side} strong`)).toBe("Wren's side")
		expect(text(`${side} [data-tie-onto="standing"]`)).toBe("warm from the rules Standing · read-only here")
		expect(text(`${side} [data-tie-number="affection"] [data-tie-value]`)).toBe("7")
		expect(document.querySelector(`${side} [role=img]`)?.getAttribute("aria-label")).toBe("Affection 7 of 10")
		expect(text("[data-tie-history] li")).toContain("Wren → Mara: wary → warm (6 → 7)")
		// Set…: a number typed, filed — nothing is written here.
		;(document.querySelector(`${side} [data-tie-set]`) as HTMLButtonElement).click()
		flushSync()
		const input = document.querySelector(`${side} input[type=number]`) as HTMLInputElement
		input.value = "9"
		input.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		;(document.querySelector(`${side} [data-tie-file]`) as HTMLButtonElement).click()
		await tick()
		expect(emitted.at(-1)).toEqual(["narrativeGraph:setTieSide", { relationshipId: 41, owner: "character:1", field: "affection", value: 9 }])
		answer("narrativeGraph:setTieSide", { success: "Filed as a change for review.", relationshipId: 41, proposalId: 3, sessionId: 7 })
		await tick()
		expect(text(`${side} [data-tie-number="affection"]`)).toContain("Filed. It changes once the session keeps it.")
		// The shown number has not moved: the session decides.
		expect(text(`${side} [data-tie-value]`)).toBe("7")
	})

	test("read-only: no Set…; no sides held: said so", async () => {
		const host = document.createElement("div")
		document.body.append(host)
		app = mount(TieSidesBlock, { target: host, props: { relationshipId: 41, socket, readOnly: true } })
		flushSync()
		answer("narrativeGraph:tieSides", SIDES)
		await tick()
		expect(document.querySelector("[data-tie-set]")).toBeNull()
		answer("narrativeGraph:tieSides", { relationshipId: 41, sides: [], history: [] })
		expect(document.querySelector("[data-tie-set]")).toBeNull()
	})
})
