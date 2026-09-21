/**
 * The per-message half of the verb gate (U5c; U5e). The action list says
 * which verbs the session offers, who may act, and the enabled-when verdict
 * over the session's published values; this pins how one message's own
 * `item` document is judged against the `item.*` predicates the list hands
 * over, so the quick row and the ⋮ menu — both readers of this table —
 * agree by construction, and agree with the door.
 *
 * The context is built the way the server builds the listing: each core
 * verb's `enabledWhen` (`CORE_ACTIONS`) split into the session half — judged
 * here against `session.generating`, as the server does at listing — and the
 * `item.*` half handed over as `itemPredicates`.
 */
import { describe, expect, it } from "vitest"
import {
	CORE_ACTIONS,
	evaluateEnabledWhen,
	partitionEnabledWhen
} from "@serene-pub/sdk"
import {
	coreVerbState,
	enabledWhenState,
	notYoursToUse,
	quickRowActions,
	verbKeyOf,
	verdictOf,
	VERB_REASONS,
	type RowAction,
	type VerbContext
} from "./messageVerbState"

/** The list's verdict for one core verb, as `listSessionActions` computes it — the wire's shape. */
const listedRow = (key: string, generating: boolean) => {
	const preds = CORE_ACTIONS.find((a) => a.key === key)?.enabledWhen ?? []
	const { under, rest } = partitionEnabledWhen(preds, "item")
	const v = evaluateEnabledWhen(rest, { session: { generating } })
	return {
		enabled: v.enabled,
		...(v.enabled ? {} : { reason: { i18n: v.reason } }),
		...(under.length ? { itemPredicates: under } : {})
	}
}
/** …and the same lifted onto the context, the reason a sentence (`verdictOf`). */
const listed = (key: string, generating: boolean) => {
	const {
		canAct: _a,
		itemGated: _i,
		...rest
	} = verdictOf({
		key,
		specSlug: "core",
		name: key,
		audience: { act: ["item"] },
		canAct: true,
		itemGated: true,
		...listedRow(key, generating)
	})
	return rest
}

/**
 * The audience's sentence a grey control carries — `core:verdict/audience`'s
 * own, as the fire refuses with it (01 §13). The chips' vocabulary quotes
 * it rather than keeping a fragment of its own.
 */
const notYours = (name: string, act: string[]) =>
	`'${name}' is not yours to use here — its audience is ${act.join(", ")}.`

const base = (over: Partial<VerbContext> = {}): VerbContext => ({
	msg: { id: 1, characterId: 7, content: "hello", role: "assistant" },
	isLastMessage: true,
	editing: false,
	hasGeneratingMessage: false,
	canControl: true,
	canAct: true,
	action: { name: "Roll", act: ["owner"] },
	...over
})

/** A context for one core verb, its verdict computed off the table like the server's. */
const ctx = (key: string, over: Partial<VerbContext> = {}): VerbContext => {
	const b = base(over)
	return { ...b, ...listed(key, b.hasGeneratingMessage), ...over }
}

const state = (key: string, over: Partial<VerbContext> = {}) =>
	coreVerbState(key, ctx(key, over))

describe("core verbs on a message", () => {
	it("stop shows only on the message that is generating", () => {
		expect(state("stop")).toEqual({ shown: false, disabled: false })
		expect(
			state("stop", { msg: { characterId: 7, isGenerating: true } })
		).toEqual({ shown: true, disabled: false })
	})

	it("retry and continue belong to the newest reply, and continue carries its refusal", () => {
		expect(state("retry")).toEqual({ shown: true, disabled: false })
		expect(state("retry", { isLastMessage: false }).shown).toBe(false)
		expect(state("retry", { msg: { personaId: 1 } as any }).shown).toBe(
			false
		)
		expect(state("retry", { canControl: false }).disabled).toBe(true)
		expect(
			state("continue", { msg: { characterId: 7, content: "" } }).shown
		).toBe(false)
		expect(state("continue", { continueRefusal: "No prefill." })).toEqual({
			shown: true,
			disabled: true,
			reason: "No prefill."
		})
	})

	it("edit is on every message, off while busy, hidden or not yours", () => {
		expect(state("edit", { msg: { personaId: 3 } as any })).toEqual({
			shown: true,
			disabled: false
		})
		expect(state("edit", { hasGeneratingMessage: true }).disabled).toBe(
			true
		)
		expect(
			state("edit", { msg: { characterId: 7, isHidden: true } }).disabled
		).toBe(true)
		expect(state("edit", { canControl: false }).disabled).toBe(true)
	})

	it("branch reads the audience, not the item rule", () => {
		expect(state("branch", { canControl: false }).disabled).toBe(false)
		expect(state("branch", { canAct: false }).disabled).toBe(true)
	})

	it("swipe, hide and delete follow the item rule; swipe needs a swipe to take", () => {
		expect(state("swipe")).toEqual({ shown: true, disabled: false })
		// A greeting on its last alternative has nothing to swipe to; one
		// with an alternative to the right has.
		const greeting = (idx: number) =>
			({
				id: 1,
				characterId: 7,
				metadata: {
					isGreeting: true,
					swipes: { currentIdx: idx, history: ["a", "b"] }
				}
			}) as VerbContext["msg"]
		expect(state("swipe", { msg: greeting(1) }).disabled).toBe(true)
		expect(state("swipe", { msg: greeting(0) }).disabled).toBe(false)
		expect(state("hide", { canControl: false }).disabled).toBe(true)
		expect(state("delete", { editing: true }).disabled).toBe(true)
	})

	it("a contributed action gets the generic answer: shown unless generating, disabled while busy or by the audience", () => {
		expect(coreVerbState("acme-roll", base())).toEqual({
			shown: true,
			disabled: false
		})
		expect(
			coreVerbState("acme-roll", base({ canAct: false })).disabled
		).toBe(true)
		expect(
			coreVerbState(
				"acme-roll",
				base({ msg: { characterId: 7, isGenerating: true } })
			).shown
		).toBe(false)
		expect(
			coreVerbState("acme-roll", base({ hasGeneratingMessage: true }))
				.disabled
		).toBe(true)
	})

	it("an item-gated contributed action defers to the message's ownership rule, not only the audience (W6)", () => {
		expect(
			coreVerbState(
				"contributed:acme-rewrite",
				base({ itemGated: true, canControl: false })
			).disabled
		).toBe(true)
		expect(
			coreVerbState(
				"contributed:acme-rewrite",
				base({ itemGated: true, canControl: true })
			).disabled
		).toBe(false)
		expect(
			coreVerbState(
				"contributed:acme-roll",
				base({ itemGated: false, canControl: false })
			).disabled
		).toBe(false)
	})

	it("a contributed action's own enabled-when greys it with its reason, and its item.* predicates are judged per row (U5e)", () => {
		// The list's verdict — the server judged `state.world.location` and said no.
		expect(
			coreVerbState(
				"contributed:look",
				base({
					enabled: false,
					reason: "Set a location first — Look describes where you are."
				})
			)
		).toEqual({
			shown: true,
			disabled: true,
			reason: "Set a location first — Look describes where you are."
		})
		// An `item.*` predicate the server could not judge: this row's own document decides.
		const onlyMine = [
			{
				on: "item.mine",
				truthy: true,
				reason: { en: "only on your own line" }
			}
		]
		expect(
			coreVerbState(
				"contributed:annotate",
				base({ itemPredicates: onlyMine, canControl: false })
			)
		).toEqual({
			shown: true,
			disabled: true,
			reason: "only on your own line"
		})
		expect(
			coreVerbState(
				"contributed:annotate",
				base({ itemPredicates: onlyMine, canControl: true })
			).disabled
		).toBe(false)
		// The audience's word still comes first — the verdict's sentence.
		expect(
			coreVerbState(
				"contributed:annotate",
				base({
					itemPredicates: onlyMine,
					canControl: false,
					canAct: false,
					action: { name: "Annotate", act: ["owner"] }
				})
			).reason
		).toBe(notYours("Annotate", ["owner"]))
	})
})

describe("why a verb is grey (UI nit 2)", () => {
	it("every disabled answer carries a reason, in the chips' vocabulary", () => {
		expect(state("edit", { canControl: false }).reason).toBe(
			"not yours to change"
		)
		expect(state("edit", { hasGeneratingMessage: true }).reason).toBe(
			"wait for the reply to finish"
		)
		expect(state("edit", { editing: true }).reason).toBe(
			"finish the edit first"
		)
		expect(
			state("edit", { msg: { characterId: 7, isHidden: true } }).reason
		).toBe("unhide it first")
		// Retry on a row that is shown but not the newest reply the road can
		// redo — a greeting — says why; the newest rule itself hides the row.
		expect(
			state("retry", {
				msg: { id: 1, characterId: 7, metadata: { isGreeting: true } }
			}).reason
		).toBe("a greeting is swiped, not regenerated")
		expect(
			state("swipe", {
				msg: {
					id: 1,
					characterId: 7,
					metadata: {
						isGreeting: true,
						swipes: { currentIdx: 1, history: ["a", "b"] }
					}
				}
			}).reason
		).toBe("nothing to swipe to")
		// The audience's sentence is the verdict's own — the words the fire
		// refuses with — naming the action and who may act (01 §13).
		expect(state("branch", { canAct: false }).reason).toBe(notYours("branch", ["item"]))
		expect(state("delete", { canControl: false }).reason).toBe(
			"not yours to change"
		)
		expect(
			coreVerbState("contributed:acme-roll", base({ canAct: false }))
				.reason
		).toBe(notYours("Roll", ["owner"]))
		// An item-gated action's audience names `item`, and the row's own
		// ownership rule is what refused: the sentence says so.
		expect(
			coreVerbState(
				"contributed:acme-rewrite",
				base({
					itemGated: true,
					canControl: false,
					action: { name: "Rewrite", act: ["owner", "item"] }
				})
			).reason
		).toBe(notYours("Rewrite", ["owner", "item"]))
		// Continue's own sentence names the switch; the ownership rule still wins.
		expect(
			state("continue", { continueRefusal: "No prefill." }).reason
		).toBe("No prefill.")
		expect(
			state("continue", {
				continueRefusal: "No prefill.",
				canControl: false
			}).reason
		).toBe("not yours to change")
	})

	it("the ownership rule's sentence wins over a busy state — a grey control does not change its reason because something else is busy", () => {
		expect(
			state("edit", { canControl: false, hasGeneratingMessage: true })
				.reason
		).toBe("not yours to change")
		expect(state("branch", { canAct: false, editing: true }).reason).toBe(
			notYours("branch", ["item"])
		)
	})

	it("an enabled verb carries none", () => {
		for (const key of [
			"edit",
			"retry",
			"continue",
			"branch",
			"swipe",
			"hide",
			"delete"
		])
			expect(state(key).reason, key).toBeUndefined()
	})

	it("the state half's sentences are the SDK's — one vocabulary with the door", () => {
		expect(VERB_REASONS.generating).toBe("wait for the reply to finish")
		expect(VERB_REASONS.notNewest).toBe(
			"only the newest reply can be regenerated"
		)
		expect(VERB_REASONS.hidden).toBe("unhide it first")
		expect(VERB_REASONS.noSwipe).toBe("nothing to swipe to")
	})
})

describe("the enabled-when half on its own", () => {
	it("the list's no comes first, with its sentence; then the item predicates; then nothing", () => {
		expect(
			enabledWhenState(base({ enabled: false, reason: "why" }))
		).toEqual([true, "why"])
		expect(enabledWhenState(base({ enabled: true }))).toEqual([
			false,
			undefined
		])
		expect(enabledWhenState(base())).toEqual([false, undefined])
		const newest = [
			{ on: "item.isNewest", truthy: true, reason: { en: "newest only" } }
		]
		expect(
			enabledWhenState(
				base({ itemPredicates: newest, isLastMessage: false })
			)
		).toEqual([true, "newest only"])
		expect(
			enabledWhenState(
				base({ itemPredicates: newest, isLastMessage: true })
			)
		).toEqual([false, undefined])
	})

	it("verdictOf lifts the wire's verdict onto the context, the reason resolved", () => {
		expect(
			verdictOf({
				key: "look",
				specSlug: "core:spec/x",
				name: "Look",
				audience: { act: ["owner"] },
				canAct: true,
				itemGated: false,
				enabled: false,
				reason: { i18n: { en: "Set a location first" } }
			})
		).toEqual({
			canAct: true,
			itemGated: false,
			action: { name: "Look", act: ["owner"] },
			enabled: false,
			reason: "Set a location first"
		})
		expect(
			verdictOf({
				key: "edit",
				specSlug: "core",
				name: "Edit",
				audience: { act: ["item"] },
				canAct: true,
				itemGated: true
			})
		).toEqual({
			canAct: true,
			itemGated: true,
			action: { name: "Edit", act: ["item"] }
		})
	})
})

describe("the quick row", () => {
	const row = (over: Partial<RowAction> & { key: string }): RowAction => ({
		specSlug: "core",
		name: over.key,
		audience: { act: ["item"] },
		canAct: true,
		itemGated: true,
		...(over.specSlug === undefined || over.specSlug === "core"
			? listedRow(over.key, false)
			: {}),
		...over
	})
	const rowCtx = (over: Partial<VerbContext> = {}) => {
		const { canAct: _a, itemGated: _i, action: _act, ...rest } = base(over)
		return rest
	}

	it("draws the primary set, core's and a plugin's alike, minus stop (S8)", () => {
		const primary = [
			row({ key: "stop" }),
			row({ key: "edit" }),
			row({ key: "retry" }),
			row({
				key: "rewrite",
				specSlug: "acme:spec/rewrite",
				itemGated: false
			})
		]
		expect(
			quickRowActions(primary, rowCtx()).map((q) => q.action.key)
		).toEqual(["edit", "retry", "rewrite"])
	})

	it("hides what the menu would disable — the audience, the ownership rule, the message's state", () => {
		const primary = [
			row({ key: "edit" }),
			row({ key: "retry" }),
			row({
				key: "rewrite",
				specSlug: "acme:spec/rewrite",
				itemGated: false,
				canAct: false
			}),
			row({
				key: "annotate",
				specSlug: "acme:spec/annotate",
				itemGated: true
			})
		]
		// A guest on somebody else's message: edit and retry follow the item
		// rule, `annotate` is item-gated, `rewrite` is greyed by its audience.
		expect(quickRowActions(primary, rowCtx({ canControl: false }))).toEqual(
			[]
		)
		// The owner: all but the greyed one.
		expect(
			quickRowActions(primary, rowCtx()).map((q) => q.action.key)
		).toEqual(["edit", "retry", "annotate"])
		// Nothing while a reply streams: the list's verdict says so for
		// core's (re-listed on the flip), the busy guard for a plugin's.
		const busy = [
			{ ...row({ key: "edit" }), ...listedRow("edit", true) },
			row({
				key: "annotate",
				specSlug: "acme:spec/annotate",
				itemGated: true
			})
		]
		expect(
			quickRowActions(
				busy,
				rowCtx({
					msg: { characterId: 7, isGenerating: true },
					hasGeneratingMessage: true
				})
			)
		).toEqual([])
		// A declared reason greys a plugin's quick action off the row too.
		expect(
			quickRowActions(
				[
					row({
						key: "look",
						specSlug: "acme:spec/look",
						itemGated: false,
						enabled: false
					})
				],
				rowCtx()
			)
		).toEqual([])
	})

	it("keys the verb table by core key or a contributed prefix — never a plugin's key as core's", () => {
		expect(verbKeyOf({ key: "edit", specSlug: "core" })).toBe("edit")
		expect(verbKeyOf({ key: "edit", specSlug: "acme:spec/x" })).toBe(
			"contributed:edit"
		)
	})
})

describe("notYoursToUse — client symmetry with core:verdict/audience", () => {
	it("carries a sentence for every audience that admits nobody with no portrayals resolved", () => {
		expect(notYoursToUse({ name: "grant", act: [] })).not.toBe("")
		expect(notYoursToUse({ name: "grant", act: ["item"] })).not.toBe("")
		expect(notYoursToUse({ name: "grant", act: ["run-owner"] })).not.toBe("")
	})
})
