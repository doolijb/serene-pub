/**
 * 🚧 A guest's page offers **Add your persona** and **Take a seat** only
 * while the owner lets guests bring their own characters (G3); the owner is
 * never frozen.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		error: () => {},
		success: () => {},
		info: () => {},
		warning: () => {}
	}
}))

import { sessionStore } from "$lib/client/sessions/store/sessionStore.svelte"
import { createSessionPageData } from "./sessionPageData.svelte"
import Harness from "./sessionStoryTimelineHarness.test.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

function open(viewerId: number, metadata: Record<string, unknown>) {
	const handlers = new Map<string, (msg: any) => void>()
	const out: { api?: ReturnType<typeof createSessionPageData> } = {}
	sessionStore.open(1)
	sessionStore.load(
		{
			id: 1,
			userId: 1,
			name: "S",
			metadata,
			rewind: { ahead: 0, back: null, forward: null, regenerate: null },
			sessionMessages: [],
			sessionCharacters: [],
			sessionPersonas: [],
			sessionGuests: [{ userId: 2, isPlayer: true }]
		} as any,
		{ hasMore: false, olderIn: [] } as any
	)
	const deps = {
		socket: { emit() {}, on() {}, off() {}, connected: true } as never,
		inbox: { on: (e: string, h: any) => handlers.set(e, h) } as never,
		sessionId: () => 1,
		loadedSessionId: () => 1,
		userCtx: { user: { id: viewerId, isAdmin: false } } as never,
		widgets: {} as never,
		draft: () => "",
		writeDraft: () => {}
	}
	app = mount(Harness, { target: document.body, props: { deps, out } })
	// The genre of player seats offers **Take a seat**; none offers **Add your persona**.
	return {
		data: out.api!,
		withPlayerLabel() {
			handlers.get("sessions:view")!({
				sessionId: 1,
				genrePlayerLabel: "Dungeon Master"
			})
			flushSync()
		}
	}
}

describe("a guest's page offers a seat only while bring-your-own is on", () => {
	test("Add your persona: shown on, absent off", () => {
		expect(open(2, {}).data.showAddPersonaCTA).toBe(true)
		unmount(app!)
		expect(open(2, { guestsBringOwn: false }).data.showAddPersonaCTA).toBe(
			false
		)
	})

	test("Take a seat: shown on, absent off", () => {
		const on = open(2, {})
		on.withPlayerLabel()
		expect(on.data.showTakeSeatCTA).toBe(true)
		unmount(app!)
		const off = open(2, { guestsBringOwn: false })
		off.withPlayerLabel()
		expect(off.data.showTakeSeatCTA).toBe(false)
	})

	test("the owner is never offered either, whatever the switch says", () => {
		const o = open(1, { guestsBringOwn: false })
		o.withPlayerLabel()
		expect(o.data.showAddPersonaCTA).toBe(false)
		expect(o.data.showTakeSeatCTA).toBe(false)
	})

	test("the take-cast switch changes neither offer", () => {
		const d = open(2, { guestsTakeCast: false })
		expect(d.data.showAddPersonaCTA).toBe(true)
		d.withPlayerLabel()
		expect(d.data.showTakeSeatCTA).toBe(true)
	})
})
