/**
 * 🚧 A refused rerun (2026-10-16): the server's sentence on a swipe, retry or
 * extend of a question row is toasted once, in the tab that pressed, and the
 * row stops being rerunnable — so its swipe row and retry leave.
 */
import { describe, expect, it, vi } from "vitest"
import { flushSync } from "svelte"

const errors: unknown[] = []
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: (t: unknown) => errors.push(t), success: vi.fn(), info: vi.fn() }
}))

import { createRerunRefusals, rowAsks } from "./rerunRefusals.svelte"

function harness() {
	const listeners = new Map<string, Set<(m: any) => void>>()
	const inbox = {
		on(event: string, l: (m: any) => void) {
			if (!listeners.has(event)) listeners.set(event, new Set())
			listeners.get(event)!.add(l)
			return () => listeners.get(event)!.delete(l)
		}
	}
	let refusals!: ReturnType<typeof createRerunRefusals>
	const stop = $effect.root(() => {
		refusals = createRerunRefusals(inbox as any)
	})
	const deliver = (event: string, msg: unknown) => {
		for (const l of listeners.get(event) ?? []) l(msg)
		flushSync()
	}
	return { refusals: () => refusals, deliver, stop }
}

const QUESTION = "This message is a question, not a reply — there is nothing to generate again. Answer it to go on."

describe("rerun refusals", () => {
	it("a refused swipe toasts its sentence once and the row stops being rerunnable", () => {
		errors.length = 0
		const h = harness()
		h.refusals().asked("sessionMessages:swipeRight", 41)
		h.deliver("sessionMessages:swipeRight", { error: QUESTION })
		expect(errors).toEqual([{ title: QUESTION }])
		expect(h.refusals().isRefused(41)).toBe(true)
		expect(h.refusals().key).toBe("41")
		h.stop()
	})

	it("another tab's refusal (nothing pressed here) says nothing", () => {
		errors.length = 0
		const h = harness()
		h.deliver("sessionMessages:regenerate", { error: QUESTION })
		expect(errors).toEqual([])
		h.stop()
	})

	it("an answered rerun marks nothing", () => {
		errors.length = 0
		const h = harness()
		h.refusals().asked("sessionMessages:regenerate", 9)
		h.deliver("sessionMessages:regenerate", { sessionMessage: { id: 9 } })
		expect(errors).toEqual([])
		expect(h.refusals().isRefused(9)).toBe(false)
		h.stop()
	})
})

describe("rowAsks", () => {
	it("finds a form block, nested or not", () => {
		expect(rowAsks({ parts: [{ data: { blocks: [{ kind: "text" }] } }] })).toBe(false)
		expect(rowAsks({ parts: [{ data: { blocks: [{ kind: "group", blocks: [{ kind: "form" }] }] } }] })).toBe(true)
		expect(rowAsks({})).toBe(false)
	})
})
