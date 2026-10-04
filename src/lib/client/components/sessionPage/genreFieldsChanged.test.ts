/**
 * The page hands `sessions:genreFieldsChanged` for its own session to its
 * widgets as `genreFields:changed` (2026-10-03) — so the Author's note reads
 * a note saved in Edit Session or another tab again; another session's push
 * does not reach them, and after the release nothing does.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({ getSocket: () => socket }))

import { _resetInterestForTests, setInterestUser } from "$lib/client/sockets/interest.svelte"
import { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import { hearGenreFieldsChanged } from "./genreFieldsChanged"

type Listener = (payload: unknown) => void
const listeners = new Map<string, Listener[]>()
const socket = {
	connected: true,
	on(event: string, fn: Listener) {
		listeners.set(event, [...(listeners.get(event) ?? []), fn])
	},
	off(event: string, fn: Listener) {
		listeners.set(event, (listeners.get(event) ?? []).filter((f) => f !== fn))
	},
	emit() {}
}
const push = (event: string, payload: unknown) => {
	for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
}

beforeEach(() => {
	listeners.clear()
	_resetInterestForTests()
	setInterestUser({ id: 1, isAdmin: false })
})

describe("hearGenreFieldsChanged", () => {
	test("this session's push reaches the widgets as genreFields:changed; another session's does not", () => {
		const manager = new SurfaceManager()
		const heard: unknown[] = []
		manager.subscribe((e) => heard.push(e))

		const release = hearGenreFieldsChanged(7, manager)
		push("sessions:genreFieldsChanged", { sessionId: 7, genreFields: { authorsNote: { text: "Rain." } } })
		push("sessions:genreFieldsChanged", { sessionId: 8, genreFields: {} })
		// Carries nothing: the value is the widget's request.
		expect(heard).toEqual([{ kind: "genreFields:changed" }])

		release()
		push("sessions:genreFieldsChanged", { sessionId: 7, genreFields: {} })
		expect(heard).toHaveLength(1)
	})
})
