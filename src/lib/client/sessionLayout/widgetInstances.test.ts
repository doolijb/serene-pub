/**
 * Widget instances in the layout editor (brief 7b of
 * `PLAN-layout-one-format-2026-09-28`, plan §M.3): "we should be able to add
 * more than one of each kind of widget" (owner, 2026-09-29).
 *
 * The rules the editor mints, offers, caps and duplicates by — pure, so the
 * page is not needed to hold them:
 *
 * - the Add menu offers every widget kind every time, with a count once it is
 *   placed, and turns a kind away only at its `maxInstances`;
 * - adding widget W places the bare `W` when no instance holds it, else `W#n`,
 *   n the smallest number ≥ 2 that is neither placed nor holding stored
 *   settings or a style pin — so a new copy never inherits a removed one's
 *   leftovers;
 * - Duplicate (QD, the plan's recommended default) copies the source's
 *   settings and style pin verbatim, `channel` included.
 */
import { describe, expect, test } from "vitest"
import { isWidgetInstanceId } from "@serene-pub/sdk"
import { SurfaceManager } from "../surfaces/panelManager.svelte"
import { instanceTitle } from "../surfaces/types"
import { resolveWidgetInstance } from "$lib/shared/widgets/settings"
import {
	patchWidgetSettings,
	setWidgetSettingDecls,
	setWidgetSettingsWriter,
	setWidgetSettingValues,
	widgetSettingValues
} from "$lib/client/stores/widgetSettings.svelte"
import { zoneEntries } from "./panelWidgets"
import {
	capRefusal,
	DUPLICATE_RULE,
	distinctTitles,
	duplicateOffered,
	duplicateValues,
	mintInstanceId,
	trayChipLabel,
	trayOffers,
	trayWidgets
} from "./widgetInstances"

type ModePanel = Sockets.Sessions.View.ModePanel

const STATS: ModePanel = {
	id: "stats",
	title: "Stats",
	icon: "Gauge",
	role: "secondary",
	surface: { kind: "remote", owner: "core", component: "stats" },
	src: "/core-ui/stats",
	settings: { compact: { type: "boolean", default: false } },
	defaultActive: false
}
const WORLD: ModePanel = {
	id: "world-state",
	title: "World state",
	icon: "Globe",
	role: "secondary",
	surface: { kind: "remote", owner: "core", component: "world-state" },
	src: "/core-ui/world-state",
	defaultActive: false
}

describe("minting a widget instance id", () => {
	test("the bare id first, whenever no instance holds it", () => {
		expect(mintInstanceId("stats", [], [])).toBe("stats")
		// A copy placed does not hold the bare id.
		expect(mintInstanceId("stats", ["stats#2"], [])).toBe("stats")
		// The bare id's own stored settings come back with it (M.3.4).
		expect(mintInstanceId("stats", [], ["stats"])).toBe("stats")
	})

	test("then the smallest n ≥ 2 that is neither placed nor holding stored settings or a pin", () => {
		expect(mintInstanceId("stats", ["stats"], [])).toBe("stats#2")
		expect(mintInstanceId("stats", ["stats", "stats#2"], [])).toBe("stats#3")
		// A removed copy's settings or pin are left behind (no server prune):
		// the next copy skips them rather than inheriting them.
		expect(mintInstanceId("stats", ["stats"], ["stats#2"])).toBe("stats#3")
		expect(mintInstanceId("stats", ["stats", "stats#3"], ["stats#2"])).toBe("stats#4")
		// Another widget's copies are no obstacle.
		expect(mintInstanceId("stats", ["stats", "world-state#2"], [])).toBe("stats#2")
		// A named copy is not a number: `#sanctum` leaves `#2` free.
		expect(mintInstanceId("messages", ["messages", "messages#sanctum"], [])).toBe("messages#2")
	})

	test("a Duplicate's mint (fresh) never lands on an id holding stored values — the bare id included", () => {
		// The bare `stats` was removed while `stats#2` stayed; its settings
		// persist for a re-add. Duplicating `stats#2` must not write over them.
		expect(mintInstanceId("stats", ["stats#2"], ["stats", "stats#2"], { fresh: true })).toBe("stats#3")
		// Nothing stored under the bare id: it is as good as any.
		expect(mintInstanceId("stats", ["stats#2"], ["stats#2"], { fresh: true })).toBe("stats")
		// The tray's add still brings the bare id's own values back.
		expect(mintInstanceId("stats", ["stats#2"], ["stats", "stats#2"])).toBe("stats")
	})

	test("a plugin widget mints under its namespaced id, and the result is a widget instance id", () => {
		const id = mintInstanceId("acme.maps:map", ["acme.maps:map"], [])
		expect(id).toBe("acme.maps:map#2")
		expect(isWidgetInstanceId(id)).toBe(true)
	})
})

describe("maxInstances refuses", () => {
	test("at the cap the kind is turned away, and says why", () => {
		expect(capRefusal(1, 1)).toBe("Only one per layout")
		expect(capRefusal(2, 2)).toBe("Only 2 per layout")
		expect(capRefusal(2, 1)).toBeNull()
		// No cap: never turned away (no core widget sets one).
		expect(capRefusal(undefined, 40)).toBeNull()
	})

	test("the tray keeps the capped kind on show, disabled with the reason", () => {
		const tray = trayWidgets(
			[
				{ id: "acme.audio:player", title: "Player", maxInstances: 1 },
				{ id: "stats", title: "Stats" }
			],
			["acme.audio:player", "stats", "stats#2"]
		)
		expect(tray.map((t) => [t.id, t.placed, t.full])).toEqual([
			["acme.audio:player", 1, "Only one per layout"],
			["stats", 2, null]
		])
	})
})

describe("the Add menu offers every widget kind every time", () => {
	test("placed kinds stay on offer, with a count once placed", () => {
		const tray = trayWidgets(
			[
				{ id: "messages", title: "Messages" },
				{ id: "stats", title: "Stats" },
				{ id: "world-state", title: "World state" }
			],
			["messages", "messages#sanctum", "stats"]
		)
		expect(tray.map(trayChipLabel)).toEqual([
			"Messages · 2 placed",
			"Stats · 1 placed",
			"World state"
		])
	})

	test("Messages is offered; the synthetic conversation never is; an R71 primary is when it replaces Messages", () => {
		const m = new SurfaceManager()
		m.init(1, [STATS], {}, () => {})
		// The manager's own stand-in for the log is not a widget to add.
		expect(trayOffers(m.decls, { id: "messages", title: "Messages" }).map((o) => o.id)).toEqual([
			"messages",
			"stats"
		])
		const board: ModePanel = {
			id: "acme.game:board",
			title: "Board",
			role: "primary",
			surface: { kind: "remote", owner: "acme.game", component: "board" },
			maxInstances: 1
		}
		const r71 = new SurfaceManager()
		r71.init(1, [board, STATS], {}, () => {}, new Set(["messages"]))
		expect(trayOffers(r71.decls, null).map((o) => [o.id, o.maxInstances])).toEqual([
			["acme.game:board", 1],
			["stats", undefined]
		])
	})
})

describe("two Stats and two World State copies both draw, with separate settings", () => {
	test("every placed copy is an instance the zone draws, under its own id and title", () => {
		const m = new SurfaceManager()
		m.init(
			1,
			[STATS, WORLD],
			{
				zoneLayout: {
					version: 1,
					zones: {
						right: {
							kind: "side",
							side: "right",
							widgets: ["stats", "stats#2", "world-state", "world-state#2"]
						}
					}
				}
			},
			() => {}
		)
		const drawn = zoneEntries(
			["stats", "stats#2", "world-state", "world-state#2"],
			m.instances,
			() => false,
			(id) => id
		)
		expect(drawn.map((e) => [e.id, e.title, e.panel?.src])).toEqual([
			["stats", "Stats", "/core-ui/stats"],
			["stats#2", "Stats · 2", "/core-ui/stats"],
			["world-state", "World state", "/core-ui/world-state"],
			["world-state#2", "World state · 2", "/core-ui/world-state"]
		])
		// Each is its own object: collapsing one copy leaves the other alone.
		m.toggleCollapse("stats#2")
		expect(m.instances.find((p) => p.id === "stats#2")!.collapsed).toBe(true)
		expect(m.instances.find((p) => p.id === "stats")!.collapsed).toBe(false)
	})

	test("a setting written to one copy is that copy's alone", () => {
		const m = new SurfaceManager()
		m.init(1, [STATS], { zoneLayout: { version: 1, zones: { right: { kind: "side", side: "right", widgets: ["stats", "stats#2"] } } } }, () => {})
		setWidgetSettingValues({})
		const decls = Object.fromEntries(
			m.instances.map((p) => [p.id, { id: p.id, title: p.title, channels: p.channels, settings: p.settings }])
		)
		setWidgetSettingDecls(decls)
		setWidgetSettingsWriter((next) => setWidgetSettingValues(next))
		patchWidgetSettings("stats#2", { compact: true, title: "Party" })
		setWidgetSettingsWriter(null)
		expect(widgetSettingValues("stats")).toEqual({})
		expect(widgetSettingValues("stats#2")).toEqual({ compact: true, title: "Party" })
		expect(resolveWidgetInstance(decls["stats"], widgetSettingValues("stats")).title).toBe("Stats")
		expect(resolveWidgetInstance(decls["stats#2"], widgetSettingValues("stats#2")).title).toBe("Party")
		setWidgetSettingValues({})
	})
})

describe("Duplicate (QD — the plan's recommended default, provisional)", () => {
	test("is set to copy the source's settings and style pin", () => {
		expect(DUPLICATE_RULE).toBe("copy-settings")
		expect(duplicateOffered()).toBe(true)
	})

	test("one constant answers all three of QD's options", () => {
		const src = { "stats#2": { compact: true } }
		const pins = { "stats#2": { id: 3, slug: "tidy" } }
		// (2) copies both; (3) keeps the button and copies neither; (1) has no button.
		expect(duplicateValues("stats#2", src, pins, "copy-settings")).toEqual({
			settings: { compact: true },
			pin: { id: 3, slug: "tidy" }
		})
		expect(duplicateValues("stats#2", src, pins, "copy-size")).toEqual({ settings: null, pin: null })
		expect(duplicateOffered("copy-size")).toBe(true)
		expect(duplicateOffered("tray-only")).toBe(false)
	})

	test("copies settings and the pin verbatim, channel included", () => {
		const out = duplicateValues(
			"messages#sanctum",
			{ "messages#sanctum": { channel: "sanctum", composer: "minimal" }, messages: { showTimes: true } },
			{ "messages#sanctum": { id: 7, slug: "quiet" } }
		)
		expect(out).toEqual({
			settings: { channel: "sanctum", composer: "minimal" },
			pin: { id: 7, slug: "quiet" }
		})
		// A copy of its values, not the same object.
		expect(out.settings).not.toBe(undefined)
	})

	test("a source with nothing stored hands the copy nothing", () => {
		expect(duplicateValues("stats", {}, {})).toEqual({ settings: null, pin: null })
	})
})

describe("a copy's title", () => {
	test("is its widget's, then · and its instance name; the bare id is the widget's own", () => {
		expect(instanceTitle("World state", "world-state#2")).toBe("World state · 2")
		expect(instanceTitle("World state", "world-state")).toBe("World state")
		expect(instanceTitle("Messages", "messages#sanctum")).toBe("Messages · sanctum")
	})
})

describe("titles that tell placed instances apart (7b review)", () => {
	test("a duplicated Sanctum reads Sanctum · 2; the shipped named copy keeps its title", () => {
		const out = distinctTitles([
			["messages", "Messages"],
			["messages#2", "Sanctum"],
			["messages#sanctum", "Sanctum"],
			["world-state", "World State"]
		])
		expect([...out]).toEqual([["messages#2", "Sanctum · 2"]])
	})

	test("the bare id keeps a shared title; numbered copies are told apart by number, not by position", () => {
		const out = distinctTitles([
			["stats#3", "Party"],
			["stats", "Party"],
			["stats#2", "Party"]
		])
		expect(out.get("stats")).toBeUndefined()
		expect(out.get("stats#2")).toBe("Party · 2")
		expect(out.get("stats#3")).toBe("Party · 3")
		// No bare id: the lowest number keeps it.
		const copies = distinctTitles([
			["stats#10", "Party"],
			["stats#2", "Party"]
		])
		expect([...copies]).toEqual([["stats#10", "Party · 10"]])
	})

	test("titles already apart change nothing", () => {
		expect(distinctTitles([["world-state", "World State"], ["world-state#2", "World State · 2"]]).size).toBe(0)
	})
})
