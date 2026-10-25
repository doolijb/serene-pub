/**
 * The session-outcomes context says two results once: Share with nothing waiting, and Close out started.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

const { listeners, toasts } = vi.hoisted(() => ({
	listeners: new Map<string, (msg: any) => void>(),
	toasts: [] as Array<{ kind: string; title: string; description?: string }>
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	useInterest: (key: string, handler: (msg: any) => void) =>
		listeners.set(key, handler)
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		info: (t: any) => toasts.push({ kind: "info", ...t }),
		success: (t: any) => toasts.push({ kind: "success", ...t }),
		warning: (t: any) => toasts.push({ kind: "warning", ...t }),
		error: (t: any) => toasts.push({ kind: "error", ...t })
	}
}))

import { createSessionOutcomes } from "./sessionOutcomes.svelte"

const fire = (event: string, msg: unknown) => listeners.get(event)!(msg)

beforeEach(() => {
	listeners.clear()
	toasts.length = 0
	createSessionOutcomes()
})

describe("session outcomes", () => {
	test("Share with nothing waiting says so, once", () => {
		fire("sessions:applyOverlay", { applied: [] })
		expect(toasts).toHaveLength(1)
		expect(toasts[0]).toMatchObject({
			kind: "info",
			title: "Nothing to share",
			description: "This session's notes hold no changes waiting for the lorebook."
		})
	})

	test("Share that applied something, or was refused, says nothing", () => {
		fire("sessions:applyOverlay", { applied: [3] })
		fire("sessions:applyOverlay", { applied: [], error: "no" })
		expect(toasts).toEqual([])
	})

	test("Close out names one closing scene", () => {
		fire("sessions:closeOut", { sceneIds: [5] })
		expect(toasts[0]).toMatchObject({
			kind: "success",
			title: "Closed out",
			description: "One closing scene is being summarized for you to review."
		})
	})

	test("Close out names several", () => {
		fire("sessions:closeOut", { sceneIds: [5, 6] })
		expect(toasts[0].description).toBe(
			"2 closing scenes are being summarized for you to review."
		)
	})

	test("Close out with no scenes, or refused, says nothing", () => {
		fire("sessions:closeOut", { sceneIds: [] })
		fire("sessions:closeOut", { sceneIds: [1], error: "no" })
		expect(toasts).toEqual([])
	})
})
