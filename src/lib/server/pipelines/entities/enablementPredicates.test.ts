import { describe, it, expect } from "vitest"
import { enablementOf } from "$lib/server/pipelines/entities/sessionActions"
import type { PublishedValues } from "$lib/server/pipelines/entities/publishedValues"
import { i18nText, type EnabledWhen } from "@serene-pub/sdk"

/**
 * The two-port compare, read at the app's own door (D-4a, 2026-09-17).
 *
 * ⚠ **There is no junction evaluator in core.** The junction is the SDK
 * executor's (`sdk/src/executor.ts`, the `clause.kind === 'junction'` branch)
 * — core *runs* the executor and never reimplements the scheduler
 * (INTEGRATING.md). What core owns is the other reader of the same predicate
 * shape: `enablementOf`, which decides whether an action is offered. So this
 * is the app's half of "one predicate, two readers", and what it pins is that
 * the app's reader hands the **whole published-values document** down, which
 * is the only way `equalsPath` has a second side to read.
 *
 * `equals` could only ever ask *is the accused Vell?*. This is the app seeing
 * *is the accused the culprit?*.
 */

/** A published-values document, as a listing builds one. */
const doc = (over: Record<string, unknown> = {}): PublishedValues =>
	({
		state: { world: { culprit: "character:12" }, cast: {} },
		session: { fields: { accused: "character:12" }, generating: false },
		...over
	}) as unknown as PublishedValues

const sameAsCulprit: EnabledWhen = {
	on: "session.fields.accused",
	equalsPath: "state.world.culprit",
	reason: { en: "That is not who you accused" }
}

describe("enablementOf reads a two-port compare", () => {
	it("holds when the two paths agree", () => {
		expect(enablementOf([sameAsCulprit], doc())).toEqual({
			enabled: true,
			itemPredicates: []
		})
	})

	it("greys with the predicate's own sentence when they disagree", () => {
		const v = enablementOf(
			[sameAsCulprit],
			doc({ session: { fields: { accused: "character:13" }, generating: false } })
		)
		expect(v.enabled).toBe(false)
		expect(i18nText(v.reason?.i18n)).toBe("That is not who you accused")
	})

	it("two absences are not a match", () => {
		// The case the whole rule exists for: an unwired path on each side
		// would otherwise compare equal and enable the control that means
		// *you named the culprit*.
		const v = enablementOf(
			[
				{
					on: "session.fields.missing",
					equalsPath: "state.world.alsoMissing",
					reason: { en: "Nothing to compare" }
				}
			],
			doc()
		)
		expect(v.enabled).toBe(false)
	})

	it("an item predicate is still set aside for the client", () => {
		// `partitionEnabledWhen` is unchanged by the third condition: a
		// predicate over `item.*` is evaluated where a message is at hand.
		const perRow: EnabledWhen = {
			on: "item.speaker",
			equalsPath: "state.world.culprit",
			reason: { en: "Only the culprit may confess" }
		}
		const listing = enablementOf([perRow], doc())
		expect(listing.enabled).toBe(true)
		expect(listing.itemPredicates).toEqual([perRow])
		// At the door, with the row in the document, it is judged like any
		// other — and `equalsPath` reads its other side from the same
		// document, which is why the whole of it travels down.
		const atTheDoor = enablementOf(
			[perRow],
			doc({ item: { speaker: "character:12" } })
		)
		expect(atTheDoor.enabled).toBe(true)
		expect(atTheDoor.itemPredicates).toEqual([])
		const wrongSpeaker = enablementOf(
			[perRow],
			doc({ item: { speaker: "character:13" } })
		)
		expect(wrongSpeaker.enabled).toBe(false)
	})

	it("the conditions that existed before read exactly as they did", () => {
		const busy: EnabledWhen = {
			on: "session.generating",
			equals: false,
			reason: { en: "Wait for the reply" }
		}
		expect(enablementOf([busy], doc()).enabled).toBe(true)
		expect(
			enablementOf(
				[busy],
				doc({ session: { fields: {}, generating: true } })
			).enabled
		).toBe(false)
	})
})
