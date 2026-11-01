import { afterEach, describe, expect, it, vi } from "vitest"
import {
	createProgressThrottle,
	createUserEmitters,
	PROGRESS_EMIT_THROTTLE_MS,
	type UserEmitterSlot
} from "./emitters"

describe("createUserEmitters", () => {
	it("refcounts connections per user: one slot, one call per emit", () => {
		const e = createUserEmitters<number>()
		const a = vi.fn()
		const b = vi.fn()
		e.register(1, a)
		e.register(1, b)
		expect(e.size).toBe(1)
		e.emit(7)
		expect(a).toHaveBeenCalledTimes(1)
		expect(a).toHaveBeenCalledWith(7)
		expect(b).not.toHaveBeenCalled()
	})

	it("drops the slot only when the last connection unregisters", () => {
		const e = createUserEmitters<number>()
		const a = vi.fn()
		e.register(1, a)
		e.register(1, a)
		e.unregister(1)
		e.emit(1)
		expect(a).toHaveBeenCalledTimes(1)
		e.unregister(1)
		expect(e.size).toBe(0)
		e.emit(2)
		expect(a).toHaveBeenCalledTimes(1)
		e.unregister(1)
		expect(e.size).toBe(0)
	})

	it("reaches every user", () => {
		const e = createUserEmitters<string>()
		const a = vi.fn()
		const b = vi.fn()
		e.register(1, a)
		e.register(2, b)
		e.emit("x")
		expect(a).toHaveBeenCalledWith("x")
		expect(b).toHaveBeenCalledWith("x")
	})

	it("a throwing emitter does not stop the others", () => {
		const e = createUserEmitters<string>()
		const b = vi.fn()
		e.register(1, () => {
			throw new Error("boom")
		})
		e.register(2, b)
		expect(() => e.emit("x")).not.toThrow()
		expect(b).toHaveBeenCalledTimes(1)
	})

	it("uses a passed-in backing map as the store", () => {
		const backing = new Map<number, UserEmitterSlot<number>>()
		const e = createUserEmitters<number>(backing)
		const a = vi.fn()
		e.register(5, a)
		expect(backing.get(5)).toEqual({ emit: a, connections: 1 })
		e.unregister(5)
		expect(backing.size).toBe(0)
	})
})

describe("createProgressThrottle", () => {
	afterEach(() => vi.useRealTimers())

	it("emits at most once per interval", () => {
		vi.useFakeTimers()
		vi.setSystemTime(1_000_000)
		const t = createProgressThrottle()
		expect(PROGRESS_EMIT_THROTTLE_MS).toBe(250)
		expect(t.ready()).toBe(true)
		vi.advanceTimersByTime(249)
		expect(t.ready()).toBe(false)
		vi.advanceTimersByTime(1)
		expect(t.ready()).toBe(true)
	})

	it("keys are independent and forget resets one", () => {
		vi.useFakeTimers()
		vi.setSystemTime(1_000_000)
		const t = createProgressThrottle()
		expect(t.ready("a")).toBe(true)
		expect(t.ready("b")).toBe(true)
		expect(t.ready("a")).toBe(false)
		t.forget("a")
		expect(t.ready("a")).toBe(true)
		expect(t.ready("b")).toBe(false)
	})
})
