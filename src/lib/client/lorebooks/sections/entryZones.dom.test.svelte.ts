/** The entry form's two zones: what the field sections draw for each context. */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => ({ emit: vi.fn(), on: () => {}, off: () => {} })
}))

import EntryZonesFixture from "./EntryZonesFixture.svelte"
import { bookDataContext, staticBookData } from "../bookData.svelte"
import type { VersionZones } from "../time/versionZones"

let app: Record<string, any> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

function draw(zones?: VersionZones) {
	const data = staticBookData(() => ({ timelineEnabled: true }) as any)
	const context = new Map<unknown, unknown>(bookDataContext(data))
	context.set("userSettingsCtx", { settings: { showAdvancedControls: true } })
	app = mount(EntryZonesFixture, {
		target: document.body,
		props: { draft: { keys: [], decayRate: 0 }, zones },
		context
	})
	flushSync()
}

function zones(
	zone: (f: string) => "entry" | "version",
	same: VersionZones["sameEverywhere"] = () => ({ blocked: "x" })
): VersionZones {
	return {
		railed: true,
		entryZoneRow: true,
		zoneOf: zone as any,
		sameEverywhere: same
	}
}

const keywords = () => document.querySelector("[data-lore-field=keywords]")
const text = () => document.body.textContent ?? ""
const button = (label: string) =>
	[...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === label
	) as HTMLButtonElement | undefined

describe("entry zones", () => {
	test("no context: everything draws as today", () => {
		draw()
		expect(keywords()).not.toBeNull()
		expect(text()).not.toContain("differs by version")
	})

	test("no row (History): keywords and Part of draw here whatever the zone", () => {
		draw({
			...zones(() => "entry"),
			railed: false,
			entryZoneRow: false
		})
		expect(keywords()).not.toBeNull()
		expect(text()).toContain("Part of")
	})

	test("the entry row holds them: keywords and Part of are not drawn here", () => {
		draw(zones(() => "entry"))
		expect(keywords()).toBeNull()
		expect(text()).not.toContain("Part of")
	})

	test("Pinned and Off that differ by version draw above the advanced fold, each with Make it the same everywhere", () => {
		draw(
			zones(
				(f) => (f === "constant" || f === "enabled" ? "version" : "entry"),
				() => ({ count: 1, run: () => {} })
			)
		)
		const fold = document.querySelector("details")!
		for (const mark of ["pinned", "off"]) {
			const el = document.querySelector(`[data-lore-mark=${mark}]`)!
			expect(el).not.toBeNull()
			expect(
				!!(el.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING)
			).toBe(true)
		}
		expect(
			document.querySelectorAll("[data-lore-differs]").length
		).toBe(2)
		expect(
			document
				.querySelector("[data-lore-mark=pinned]")!
				.getAttribute("aria-pressed")
		).toBe("false")
	})

	test("an entry that does not differ draws no Pinned or Off here", () => {
		draw(zones(() => "entry"))
		expect(document.querySelector("[data-lore-mark]")).toBeNull()
	})

	test("railed, version zone: differs by version; yes runs, Cancel does not", async () => {
		const run = vi.fn()
		draw(
			zones(
				(f) => (f === "keys" ? "version" : "entry"),
				() => ({ count: 2, run })
			)
		)
		expect(keywords()).not.toBeNull()
		expect(text()).toContain("differs by version")
		button("Make it the same everywhere")!.click()
		await tick()
		expect(text()).toContain("2 versions on this line")
		button("Cancel")!.click()
		await tick()
		expect(run).not.toHaveBeenCalled()
		button("Make it the same everywhere")!.click()
		await tick()
		button("Make it the same")!.click()
		await tick()
		expect(run).toHaveBeenCalledTimes(1)
		expect(button("Make it the same")).toBeUndefined()
	})

	test("blocked: the button is disabled and the sentence shows", () => {
		draw(
			zones(
				(f) => (f === "keys" ? "version" : "entry"),
				() => ({ blocked: "Another line carries it." })
			)
		)
		const b = button("Make it the same everywhere")!
		expect(b.disabled).toBe(true)
		expect(b.title).toBe("Another line carries it.")
		expect(text()).toContain("Another line carries it.")
	})

	test("a count of 0 runs at once without asking", async () => {
		const run = vi.fn()
		draw(
			zones(
				(f) => (f === "keys" ? "version" : "entry"),
				() => ({ count: 0, run })
			)
		)
		button("Make it the same everywhere")!.click()
		await tick()
		expect(run).toHaveBeenCalledTimes(1)
		expect(text()).not.toContain("Make this the same in every version?")
	})
})
