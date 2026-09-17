/**
 * The per-message half of the verb gate (U5c). The action list says which
 * verbs the session offers and who may act; this pins what one message's
 * state permits, so the quick row and the ⋮ menu — both readers of this
 * table — agree by construction.
 */
import { describe, expect, it } from "vitest"
import {
	coreVerbState,
	quickRowActions,
	verbKeyOf,
	type RowAction,
	type VerbContext
} from "./messageVerbState"

const ctx = (over: Partial<VerbContext> = {}): VerbContext => ({
	msg: { characterId: 7, content: "hello" },
	isLastMessage: true,
	canRegenerateLastMessage: true,
	editing: false,
	hasGeneratingMessage: false,
	canControl: true,
	canSwipe: true,
	canAct: true,
	...over
})

describe("core verbs on a message", () => {
	it("stop shows only on the message that is generating", () => {
		expect(coreVerbState("stop", ctx())).toEqual({ shown: false, disabled: false })
		expect(
			coreVerbState("stop", ctx({ msg: { characterId: 7, isGenerating: true } }))
		).toEqual({ shown: true, disabled: false })
	})

	it("retry and continue belong to the newest reply, and continue carries its refusal", () => {
		expect(coreVerbState("retry", ctx())).toEqual({ shown: true, disabled: false })
		expect(coreVerbState("retry", ctx({ isLastMessage: false })).shown).toBe(false)
		expect(coreVerbState("retry", ctx({ msg: { personaId: 1 } as any })).shown).toBe(false)
		expect(coreVerbState("retry", ctx({ canControl: false })).disabled).toBe(true)
		expect(coreVerbState("continue", ctx({ msg: { characterId: 7, content: "" } })).shown).toBe(false)
		expect(coreVerbState("continue", ctx({ continueRefusal: "No prefill." }))).toEqual({
			shown: true,
			disabled: true,
			reason: "No prefill."
		})
	})

	it("edit is on every message, off while busy, hidden or not yours", () => {
		expect(coreVerbState("edit", ctx({ msg: { personaId: 3 } as any }))).toEqual({
			shown: true,
			disabled: false
		})
		expect(coreVerbState("edit", ctx({ hasGeneratingMessage: true })).disabled).toBe(true)
		expect(coreVerbState("edit", ctx({ msg: { characterId: 7, isHidden: true } })).disabled).toBe(true)
		expect(coreVerbState("edit", ctx({ canControl: false })).disabled).toBe(true)
	})

	it("branch reads the audience, not the item rule", () => {
		expect(coreVerbState("branch", ctx({ canControl: false })).disabled).toBe(false)
		expect(coreVerbState("branch", ctx({ canAct: false })).disabled).toBe(true)
	})

	it("swipe, hide and delete follow the item rule; swipe needs a swipe to take", () => {
		expect(coreVerbState("swipe", ctx())).toEqual({ shown: true, disabled: false })
		expect(coreVerbState("swipe", ctx({ canSwipe: false })).disabled).toBe(true)
		expect(coreVerbState("hide", ctx({ canControl: false })).disabled).toBe(true)
		expect(coreVerbState("delete", ctx({ editing: true })).disabled).toBe(true)
	})

	it("a contributed action gets the generic answer: shown unless generating, disabled while busy or by the audience", () => {
		expect(coreVerbState("acme-roll", ctx())).toEqual({ shown: true, disabled: false })
		expect(coreVerbState("acme-roll", ctx({ canAct: false })).disabled).toBe(true)
		expect(coreVerbState("acme-roll", ctx({ msg: { characterId: 7, isGenerating: true } })).shown).toBe(false)
	})

	it("an item-gated contributed action defers to the message's ownership rule, not only the audience (W6)", () => {
		// The list answers `canAct: true` for `act: ['item']` ahead of any
		// message; on a message a guest does not own, that is a no. Without
		// the gate a guest saw the plugin's per-message action enabled and
		// got a refusal on press.
		expect(
			coreVerbState("contributed:acme-rewrite", ctx({ itemGated: true, canControl: false })).disabled
		).toBe(true)
		expect(
			coreVerbState("contributed:acme-rewrite", ctx({ itemGated: true, canControl: true })).disabled
		).toBe(false)
		// One that is not item-gated ignores the ownership rule — its
		// audience already answered.
		expect(
			coreVerbState("contributed:acme-roll", ctx({ itemGated: false, canControl: false })).disabled
		).toBe(false)
	})
})

describe("why a verb is grey (UI nit 2)", () => {
	it("every disabled answer carries a reason, in the chips' vocabulary", () => {
		expect(coreVerbState("edit", ctx({ canControl: false })).reason).toBe("not yours to change")
		expect(coreVerbState("edit", ctx({ hasGeneratingMessage: true })).reason).toBe(
			"wait for the reply to finish"
		)
		expect(coreVerbState("edit", ctx({ editing: true })).reason).toBe("finish the edit first")
		expect(coreVerbState("edit", ctx({ msg: { characterId: 7, isHidden: true } })).reason).toBe(
			"unhide it first"
		)
		expect(coreVerbState("retry", ctx({ canRegenerateLastMessage: false })).reason).toBe(
			"only the newest reply can be regenerated"
		)
		expect(coreVerbState("swipe", ctx({ canSwipe: false })).reason).toBe("nothing to swipe to")
		expect(coreVerbState("branch", ctx({ canAct: false })).reason).toBe("not yours to use here")
		expect(coreVerbState("delete", ctx({ canControl: false })).reason).toBe("not yours to change")
		expect(coreVerbState("contributed:acme-roll", ctx({ canAct: false })).reason).toBe(
			"not yours to use here"
		)
		expect(
			coreVerbState("contributed:acme-rewrite", ctx({ itemGated: true, canControl: false })).reason
		).toBe("not yours to use here")
		// Continue's own sentence names the switch; the ownership rule still wins.
		expect(coreVerbState("continue", ctx({ continueRefusal: "No prefill." })).reason).toBe(
			"No prefill."
		)
		expect(
			coreVerbState("continue", ctx({ continueRefusal: "No prefill.", canControl: false })).reason
		).toBe("not yours to change")
	})

	it("the ownership rule's sentence wins over a busy state — a grey control does not change its reason because something else is busy", () => {
		expect(
			coreVerbState("edit", ctx({ canControl: false, hasGeneratingMessage: true })).reason
		).toBe("not yours to change")
		expect(coreVerbState("branch", ctx({ canAct: false, editing: true })).reason).toBe(
			"not yours to use here"
		)
	})

	it("an enabled verb carries none", () => {
		for (const key of ["edit", "retry", "continue", "branch", "swipe", "hide", "delete"])
			expect(coreVerbState(key, ctx()).reason, key).toBeUndefined()
	})
})

describe("the quick row", () => {
	const row = (over: Partial<RowAction> & { key: string }): RowAction => ({
		specSlug: "core",
		canAct: true,
		itemGated: true,
		...over
	})
	const rowCtx = (over: Partial<VerbContext> = {}) => {
		const { canAct: _a, itemGated: _i, ...rest } = ctx(over)
		return rest
	}

	it("draws the primary set, core's and a plugin's alike, minus stop (S8)", () => {
		const primary = [
			row({ key: "stop" }),
			row({ key: "edit" }),
			row({ key: "retry" }),
			row({ key: "rewrite", specSlug: "acme:spec/rewrite", itemGated: false })
		]
		expect(quickRowActions(primary, rowCtx()).map((q) => q.action.key)).toEqual([
			"edit",
			"retry",
			"rewrite"
		])
	})

	it("hides what the menu would disable — the audience, the ownership rule, the message's state", () => {
		const primary = [
			row({ key: "edit" }),
			row({ key: "retry" }),
			row({ key: "rewrite", specSlug: "acme:spec/rewrite", itemGated: false, canAct: false }),
			row({ key: "annotate", specSlug: "acme:spec/annotate", itemGated: true })
		]
		// A guest on somebody else's message: edit and retry follow the item
		// rule, `annotate` is item-gated, `rewrite` is greyed by its audience.
		expect(quickRowActions(primary, rowCtx({ canControl: false }))).toEqual([])
		// The owner: all but the greyed one.
		expect(quickRowActions(primary, rowCtx()).map((q) => q.action.key)).toEqual([
			"edit",
			"retry",
			"annotate"
		])
		// Nothing while a reply streams (the page sets both).
		expect(
			quickRowActions(
				primary,
				rowCtx({ msg: { characterId: 7, isGenerating: true }, hasGeneratingMessage: true })
			)
		).toEqual([])
	})

	it("keys the verb table by core key or a contributed prefix — never a plugin's key as core's", () => {
		expect(verbKeyOf({ key: "edit", specSlug: "core" })).toBe("edit")
		expect(verbKeyOf({ key: "edit", specSlug: "acme:spec/x" })).toBe("contributed:edit")
	})
})
