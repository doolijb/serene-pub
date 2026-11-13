/**
 * The characters-rows context is the one subscriber to the page events: a page
 * reply shows no toast, an out-of-date cursor shows none, any other refusal is
 * one toast however many views listen, and every registered view hears the
 * reply until it releases.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

const { listeners, toasts } = vi.hoisted(() => ({
	listeners: new Map<string, (msg: any) => void>(),
	toasts: [] as Array<{ kind: string; title: string }>
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	useInterest: (key: string, handler: (msg: any) => void) =>
		listeners.set(key, handler)
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		success: (t: any) => toasts.push({ kind: "success", ...t }),
		warning: (t: any) => toasts.push({ kind: "warning", ...t }),
		error: (t: any) => toasts.push({ kind: "error", ...t })
	}
}))

import { createCharacterRows } from "./characterRows.svelte"
import { CHARACTER_ROWS_STALE_CURSOR } from "$lib/shared/characters/characterRows"

const fire = (event: string, msg: unknown) => listeners.get(event)!(msg)
const make = () => {
	let ctx!: ReturnType<typeof createCharacterRows>
	const cleanup = $effect.root(() => {
		ctx = createCharacterRows()
	})
	return { ctx, cleanup }
}

beforeEach(() => {
	listeners.clear()
	toasts.length = 0
})

describe("characters-rows context", () => {
	test("a page reaches every listener and toasts nothing", () => {
		const { ctx, cleanup } = make()
		const heardBy: string[] = []
		ctx.addPageListener(() => heardBy.push("a"))
		ctx.addPageListener(() => heardBy.push("b"))
		fire("characters:page", { rows: [], nextCursor: null, requestId: "r1" })
		expect(heardBy).toEqual(["a", "b"])
		expect(toasts).toHaveLength(0)
		cleanup()
	})

	test("a stale cursor toasts nothing and reaches the failed-listeners", () => {
		const { ctx, cleanup } = make()
		let heard = 0
		ctx.addPageFailedListener(() => heard++)
		fire("characters:page:error", {
			error: CHARACTER_ROWS_STALE_CURSOR,
			requestId: "r1"
		})
		expect(toasts).toHaveLength(0)
		expect(heard).toBe(1)
		cleanup()
	})

	test("any other refusal is one toast, however many listeners", () => {
		const { ctx, cleanup } = make()
		let heard = 0
		ctx.addPageFailedListener(() => heard++)
		ctx.addPageFailedListener(() => heard++)
		fire("characters:page:error", {
			error: "Database down",
			requestId: "r1"
		})
		expect(toasts.map((t) => [t.kind, t.title])).toEqual([
			["error", "Database down"]
		])
		expect(heard).toBe(2)
		cleanup()
	})

	test("a released listener hears nothing more", () => {
		const { ctx, cleanup } = make()
		let heard = 0
		const release = ctx.addPageListener(() => heard++)
		fire("characters:page", { rows: [], nextCursor: null, requestId: "r1" })
		release()
		fire("characters:page", { rows: [], nextCursor: null, requestId: "r2" })
		expect(heard).toBe(1)
		cleanup()
	})
})
