/**
 * The scope surface and the lens surface (design A.3): the rail is the
 * scopes and only the scopes — Views, then Saved with Pinned as a row that is
 * current INSTEAD of a scope, then one quiet loose-ends line — and the lens
 * is a track of seven icon buttons drawn from the registry.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		success: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warning: vi.fn()
	}
}))
// The rail reads the doors' icons from `sections`, which imports every
// editor; what is under test is the rail, not what an editor draws.
vi.mock("$lib/client/components/lorebookForms/LoreContentField.svelte", () => ({
	default: () => {}
}))

import { LORE_LENSES } from "$lib/shared/lorebooks/loreRoute"
import LensTrack from "./LensTrack.svelte"
import LoreRail from "./LoreRail.svelte"
import ScopePopout from "./ScopePopout.svelte"
import { LORE_LENS_REGISTRY } from "./lenses/registry"
import { railScopes, rulesListFacets } from "./scopes"

let app: Record<string, any> | null = null

afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	flushSync()
}

function target() {
	const el = document.createElement("div")
	document.body.append(el)
	return el
}

const SCOPES = railScopes({
	"core:entry/world-lore": 4,
	"core:entry/history": 2
})

function railProps(over: Record<string, unknown> = {}) {
	return {
		scopes: SCOPES,
		scope: "world" as const,
		lens: "list" as const,
		search: "",
		savedCounts: { pinned: 2 },
		saved: null,
		looseEndsCount: 3,
		onOpenLooseEnds: vi.fn(),
		onScope: vi.fn(),
		onSaved: vi.fn(),
		onSearch: vi.fn(),
		...over
	}
}

function railRows() {
	return [
		...document.querySelectorAll<HTMLButtonElement>(
			"[data-section-list] li > button"
		)
	]
}

const current = () =>
	railRows()
		.filter((b) => b.getAttribute("aria-current") === "page")
		.map((b) => b.textContent?.replace(/\d+/g, "").trim())

describe("LensTrack — drawn from the registry", () => {
	test("one icon button per lens, in order, named, with its shortcut; the lens in force pressed", async () => {
		const onselect = vi.fn()
		app = mount(LensTrack, {
			target: target(),
			props: { value: "graph", onselect }
		})
		await settle()
		const buttons = [
			...document.querySelectorAll<HTMLButtonElement>(
				"[data-lore-lens-track] [data-lore-lens]"
			)
		]
		expect(buttons.map((b) => b.dataset.loreLens)).toEqual([...LORE_LENSES])
		for (const [i, b] of buttons.entries()) {
			const d = LORE_LENS_REGISTRY[i]
			expect(b.getAttribute("aria-label")).toBe(d.label)
			expect(b.getAttribute("aria-keyshortcuts")).toBe(d.shortcut)
			expect(b.title).toContain(d.label)
			expect(b.getAttribute("aria-pressed")).toBe(
				String(d.id === "graph")
			)
		}
		buttons[6].click()
		expect(onselect).toHaveBeenCalledWith("places")
	})

	test("compact is one toolbar button naming the lens in force, over radio rows", async () => {
		const onselect = vi.fn()
		app = mount(LensTrack, {
			target: target(),
			props: { value: "cards", onselect, compact: true }
		})
		await settle()
		const trigger = document.querySelectorAll<HTMLElement>(
			"[data-lore-lens-track]"
		)
		expect(trigger.length).toBe(1)
		expect(trigger[0].getAttribute("aria-label")).toBe("Show as: Cards")
		const rows = [
			...document.querySelectorAll<HTMLButtonElement>(
				'[role="radio"][data-lore-lens]'
			)
		]
		expect(rows.map((r) => r.dataset.loreLens)).toEqual([...LORE_LENSES])
		expect(
			rows.filter((r) => r.getAttribute("aria-checked") === "true")
		).toEqual([rows[1]])
		rows[3].click()
		expect(onselect).toHaveBeenCalledWith("graph")
	})
})

describe("LoreRail — the scopes, and only the scopes", () => {
	test("draws Views then Saved, and the scope in force is the one current row", async () => {
		app = mount(LoreRail, { target: target(), props: railProps() })
		await settle()
		const labels = [
			...document.querySelectorAll("[data-section-list] h3")
		].map((h) => h.textContent?.trim())
		expect(labels).toEqual(["Views", "Saved"])
		expect(railRows().length).toBe(SCOPES.length + 1)
		expect(current()).toEqual(["World lore"])
		// No lens control rides in the rail any more.
		expect(document.querySelector("[data-lore-lens]")).toBeNull()
	})

	test("Pinned is a row, current INSTEAD of a scope", async () => {
		const props = railProps({ saved: "pinned" })
		app = mount(LoreRail, { target: target(), props })
		await settle()
		expect(current()).toEqual(["Pinned"])
		expect(railRows().some((b) => b.hasAttribute("aria-pressed"))).toBe(
			false
		)
	})

	test("choosing Pinned asks for the saved scope; choosing a view leaves it", async () => {
		const props = railProps({ saved: "pinned" })
		app = mount(LoreRail, { target: target(), props })
		await settle()
		const byLabel = (label: string) =>
			railRows().find((b) => b.textContent?.includes(label))!
		byLabel("Pinned").click()
		expect(props.onSaved).toHaveBeenLastCalledWith("pinned")
		byLabel("History").click()
		expect(props.onSaved).toHaveBeenLastCalledWith(null)
		expect(props.onScope).toHaveBeenCalledWith("history")
	})

	test("no row is current while Book settings is open", async () => {
		app = mount(LoreRail, {
			target: target(),
			props: railProps({ scope: null, saved: "pinned" })
		})
		await settle()
		expect(current()).toEqual([])
	})

	test("the foot is one quiet loose-ends line that opens the queue", async () => {
		const props = railProps()
		app = mount(LoreRail, { target: target(), props })
		await settle()
		const line = document.querySelector<HTMLButtonElement>(
			"[data-lore-loose-ends]"
		)
		expect(line?.textContent?.trim()).toBe("3 loose ends")
		expect(line?.hasAttribute("aria-pressed")).toBe(false)
		line?.click()
		expect(props.onOpenLooseEnds).toHaveBeenCalledOnce()
	})

	test("draws no loose-ends line at 0, nor while the queue is open", async () => {
		app = mount(LoreRail, {
			target: target(),
			props: railProps({ looseEndsCount: 0 })
		})
		await settle()
		expect(document.querySelector("[data-lore-loose-ends]")).toBeNull()
		unmount(app)
		app = mount(LoreRail, {
			target: target(),
			props: railProps({ looseEndsOpen: true })
		})
		await settle()
		expect(document.querySelector("[data-lore-loose-ends]")).toBeNull()
	})

	test("dims the views under a lens that ignores the scope, and says why", async () => {
		app = mount(LoreRail, {
			target: target(),
			props: railProps({ lens: "places" })
		})
		await settle()
		const nav = document.querySelector("[data-section-list]")!
		expect(nav.className).toContain("[&>ul:first-of-type]:opacity-60")
		expect(nav.querySelector(".sr-only")?.textContent).toContain(
			"Map draws the same whatever the view"
		)
	})
})

describe("ScopePopout — the compact scope picker", () => {
	test("names the scope in force, and lights only when narrower than Everything", async () => {
		app = mount(ScopePopout, {
			target: target(),
			props: {
				scopes: SCOPES,
				scope: "all",
				savedCounts: { pinned: 0 },
				saved: null,
				onScope: vi.fn(),
				onSaved: vi.fn()
			}
		})
		await settle()
		const at = () =>
			document.querySelector<HTMLElement>("[data-lore-scope-popout]")!
		expect(at().getAttribute("aria-label")).toBe("Views: Everything")
		expect(at().className).toContain("preset-tonal-surface")
		unmount(app)
		app = mount(ScopePopout, {
			target: target(),
			props: {
				scopes: SCOPES,
				scope: "all",
				savedCounts: { pinned: 2 },
				saved: "pinned",
				onScope: vi.fn(),
				onSaved: vi.fn()
			}
		})
		await settle()
		expect(at().getAttribute("aria-label")).toBe("Views: Pinned")
		expect(at().className).toContain("preset-pressed")
		const checked = [
			...document.querySelectorAll<HTMLButtonElement>(
				'[role="radio"][aria-checked="true"]'
			)
		]
		expect(checked.map((r) => r.dataset.loreScope)).toEqual([
			"saved:pinned"
		])
	})

	test("a view picked leaves the saved scope; the loose-ends line is not a radio", async () => {
		const props = {
			scopes: SCOPES,
			scope: "all" as const,
			savedCounts: { pinned: 2 },
			saved: "pinned" as const,
			onScope: vi.fn(),
			onSaved: vi.fn(),
			looseEndsCount: 2,
			onOpenLooseEnds: vi.fn()
		}
		app = mount(ScopePopout, { target: target(), props })
		await settle()
		document
			.querySelector<HTMLButtonElement>(
				'[role="radio"][data-lore-scope="history"]'
			)!
			.click()
		expect(props.onSaved).toHaveBeenCalledWith(null)
		expect(props.onScope).toHaveBeenCalledWith("history")
		const line = document.querySelector<HTMLButtonElement>(
			"[data-lore-loose-ends]"
		)!
		expect(line.getAttribute("role")).toBeNull()
		expect(line.closest('[role="radiogroup"]')).toBeNull()
		expect(line.textContent?.trim()).toBe("2 loose ends")
		line.click()
		expect(props.onOpenLooseEnds).toHaveBeenCalledOnce()
	})
})

describe("🚧 the rail's rules group (lane C1, ruled 2026-10-21)", () => {
	const list = (rules: string, repertoireId: string, label: string, libraryRows: number) => ({
		typeId: `core:entry/${rules}.${repertoireId}`,
		label,
		repertoireId,
		piece: { type: "object" as const, fields: {} },
		libraryRows
	})
	const VIS = [
		list("vis-itineris", "weapons", "Weapons", 12),
		list("vis-itineris", "armour", "Armour", 8),
		list("vis-itineris", "creatures", "Creatures", 0)
	]
	const FREEFORM = [
		list("freeform", "things", "Things", 0),
		list("freeform", "conditions", "Conditions", 0)
	]

	/** Each group's label and the rows under it, in order. */
	function groups() {
		return [...document.querySelectorAll<HTMLUListElement>("[data-section-list] ul")].map(
			(ul) => ({
				label: ul.getAttribute("aria-labelledby")
					? (document.getElementById(ul.getAttribute("aria-labelledby")!)?.textContent?.trim() ?? "")
					: "",
				rows: [...ul.querySelectorAll("li > button")].map((b) =>
					(b.textContent ?? "").replace(/\d+/g, "").trim()
				)
			})
		)
	}

	function group(lists: typeof VIS, counts: Record<string, number>, label: string) {
		const facets = rulesListFacets(lists, counts)
		return facets.length ? { label, facets } : null
	}

	test("a Vis Itineris book draws its library-backed lists after Views, before Saved", async () => {
		const props = railProps({ rulesGroup: group(VIS, {}, "Vis Itineris") })
		app = mount(LoreRail, { target: target(), props })
		await settle()
		const labels = groups().map((g) => g.label)
		expect(labels.indexOf("Vis Itineris")).toBe(labels.indexOf("Views") + 1)
		expect(labels.indexOf("Saved")).toBe(labels.indexOf("Vis Itineris") + 1)
		// Creatures has nothing in it yet: no row.
		expect(groups().find((g) => g.label === "Vis Itineris")?.rows).toEqual([
			"Weapons",
			"Armour"
		])
		const weapons = railRows().find((b) => b.textContent?.includes("Weapons"))!
		weapons.click()
		expect(props.onScope).toHaveBeenCalledWith("list:core:entry/vis-itineris.weapons")
	})

	test("a Freeform book's rail draws nothing new", async () => {
		app = mount(LoreRail, {
			target: target(),
			props: railProps({ rulesGroup: group(FREEFORM, {}, "Freeform") })
		})
		await settle()
		expect(groups().map((g) => g.label)).toEqual(["Views", "Saved"])
	})

	test("a Freeform book with one thing in it draws Things", async () => {
		app = mount(LoreRail, {
			target: target(),
			props: railProps({
				rulesGroup: group(FREEFORM, { "core:entry/freeform.things": 1 }, "Freeform")
			})
		})
		await settle()
		expect(groups().find((g) => g.label === "Freeform")?.rows).toEqual(["Things"])
	})

	test("the compact view picker draws the same rows under the rules' name", async () => {
		const props = {
			scopes: SCOPES,
			scope: "list:core:entry/vis-itineris.armour" as const,
			savedCounts: { pinned: 0 },
			saved: null,
			onScope: vi.fn(),
			onSaved: vi.fn(),
			rulesGroup: group(VIS, {}, "Vis Itineris")
		}
		app = mount(ScopePopout, { target: target(), props })
		await settle()
		expect(document.querySelector("[data-lore-rules-group]")?.textContent?.trim()).toBe(
			"Vis Itineris"
		)
		const armour = document.querySelector<HTMLButtonElement>(
			'[role="radio"][data-lore-scope="list:core:entry/vis-itineris.armour"]'
		)!
		expect(armour.getAttribute("aria-checked")).toBe("true")
		document
			.querySelector<HTMLButtonElement>(
				'[role="radio"][data-lore-scope="list:core:entry/vis-itineris.weapons"]'
			)!
			.click()
		expect(props.onScope).toHaveBeenCalledWith("list:core:entry/vis-itineris.weapons")
	})
})
