/**
 * A frame's leave to change state (U5c review, S-C; fourth pass W4). The
 * component owns the listeners and the live `navigator`/`document` reads;
 * the rule is pinned here on the pure half — see docs/session-layout.md
 * "Actions for widgets".
 */
import { describe, expect, it } from "vitest"
import {
	CONFIRMED_FRAME_VERBS,
	FRAME_ACTIVATION_WINDOW_MS,
	frameInvokeVerdict,
	hasRecentActivation,
	needsActivation,
	needsConfirmation,
	STATE_CHANGING_CORE_VERBS
} from "./frameActivation"

const NOW = 1_000_000

describe("which verbs need a person behind them", () => {
	it("the six that change a message and the turn controls that start a turn; not stop, not branch, not a contributed action", () => {
		expect([...STATE_CHANGING_CORE_VERBS].sort()).toEqual(
			["advance", "delete", "edit", "extend", "hide", "narrate", "pick", "retry", "swipe"].sort()
		)
		for (const key of STATE_CHANGING_CORE_VERBS) expect(needsActivation(key)).toBe(true)
		expect(needsActivation("stop")).toBe(false)
		expect(needsActivation("branch")).toBe(false)
	})

	it("retry, extend, advance and narrate are confirm-gated from a frame (all spend tokens); delete and pick are not listed here because the host's modal already asks", () => {
		expect([...CONFIRMED_FRAME_VERBS].sort()).toEqual(["advance", "extend", "narrate", "retry"])
		expect(needsConfirmation("narrate")).toBe(true)
		expect(needsConfirmation("pick")).toBe(false)
		expect(needsConfirmation("advance")).toBe(true)
		expect(needsConfirmation("retry")).toBe(true)
		expect(needsConfirmation("extend")).toBe(true)
		expect(needsConfirmation("delete")).toBe(false)
		expect(needsConfirmation("hide")).toBe(false)
	})
})

describe("the fixed-window fallback (no `live` given, or the browser has no userActivation)", () => {
	it("is focus having entered the frame within the window, and nothing else", () => {
		expect(hasRecentActivation({ lastInteractionAt: null }, NOW)).toBe(false)
		expect(hasRecentActivation({ lastInteractionAt: NOW - 1_000 }, NOW)).toBe(true)
		expect(
			hasRecentActivation({ lastInteractionAt: NOW - FRAME_ACTIVATION_WINDOW_MS }, NOW)
		).toBe(true)
		expect(
			hasRecentActivation({ lastInteractionAt: NOW - FRAME_ACTIVATION_WINDOW_MS - 1 }, NOW)
		).toBe(false)
		// A clock that went backwards vouches for nothing.
		expect(hasRecentActivation({ lastInteractionAt: NOW + 10 }, NOW)).toBe(false)
	})

	it("resets when focus leaves: an entry the component cleared is null, and null is a refusal however recent the entry was", () => {
		// The component sets the entry on focus-in and nulls it on focus-out;
		// the pure half sees only the result, so "fresh entry, then left" is
		// exactly `null` — there is no residual window after leaving.
		const entered = { lastInteractionAt: NOW - 100 }
		expect(hasRecentActivation(entered, NOW)).toBe(true)
		const leftAgain = { ...entered, lastInteractionAt: null }
		expect(hasRecentActivation(leftAgain, NOW)).toBe(false)
		expect(
			frameInvokeVerdict({ specSlug: "core", key: "hide" }, leftAgain, NOW).allowed
		).toBe(false)
	})

	it("a `live` whose userActivationActive is undefined is the same as no `live` at all", () => {
		const fresh = { lastInteractionAt: NOW - 100 }
		const live = { userActivationActive: undefined, frameIsActiveElement: false }
		expect(hasRecentActivation(fresh, NOW, live)).toBe(true)
		expect(hasRecentActivation({ lastInteractionAt: null }, NOW, live)).toBe(false)
	})
})

describe("the live check (W4): userActivation active AND the frame is the current focus", () => {
	it("wins over the fixed window in both directions — a stale window with live activation is admitted, a fresh window with none is refused", () => {
		const stale: { lastInteractionAt: number | null } = { lastInteractionAt: NOW - 60_000 }
		const fresh: { lastInteractionAt: number | null } = { lastInteractionAt: NOW - 100 }
		expect(
			hasRecentActivation(stale, NOW, {
				userActivationActive: true,
				frameIsActiveElement: true
			})
		).toBe(true)
		expect(
			hasRecentActivation(fresh, NOW, {
				userActivationActive: false,
				frameIsActiveElement: true
			})
		).toBe(false)
	})

	it("a click elsewhere on the page still vouches for nothing: userActivation alone, without the frame holding focus, is not enough (W3's complaint, honoured under W4)", () => {
		const state = { lastInteractionAt: null }
		expect(
			hasRecentActivation(state, NOW, {
				userActivationActive: true,
				frameIsActiveElement: false
			})
		).toBe(false)
		const v = frameInvokeVerdict({ specSlug: "core", key: "edit" }, state, NOW, {
			userActivationActive: true,
			frameIsActiveElement: false
		})
		expect(v.allowed).toBe(false)
	})

	it("both together admit the invoke even with no fixed-window history at all", () => {
		const v = frameInvokeVerdict({ specSlug: "core", key: "edit" }, { lastInteractionAt: null }, NOW, {
			userActivationActive: true,
			frameIsActiveElement: true
		})
		expect(v.allowed).toBe(true)
	})
})

describe("the verdict on a frame's invoke", () => {
	const stale = { lastInteractionAt: NOW - 60_000 }
	const fresh = { lastInteractionAt: NOW - 100 }

	it("refuses a state-changing core verb with no recent activation, with a sentence", () => {
		const v = frameInvokeVerdict({ specSlug: "core", key: "delete" }, stale, NOW)
		expect(v.allowed).toBe(false)
		if (!v.allowed) expect(v.reason).toMatch(/core#delete.*needs a person behind it/)
	})

	it("admits it on a recent activation, with no question for a verb the host confirms itself", () => {
		expect(frameInvokeVerdict({ specSlug: "core", key: "delete" }, fresh, NOW)).toEqual({
			allowed: true
		})
		expect(frameInvokeVerdict({ specSlug: "core", key: "edit" }, fresh, NOW)).toEqual({
			allowed: true
		})
	})

	it("admits retry on a recent activation only with a question to put to the person first", () => {
		const v = frameInvokeVerdict({ specSlug: "core", key: "retry" }, fresh, NOW)
		expect(v.allowed).toBe(true)
		if (v.allowed) expect(v.confirm).toMatch(/spends tokens/)
		// And never without the activation — the question is not a substitute.
		expect(frameInvokeVerdict({ specSlug: "core", key: "retry" }, stale, NOW).allowed).toBe(
			false
		)
	})

	it("admits extend on a recent activation only with a question to put to the person first", () => {
		const v = frameInvokeVerdict({ specSlug: "core", key: "extend" }, fresh, NOW)
		expect(v.allowed).toBe(true)
		if (v.allowed) expect(v.confirm).toMatch(/spends tokens/)
		expect(
			frameInvokeVerdict({ specSlug: "core", key: "extend" }, stale, NOW).allowed
		).toBe(false)
	})

	it("never gates stop, branch, or a contributed action — those are not its to judge", () => {
		expect(frameInvokeVerdict({ specSlug: "core", key: "stop" }, stale, NOW)).toEqual({ allowed: true })
		expect(frameInvokeVerdict({ specSlug: "core", key: "branch" }, stale, NOW)).toEqual({
			allowed: true
		})
		expect(frameInvokeVerdict({ specSlug: "acme:spec/roll", key: "delete" }, stale, NOW)).toEqual({
			allowed: true
		})
		// A contributed action named `retry` is the server's to judge, not confirmed here.
		expect(frameInvokeVerdict({ specSlug: "acme:spec/roll", key: "retry" }, stale, NOW)).toEqual({
			allowed: true
		})
	})
})
