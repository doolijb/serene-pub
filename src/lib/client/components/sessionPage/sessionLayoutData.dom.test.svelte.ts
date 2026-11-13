/**
 * A widget-settings write made while a layout copy this tab asked for is
 * pending is held, not sent: the arrangement the tab holds is the old one.
 * The copy's answer then sends it — as it was when refused, replayed over
 * the copy's own values when it landed.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import Harness from "./sessionLayoutDataHarness.test.svelte"

vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: () => {}, success: () => {} }
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	onConnect: () => () => {}
}))

import {
	createSessionLayoutData,
	replayHeldWidgetSettings
} from "./sessionLayoutData.svelte"
import {
	putWidgetSettings,
	setWidgetSettingsWriter
} from "$lib/client/stores/widgetSettings.svelte"

type Emit = { event: string; payload: any }
const cleanups: Array<() => void> = []
afterEach(() => {
	while (cleanups.length) cleanups.pop()!()
	setWidgetSettingsWriter(null)
})

function setup(isAdmin = true) {
	const emits: Emit[] = []
	const handlers = new Map<string, (res: any) => void>()
	let blob: Record<string, unknown> = { panels: ["old"] }
	const offered: string[][] = []
	const surfaceManager = {
		init: (_id: number, panels: Array<{ id: string }>) => {
			offered.push(panels.map((p) => p.id))
		},
		toBlob: () => blob,
		cancelPendingSave: () => false,
		persistNow: () => {},
		noteCopyLanded: () => {},
		destroy: () => {},
		instances: [],
		announceRecordedEvent: () => {},
		arrangement: {}
	}
	const out: { api?: ReturnType<typeof createSessionLayoutData> } = {}
	const target = document.createElement("div")
	const app = mount(Harness, {
		target,
		props: {
			out,
			deps: {
				socket: {
					emit: (event: string, payload: unknown) =>
						emits.push({ event, payload })
				} as any,
				inbox: {
					on: (e: string, h: (res: any) => void) =>
						void handlers.set(e, h)
				} as any,
				sessionId: () => 7,
				isAdmin: () => isAdmin,
				surfaceManager: surfaceManager as any,
				data: {
					sessionFrames: undefined,
					genreName: "",
					sessionGenreId: () => "g"
				} as any
			}
		}
	})
	const api = out.api!
	const stop = () => void unmount(app)
	cleanups.push(stop)
	flushSync()
	// The first open's layout, so the page holds settings to start from.
	handlers.get("sessions:panelLayout:get")!({
		sessionId: 7,
		layout: blob,
		presets: [],
		widgetSettings: { a: { x: 1, y: 2 } }
	})
	flushSync()
	const sets = () =>
		emits.filter((e) => e.event === "sessions:panelLayout:set")
	const answerCopy = () => {
		blob = { panels: ["new"] }
		handlers.get("sessions:panelLayout:startFrom")!({
			sessionId: 7,
			ok: true,
			layout: blob,
			presets: [],
			widgetSettings: { a: { x: 10, y: 20 }, b: { z: 1 } }
		})
		flushSync()
	}
	return { api, emits, handlers, sets, answerCopy, offered }
}

describe("the tray offers admin-only widgets to admins only", () => {
	for (const [isAdmin, has] of [[true, true], [false, false]] as const)
		test(`isAdmin ${isAdmin}: session-runs ${has ? "is" : "is not"} offered`, () => {
			const t = setup(isAdmin)
			t.handlers.get("sessions:view")!({ sessionId: 7 })
			flushSync()
			expect(t.offered).toHaveLength(1)
			expect(t.offered[0]!.includes("session-runs")).toBe(has)
		})
})

describe("settings writes during a pending layout copy", () => {
	test("no copy pending: a write is sent at once with the current blob", () => {
		const t = setup()
		putWidgetSettings("a", { x: 5 })
		expect(t.sets()).toHaveLength(1)
		expect(t.sets()[0]!.payload).toEqual({
			sessionId: 7,
			layout: { panels: ["old"] },
			widgetSettings: { a: { x: 5 } }
		})
	})

	test("pending, then landed: one write with the new blob and the copy's values under the held change", () => {
		const t = setup()
		void t.api.startLayoutFrom(3)
		putWidgetSettings("a", { x: 5, y: 2 })
		expect(t.sets()).toHaveLength(0)
		t.answerCopy()
		expect(t.sets()).toHaveLength(1)
		expect(t.sets()[0]!.payload).toEqual({
			sessionId: 7,
			layout: { panels: ["new"] },
			widgetSettings: { a: { x: 5, y: 20 }, b: { z: 1 } }
		})
	})

	test("pending, then refused (ok false, and the :error twin): one write with the held values", () => {
		for (const refuse of ["ok", "error"] as const) {
			const t = setup()
			void t.api.startLayoutFrom(3)
			putWidgetSettings("a", { x: 5 })
			putWidgetSettings("a", { x: 6 })
			expect(t.sets()).toHaveLength(0)
			if (refuse === "ok")
				t.handlers.get("sessions:panelLayout:startFrom")!({
					sessionId: 7,
					ok: false,
					error: "no"
				})
			else t.handlers.get("sessions:panelLayout:startFrom:error")!({})
			flushSync()
			expect(t.sets()).toHaveLength(1)
			expect(t.sets()[0]!.payload).toEqual({
				sessionId: 7,
				layout: { panels: ["old"] },
				widgetSettings: { a: { x: 6 } }
			})
			cleanups.pop()!()
		}
	})

	test("pending, a write that changes nothing against base: nothing is sent after the landing", () => {
		const t = setup()
		void t.api.startLayoutFrom(3)
		putWidgetSettings("a", { x: 1, y: 2 })
		t.answerCopy()
		expect(t.sets()).toHaveLength(0)
	})
})

describe("replayHeldWidgetSettings", () => {
	test("sets a changed key, removes a dropped key, drops an emptied widget, keeps the rest", () => {
		const base = { a: { x: 1, y: 2 }, c: { q: 1 }, d: { k: 1 } }
		const next = { a: { x: 5, y: 2 }, c: {}, d: { k: 1 } }
		const landed = {
			a: { x: 10, y: 20 },
			c: { q: 9 },
			d: { k: 7 },
			e: { m: 1 }
		}
		expect(replayHeldWidgetSettings(base, next, landed)).toEqual({
			a: { x: 5, y: 20 },
			d: { k: 7 },
			e: { m: 1 }
		})
	})

	test("a widget added during the hold is set; a widget removed whole removes its keys", () => {
		const out = replayHeldWidgetSettings(
			{ a: { x: 1 } },
			{ n: { v: [1] } },
			{ a: { x: 3 }, b: { y: 1 } }
		)
		expect(out).toEqual({ n: { v: [1] }, b: { y: 1 } })
	})

	test("startLayoutFrom emits clearPlacedWidgets only when asked", () => {
		const t = setup()
		const startFroms = () =>
			t.emits.filter((e) => e.event === "sessions:panelLayout:startFrom")
		void t.api.startLayoutFrom(3, { clearPlacedWidgets: true })
		expect(startFroms()[0]!.payload).toEqual({
			sessionId: 7,
			layoutPresetId: 3,
			clearPlacedWidgets: true
		})
		void t.api.startLayoutFrom(4)
		expect(startFroms()[1]!.payload).toEqual({ sessionId: 7, layoutPresetId: 4 })
		expect("clearPlacedWidgets" in (startFroms()[1]!.payload as object)).toBe(false)
	})
})
