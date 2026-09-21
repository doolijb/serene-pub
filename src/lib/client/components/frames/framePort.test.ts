/**
 * The host's side of the frame wire, held to the SDK's union.
 *
 * `PluginFrame.post()` takes `HostFrameMessage`, so the component itself will
 * not compile if it invents a member — but a `.svelte` file cannot be imported
 * as data, and the builders it posts through live out here. This file pins the
 * two things that check can miss:
 *
 *  1. every message this host sends is assignable to `HostFrameMessage`, so a
 *     member spelled wrong is a build failure rather than a post a frame drops
 *     on the floor;
 *  2. the builders return the union's member, not a look-alike.
 *
 * The assertions are mostly TYPE assertions — `satisfies` — and are enforced
 * by `svelte-check`, not by the runtime expectations below them. The runtime
 * half exists because a type-only file that silently stopped being compiled
 * would pass forever.
 *
 * The second half of the file pins what `framePort.ts` DECIDES — the paging,
 * the cursor and the saved-state cap — which is the other thing the component
 * could not be checked on: those rules exist out here precisely so a test can
 * reach them without driving a browser.
 */
import { describe, expect, it } from "vitest"
import {
	FRAME_PROTOCOL,
	WIDGET_PROTOCOL,
	type HostFrameMessage
} from "@serene-pub/sdk"
import { buildEventMessage, buildLayoutMessage } from "./framePlacement"
import { buildStyleMessage } from "./frameStyle"
import {
	buildPageMessage,
	buildStateMessage,
	frameStateKey,
	frameStateStore,
	initMessage,
	pageOf,
	FRAME_PAGE_DEFAULT,
	FRAME_PAGE_MAX,
	FRAME_STATE_MAX_BYTES,
	type FrameRow
} from "./framePort"
import type { PlacementInput } from "$lib/shared/widgets/context"

const placement: PlacementInput = {
	zone: { columns: 2, column: 1, rows: 1, row: 1 },
	box: {
		cols: 1,
		rows: null,
		edges: { top: true, right: false, bottom: true, left: true },
		px: { width: 320, height: 480 }
	},
	tier: "cozy",
	pinned: true,
	collapsed: false,
	drawered: false
}

/**
 * One of each message `PluginFrame` posts, in the order `push()` sends them,
 * plus the three that ride their own effects (`event`, `theme`,
 * `suspend`/`resume`) and the `init` that opens the port.
 */
const OUTGOING = [
	{ t: "init", protocol: FRAME_PROTOCOL, surface: "panel" },
	{ t: "session", session: { id: 1, name: "A session" } },
	{
		t: "channel",
		channel: "dice",
		messages: [
			{ id: 4, role: "assistant", content: "rolled", channel: "dice" }
		]
	},
	{ t: "messages", messages: [{ id: 4, role: "user", content: "roll" }] },
	{ t: "props", props: { panelId: "tray", title: "Dice tray" } },
	{ t: "settings", settings: { sides: 6 } },
	{ t: "actions", actions: {} },
	{ t: "theme", theme: "cerberus", mode: "dark" },
	{ t: "suspend" },
	{ t: "resume" }
] as const satisfies readonly HostFrameMessage[]

describe("the host posts only what the protocol declares", () => {
	it("every outgoing message is a member of the SDK's union", () => {
		// The `satisfies` above is the assertion. This one only proves the
		// file is still being compiled and run.
		expect(OUTGOING.map((m) => m.t)).toEqual([
			"init",
			"session",
			"channel",
			"messages",
			"props",
			"settings",
			"actions",
			"theme",
			"suspend",
			"resume"
		])
	})

	it("`init` carries the SDK's number, which is the widget contract's own", () => {
		expect(FRAME_PROTOCOL).toBe(WIDGET_PROTOCOL)
		expect(OUTGOING[0].protocol).toBe(FRAME_PROTOCOL)
	})

	it("the builders return the union's members", () => {
		const style = buildStyleMessage({
			css: ".sp-card{color:red}",
			vars: { "--x": "1" }
		}) satisfies HostFrameMessage
		const layout = buildLayoutMessage(placement) satisfies HostFrameMessage
		const event = buildEventMessage({
			kind: "message:created",
			channel: "dice",
			slug: "dice",
			lane: 1,
			messageId: 4
		}) satisfies HostFrameMessage
		expect(style.t).toBe("style")
		expect(layout.t).toBe("layout")
		expect(event.t).toBe("event")
	})

	it("a measured box crosses to the frame as `layout.v1.box.px`", () => {
		// The pixels are what survives the move off cells: a track's extent is
		// whatever the browser resolved, so a widget fitting itself to its box
		// reads these rather than a cell count.
		expect(buildLayoutMessage(placement).layout.box.px).toEqual({
			width: 320,
			height: 480
		})
	})
})

/* ── protocol 2's three answers (framePort.ts) ───────────────────────────────
 * The decisions the component makes when a frame sends `request`,
 * `save-state` or `error`. They live in `framePort.ts` precisely so they can
 * be pinned here without a DOM, and they are MIRRORED from the preview
 * harness's file of the same name — so the numbers below are pins on the
 * twin as much as on this host: an author who paged against the harness must
 * get the same page out of an instance. */

const rows = (n: number, channel?: string): FrameRow[] =>
	Array.from({ length: n }, (_, i) => ({
		id: i,
		content: `row ${i}`,
		...(channel ? { channel } : {})
	}))

describe("pageOf", () => {
	it("carries the harness's numbers — the twin's, not new ones", () => {
		expect(FRAME_PAGE_DEFAULT).toBe(50)
		expect(FRAME_PAGE_MAX).toBe(200)
		expect(FRAME_STATE_MAX_BYTES).toBe(16 * 1024)
	})

	it("answers the default page and offers a cursor when there is more", () => {
		const page = pageOf({ messages: rows(120) }, {})
		expect(page.rows).toHaveLength(FRAME_PAGE_DEFAULT)
		expect(page.rows[0]).toMatchObject({ id: 0 })
		expect(page.nextCursor).toBe("o:50")
	})

	it("hands the cursor back for the next page, and stops offering one at the end", () => {
		const source = { messages: rows(120) }
		const first = pageOf(source, {})
		const second = pageOf(source, { cursor: first.nextCursor })
		expect(second.rows[0]).toMatchObject({ id: 50 })
		expect(second.nextCursor).toBe("o:100")
		const third = pageOf(source, { cursor: second.nextCursor })
		expect(third.rows).toHaveLength(20)
		// The last page says so by carrying no cursor — a frame that pages
		// until `nextCursor` is absent must terminate.
		expect(third.nextCursor).toBeUndefined()
	})

	it("caps what a frame asks for at the host's ceiling", () => {
		expect(pageOf({ messages: rows(500) }, { limit: 1000 }).rows).toHaveLength(
			FRAME_PAGE_MAX
		)
		expect(pageOf({ messages: rows(500) }, { limit: 3 }).rows).toHaveLength(3)
	})

	it("reads a size that is not one as no size at all", () => {
		// Zero, negative and not-a-number are all "the frame asked for no
		// size", which is the default page — never zero rows, and never NaN
		// rows, which would silently be an empty page for ever.
		for (const limit of [0, -5, Number.NaN, Number.POSITIVE_INFINITY])
			expect(
				pageOf({ messages: rows(80) }, { limit }).rows
			).toHaveLength(FRAME_PAGE_DEFAULT)
	})

	it("cuts from the declared lanes only, and reads a bare slug as the whole channel", () => {
		const source = {
			messages: [
				...rows(2, "dice"),
				...rows(2, "dice:2"),
				...rows(3, "main")
			],
			channels: ["dice"]
		}
		// No channel asked for: every lane this panel declared, and nothing
		// else — the same cut the `channel` pushes made.
		const all = pageOf(source, {})
		expect(all.rows).toHaveLength(4)
		// The lane under a declared slug is the panel's business (ruled
		// 2026-09-09), which is where this host departs from the harness's
		// simpler `channel === lane` test.
		expect(pageOf(source, { channel: "dice:2" }).rows).toHaveLength(2)
	})

	it("declines a lane the surface never declared, with a reason", () => {
		const page = pageOf(
			{ messages: rows(3, "secrets"), channels: ["dice"] },
			{ channel: "secrets" }
		)
		expect(page.rows).toEqual([])
		// A refusal, never an empty page: an empty page would tell the frame
		// that somebody else's lane is empty, which is both false and news.
		expect(page.refused).toMatch(/not a lane this surface declared/)
	})

	it("pages the whole log for a surface that declared no lanes", () => {
		const source = { messages: [...rows(2, "dice"), ...rows(2, "main")] }
		expect(pageOf(source, {}).rows).toHaveLength(4)
		expect(pageOf(source, { channel: "dice" }).rows).toHaveLength(2)
	})

	it("declines a cursor it never issued", () => {
		const page = pageOf({ messages: rows(10) }, { cursor: "20" })
		expect(page.rows).toEqual([])
		expect(page.refused).toMatch(/not one this host issued/)
	})

	it("returns the union's `page`, with no cursor member when there is no more", () => {
		const page = pageOf({ messages: rows(2) }, {})
		const msg = buildPageMessage("r1", page) satisfies HostFrameMessage
		expect(msg).toEqual({ t: "page", requestId: "r1", rows: page.rows })
		expect("nextCursor" in msg).toBe(false)
		expect(
			buildPageMessage("r2", pageOf({ messages: rows(120) }, {})).nextCursor
		).toBe("o:50")
	})
})

describe("saved view state", () => {
	it("returns on the next mount what the frame saved", () => {
		const store = frameStateStore()
		const outcome = store.set("1:tray", { tab: "log", scroll: 120 })
		expect(outcome.kept).toBe(true)
		expect(store.get("1:tray")).toEqual({ tab: "log", scroll: 120 })
		const msg = buildStateMessage(store.get("1:tray")!) satisfies HostFrameMessage
		expect(msg).toEqual({
			t: "state",
			state: { tab: "log", scroll: 120 }
		})
	})

	it("holds a detached copy — the frame's own object never becomes the store", () => {
		const store = frameStateStore()
		const state = { tab: "log", nested: { open: true } }
		store.set("1:tray", state)
		state.nested.open = false
		expect(store.get("1:tray")).toEqual({ tab: "log", nested: { open: true } })
	})

	it("drops state over the cap, and says how big it was", () => {
		const store = frameStateStore()
		const outcome = store.set("1:tray", { blob: "x".repeat(FRAME_STATE_MAX_BYTES) })
		expect(outcome.kept).toBe(false)
		expect(outcome.bytes).toBeGreaterThan(FRAME_STATE_MAX_BYTES)
		expect(outcome.reason).toMatch(/over the host's/)
		// Dropped means dropped: nothing is half-kept, and a later mount gets
		// nothing rather than a truncated object.
		expect(store.get("1:tray")).toBeUndefined()
	})

	it("keeps state that sits exactly on the cap", () => {
		const store = frameStateStore()
		// `{"blob":"…"}` is 11 bytes of envelope around the value.
		const fits = { blob: "x".repeat(FRAME_STATE_MAX_BYTES - 11) }
		const outcome = store.set("1:tray", fits)
		expect(outcome.bytes).toBe(FRAME_STATE_MAX_BYTES)
		expect(outcome.kept).toBe(true)
	})

	it("refuses what is not an object of small values", () => {
		const store = frameStateStore()
		for (const bad of [null, "a string", 42, ["a", "list"]]) {
			const outcome = store.set("1:tray", bad)
			expect(outcome.kept).toBe(false)
			expect(outcome.reason).toMatch(/object of small values/)
		}
		const circular: Record<string, unknown> = {}
		circular.self = circular
		expect(store.set("1:tray", circular)).toMatchObject({
			kept: false,
			reason: expect.stringMatching(/JSON a host can store/)
		})
		expect(store.get("1:tray")).toBeUndefined()
	})

	it("clears one surface, or all of them", () => {
		const store = frameStateStore()
		store.set("1:tray", { tab: "log" })
		store.set("1:map", { tab: "grid" })
		store.clear("1:tray")
		expect(store.get("1:tray")).toBeUndefined()
		expect(store.get("1:map")).toEqual({ tab: "grid" })
		store.clear()
		expect(store.get("1:map")).toBeUndefined()
	})

	it("keys on the session as well as the surface", () => {
		const store = frameStateStore()
		store.set(frameStateKey(1, "tray"), { tab: "log" })
		store.set(frameStateKey(2, "tray"), { tab: "grid" })
		// The same panel in two sessions is two views: a scroll offset from
		// another session is worse than none.
		expect(store.get(frameStateKey(1, "tray"))).toEqual({ tab: "log" })
		expect(store.get(frameStateKey(2, "tray"))).toEqual({ tab: "grid" })
		// A surface with no session (a plugin page) still keys cleanly.
		expect(frameStateKey(undefined, "/plugin-ui/acme.forge/ui/index.html")).toBe(
			"-:/plugin-ui/acme.forge/ui/index.html"
		)
	})
})

describe("initMessage", () => {
	it("announces the SDK's protocol for the surface it opens", () => {
		const msg = initMessage("panel") satisfies HostFrameMessage
		expect(msg).toEqual({
			t: "init",
			protocol: FRAME_PROTOCOL,
			surface: "panel"
		})
	})
})
