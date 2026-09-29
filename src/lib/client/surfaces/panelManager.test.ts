import { describe, it, expect, vi } from "vitest"
import type { WidgetEvent } from "$lib/shared/widgets/context"
import {
	SurfaceManager,
	type WitnessedMessage
} from "./panelManager.svelte"

type ModePanel = Sockets.Sessions.View.ModePanel

const PANELS: ModePanel[] = [
	{
		id: "tasks",
		title: "Tasks",
		role: "secondary",
		surface: { kind: "remote", owner: "core", component: "sample-notes" },
		channels: ["tasks"],
		defaultActive: false
	},
	{
		id: "portraits",
		title: "Portraits",
		role: "secondary",
		surface: { kind: "remote", owner: "core", component: "scene-portraits" },
		defaultActive: true
	}
]

function make(save = () => {}) {
	const m = new SurfaceManager()
	m.init(1, PANELS, {}, save)
	return m
}

describe("SurfaceManager — activation", () => {
	it("seeds a synthetic primary and honors defaultActive", () => {
		const m = make()
		expect(m.instances.find((p) => p.role === "primary")).toBeTruthy()
		expect(m.instances.find((p) => p.id === "portraits")!.active).toBe(true)
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(false)
	})

	it("addable lists inactive, non-primary panels", () => {
		const m = make()
		expect(m.addable.map((p) => p.id)).toEqual(["tasks"])
	})

	// The settings panel reads a widget's declared schema off the instance;
	// a declaration that stops here is a panel with nothing to configure.
	it("carries a declared settings schema onto the instance", () => {
		const m = new SurfaceManager()
		m.init(
			1,
			[
				{
					...PANELS[0],
					settings: { rows: { type: "integer", default: 3 } }
				}
			],
			{},
			() => {}
		)
		expect(m.instances.find((p) => p.id === "tasks")!.settings).toEqual({
			rows: { type: "integer", default: 3 }
		})
	})
})

describe("SurfaceManager — channel-driven autopopulation (21 §9)", () => {
	it("activates the panel that views a channel when a message lands", () => {
		const m = make()
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(false)
		m.activateForChannel("tasks")
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(true)
	})

	it("ignores main and unknown channels, and is idempotent", () => {
		const m = make()
		m.activateForChannel("main")
		m.activateForChannel(null)
		m.activateForChannel("nope")
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(false)
		m.activateForChannel("tasks")
		m.activateForChannel("tasks") // no throw, stays active
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(true)
	})

	/**
	 * Lanes (ruling 2026-09-09): the panel is a view onto the **channel**, so
	 * the second conversation opening in it is the same panel flowing in. A
	 * panel that only matched the bare slug would sit closed while its own
	 * channel filled up.
	 */
	it("matches on the channel, whichever lane the message landed on", () => {
		const m = make()
		m.activateForChannel("tasks:4")
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(true)
	})

	it("still ignores main, whichever lane of it", () => {
		const m = make()
		m.activateForChannel("main:3")
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(false)
	})
})

describe("SurfaceManager — explicit intents + persistence", () => {
	it("applyOpenIntent activates and persists (debounced)", async () => {
		vi.useFakeTimers()
		const save = vi.fn()
		const m = make(save)
		m.applyOpenIntent("tasks")
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(true)
		vi.advanceTimersByTime(500)
		expect(save).toHaveBeenCalledOnce()
		const blob = save.mock.calls[0][0]
		expect(blob.active.find((a: any) => a.id === "tasks").on).toBe(true)
		vi.useRealTimers()
	})

	it("couriers the widget grid: init reads it, setWidgetGrid persists it in the blob", async () => {
		vi.useFakeTimers()
		const save = vi.fn()
		const m = new SurfaceManager()
		// init rehydrates from the blob…
		m.init(1, PANELS, { widgetGrid: { version: 1, seeded: true } }, save)
		expect(m.widgetGrid).toEqual({ version: 1, seeded: true })
		// …and an edit persists (debounced) verbatim inside the same blob.
		m.setWidgetGrid({ version: 1, edited: true })
		vi.advanceTimersByTime(500)
		expect(save).toHaveBeenCalledOnce()
		expect(save.mock.calls[0][0].widgetGrid).toEqual({
			version: 1,
			edited: true
		})
		vi.useRealTimers()
	})

	it("omits widgetGrid from the blob when never set", () => {
		const m = make()
		expect("widgetGrid" in m.toBlob()).toBe(false)
	})

	it("applyCloseIntent deactivates a panel", () => {
		const m = make()
		m.activate("tasks")
		m.applyCloseIntent("tasks")
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(false)
	})

	it("whether a widget can close is its declaration's, not its role's (brief 7a)", () => {
		// The layout keeps the LAST placed primary by never offering to remove
		// it (the primary floor, sessionLayout/primaryFloor); the role no
		// longer decides, because a primary may sit in any zone.
		const m = make()
		const primary = m.instances.find((p) => p.role === "primary")!
		expect(primary.layout.closable).toBe(true)
		m.close(primary.id)
		expect(m.instances.find((p) => p.id === primary.id)!.active).toBe(false)
	})

	it("a declaration that says it cannot close is never closed, whatever its role", () => {
		const m = new SurfaceManager()
		m.init(1, [
			{
				id: "acme.game:board",
				title: "Board",
				role: "primary",
				surface: { kind: "remote", owner: "acme.game", component: "board" },
				layout: { closable: false }
			} as ModePanel
		], undefined, () => {})
		m.close("acme.game:board")
		expect(m.instances.find((p) => p.id === "acme.game:board")!.active).toBe(true)
	})
})

describe("SurfaceManager — the Layout menu operations", () => {
	it("secondaryPanels lists all non-primary panels (active or not)", () => {
		const m = make()
		expect(m.secondaryPanels.map((p) => p.id).sort()).toEqual([
			"portraits",
			"tasks"
		])
	})

	it("collapse-all / expand-all toggles every collapsible secondary", () => {
		const m = make()
		m.activate("tasks")
		m.setAllCollapsed(true)
		expect(m.allCollapsed).toBe(true)
		expect(
			m.instances.filter((p) => p.role !== "primary").every((p) => p.collapsed)
		).toBe(true)
		m.setAllCollapsed(false)
		expect(m.allCollapsed).toBe(false)
	})

	it("reset restores mode defaults — activation, drawer, and sizes", () => {
		const m = make()
		m.setWidth(1600)
		m.activate("tasks") // not a default
		m.toggleDrawer("portraits")
		m.resizeColumn(0, 0.5)
		m.resetLayout()
		// tasks back off (defaultActive false), portraits back on & on-grid
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(false)
		expect(m.instances.find((p) => p.id === "portraits")!.active).toBe(true)
		expect(m.instances.find((p) => p.id === "portraits")!.drawered).toBe(
			false
		)
		expect(m.colFr).toEqual({})
	})
})

describe("SurfaceManager — tier + columns", () => {
	it("derives tier from container width", () => {
		const m = make()
		m.setWidth(500)
		expect(m.tier).toBe("compact")
		m.setWidth(1200)
		expect(m.tier).toBe("roomy")
		m.setWidth(1600)
		expect(m.tier).toBe("wide")
	})

	it("resizeColumn shifts fr weight and refuses to starve a column", () => {
		const m = make()
		m.setWidth(1600) // wide → 4 columns
		m.resizeColumn(0, 0.5)
		expect(m.columns[0]).toBeGreaterThan(m.columns[1])
		// A huge shift that would drop a column below the floor is refused.
		const before = [...m.columns]
		m.resizeColumn(0, -10)
		expect(m.columns).toEqual(before)
	})
})

/**
 * The manager is the SESSION-level event source every widget bus fans out from
 * (PLAN 25). It is the one thing that already sees channel activity — the page
 * calls `activateForChannel` for every message that lands — so it is where
 * `channel:activated` is born rather than a second subscription of its own.
 */
describe("SurfaceManager — the widget event source", () => {
	it("announces a channel when a panel viewing it is surfaced", () => {
		const m = make()
		const seen: WidgetEvent[] = []
		m.subscribe((e) => seen.push(e))
		m.activateForChannel("tasks")
		expect(seen).toEqual([
			{ kind: "channel:activated", channel: "tasks", slug: "tasks", lane: 1 }
		])
	})

	it("carries the lane, canonically (lane 1 is the bare slug)", () => {
		const m = make()
		const seen: WidgetEvent[] = []
		m.subscribe((e) => seen.push(e))
		m.activateForChannel("tasks:4")
		expect(seen[0]).toMatchObject({
			channel: "tasks:4",
			slug: "tasks",
			lane: 4
		})
	})

	it("says nothing when nothing was surfaced — main, unknown, already open", () => {
		const m = make()
		const seen: WidgetEvent[] = []
		m.subscribe((e) => seen.push(e))
		m.activateForChannel("main") // the anchored log never autopopulates
		m.activateForChannel("nope") // no panel views it
		m.activateForChannel(null)
		m.activateForChannel("tasks") // → one event
		m.activateForChannel("tasks") // already open: not a new arrival on screen
		expect(seen).toHaveLength(1)
	})

	it("unsubscribe stops delivery", () => {
		const m = make()
		const seen: WidgetEvent[] = []
		const off = m.subscribe((e) => seen.push(e))
		off()
		m.activateForChannel("tasks")
		expect(seen).toEqual([])
	})

	it("one subscriber throwing cannot rob the next of its event", () => {
		const m = make()
		const seen: WidgetEvent[] = []
		m.subscribe(() => {
			throw new Error("widget blew up")
		})
		m.subscribe((e) => seen.push(e))
		expect(() => m.activateForChannel("tasks")).not.toThrow()
		expect(seen).toHaveLength(1)
	})
})

/**
 * The five message/generation kinds the envelope declares and nothing produced
 * (2026-09-17). The wire carries no events — a `sessionMessage` push is the
 * WHOLE row every time, streaming chunks included — so the manager is handed
 * the arrival and the row it replaced, and works out which events that is.
 *
 * One test per kind, plus the two silences that matter: a backlog is not a
 * flood of arrivals, and a first sighting is not an update.
 */
describe("SurfaceManager — what a message arrival announces", () => {
	const seenOn = (m: SurfaceManager) => {
		const seen: WidgetEvent[] = []
		m.subscribe((e) => seen.push(e))
		return seen
	}
	const row = (over: Partial<WitnessedMessage> = {}): WitnessedMessage => ({
		id: 7,
		channel: "main",
		content: "",
		isGenerating: false,
		generationOutcome: null,
		...over
	})

	it("generation:start — a row that arrives already filling", () => {
		const m = make()
		const seen = seenOn(m)
		m.witnessMessage(row({ isGenerating: true }))
		expect(seen).toEqual([{ kind: "generation:start", messageId: 7 }])
	})

	it("message:delta — the appended text alone, never the whole content", () => {
		const m = make()
		const seen = seenOn(m)
		const a = row({ content: "Hel", isGenerating: true })
		const b = row({ content: "Hello", isGenerating: true })
		m.witnessMessage(b, a)
		expect(seen).toEqual([
			{ kind: "message:delta", messageId: 7, delta: "lo", channel: "main" }
		])
	})

	it("message:updated — an arrival that is not appended text", () => {
		const m = make()
		const seen = seenOn(m)
		m.witnessMessage(
			row({ content: "Goodbye", channel: "tasks:4" }),
			row({ content: "Hello", channel: "tasks:4" })
		)
		expect(seen).toEqual([
			{ kind: "message:updated", messageId: 7, channel: "tasks:4" }
		])
	})

	it("generation:end — and `aborted` is the stopped outcome, not an error", () => {
		const m = make()
		const finished = seenOn(m)
		m.witnessMessage(
			row({ content: "done", isGenerating: false }),
			row({ content: "done", isGenerating: true })
		)
		expect(finished).toContainEqual({
			kind: "generation:end",
			messageId: 7,
			aborted: false
		})

		const m2 = make()
		const stopped = seenOn(m2)
		m2.witnessMessage(
			row({ content: "half", generationOutcome: "stopped" }),
			row({ content: "half", isGenerating: true })
		)
		expect(stopped).toContainEqual({
			kind: "generation:end",
			messageId: 7,
			aborted: true
		})
	})

	it("message:deleted — naming the channel the row was on", () => {
		const m = make()
		const seen = seenOn(m)
		m.witnessMessageDeleted(row({ channel: "tasks" }))
		expect(seen).toEqual([
			{ kind: "message:deleted", messageId: 7, channel: "tasks" }
		])
	})

	it("a deletion whose row the caller no longer holds names no channel", () => {
		const m = make()
		const seen = seenOn(m)
		// Absent is "unknown", so the event reaches every widget rather than
		// being narrowed to a channel nobody established.
		m.witnessMessageDeleted({ id: 7 })
		expect(seen).toEqual([{ kind: "message:deleted", messageId: 7 }])
	})

	it("never announces message:created — every widget's own feed owns that", () => {
		const m = make()
		const seen = seenOn(m)
		m.witnessMessage(row({ content: "Hello" }))
		expect(seen).toEqual([])
	})

	it("a finished row's last chunk is still a delta, not an update", () => {
		const m = make()
		const seen = seenOn(m)
		m.witnessMessage(
			row({ content: "Hello there", isGenerating: false }),
			row({ content: "Hello", isGenerating: true })
		)
		expect(seen).toEqual([
			{
				kind: "message:delta",
				messageId: 7,
				delta: " there",
				channel: "main"
			},
			{ kind: "generation:end", messageId: 7, aborted: false }
		])
	})

	it("text appended to a row nobody is generating is an edit, not a delta", () => {
		const m = make()
		const seen = seenOn(m)
		m.witnessMessage(row({ content: "Hello there" }), row({ content: "Hello" }))
		expect(seen).toEqual([
			{ kind: "message:updated", messageId: 7, channel: "main" }
		])
	})
})

describe("a genre that withholds the conversation (R71)", () => {
	it("gets no synthetic conversation, and keeps what it withholds", () => {
		const board: ModePanel = {
			id: "acme.game:board",
			title: "Board",
			role: "primary",
			surface: { kind: "remote", owner: "acme.game", component: "board" },
			defaultActive: true
		}
		const m = new SurfaceManager()
		m.init(1, [board, ...PANELS], {}, () => {}, undefined, new Set(["messages"]))
		expect(m.instances.filter((p) => p.role === "primary").map((p) => p.id)).toEqual(["acme.game:board"])
		expect(m.omitted.has("messages")).toBe(true)
	})

	it("a genre that withholds nothing still gets the conversation", () => {
		const m = make()
		expect(m.instances.some((p) => p.role === "primary")).toBe(true)
		expect(m.omitted.size).toBe(0)
	})
})
