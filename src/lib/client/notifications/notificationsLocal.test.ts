import { beforeEach, describe, expect, test, vi } from "vitest"

const emit = vi.hoisted(() => vi.fn())
let listener: ((d: any) => void) | null = null

vi.mock("$lib/client/sockets/typedSocket", () => ({
	typedSocketOrNull: () => ({ emit })
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (_e: string, fn: (d: any) => void) => {
		listener = fn
		return () => {}
	},
	requestWithInterest: () => () => {}
}))

import { notifications } from "./notifications.svelte"

const input = (regarding = "session:1/widget:core:a") => ({
	kind: "core:notification/widget-notice@1",
	regarding,
	level: "info" as const,
	href: "/sessions/1",
	vars: { text: "Hi", session: "this session" }
})

beforeEach(() => emit.mockClear())

describe("local rows", () => {
	test("raise adds an open row with a negative id; same regarding bumps", () => {
		notifications.raiseLocal(input())
		const row = notifications.open.find((r) => r.id < 0)!
		expect(row).toBeTruthy()
		notifications.raiseLocal({ ...input(), vars: { text: "Again", session: "x" } })
		const locals = notifications.open.filter((r) => r.id < 0)
		expect(locals).toHaveLength(1)
		expect(locals[0].id).toBe(row.id)
		expect(locals[0].vars.text).toBe("Again")
		notifications.dismiss(locals.map((r) => r.id))
	})

	test("read sets readAt without emitting; dismiss moves to cleared", () => {
		notifications.raiseLocal(input("session:2/widget:core:b"))
		const id = notifications.open.find((r) => r.regarding.startsWith("session:2"))!.id
		notifications.read([id])
		expect(emit).not.toHaveBeenCalled()
		expect(notifications.open.find((r) => r.id === id)!.readAt).toBeTruthy()
		notifications.dismiss([id])
		expect(emit).not.toHaveBeenCalled()
		expect(notifications.open.some((r) => r.id === id)).toBe(false)
		expect(notifications.cleared.find((r) => r.id === id)!.clearedHow).toBe("dismissed")
	})

	test("a server apply keeps local rows", () => {
		const release = notifications.connect()
		notifications.raiseLocal(input("session:3/widget:core:c"))
		listener!({ open: [], cleared: [] })
		expect(notifications.open.some((r) => r.regarding.startsWith("session:3"))).toBe(true)
		release()
	})
})
