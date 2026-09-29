import { describe, expect, test } from "vitest"
import {
	canRegenerateNewest,
	canSwipeRight,
	lastAuthorLine,
	showSwipeControls,
	type SwipeRow
} from "./swipeControls"

/**
 * F1: in a persona-less genre (Lair, Guide) the author's line has no
 * `personaId`; the controls must key on `role`, or the newest user line gets
 * arrows and a Regenerate that overwrite it with narrator prose.
 */
const facts = (rows: SwipeRow[], retry = true, swipe = true) => {
	const newest = rows[rows.length - 1]
	const lastAuthor = lastAuthorLine(rows)
	const regen = canRegenerateNewest(newest, retry)
	return (msg: SwipeRow) => ({
		show: showSwipeControls(msg, {
			isGreeting: !!msg.metadata?.isGreeting,
			isNewest: msg.id === newest?.id,
			swipeOffered: swipe,
			canRegenerateNewest: regen,
			lastAuthor
		}),
		right: canSwipeRight(msg, !!msg.metadata?.isGreeting, lastAuthor),
		regen
	})
}

describe("swipe and regenerate on a persona-less session", () => {
	// No personaId anywhere — the Lair after the last reply was deleted.
	const reply: SwipeRow = { id: 1, role: "assistant" }
	const mine: SwipeRow = { id: 2, role: "user" }

	test("the author's newest line gets no arrows and no Regenerate", () => {
		const f = facts([reply, mine])
		expect(f(mine).show).toBe(false)
		expect(f(mine).right).toBe(false)
		expect(f(mine).regen).toBe(false)
	})

	test("the reply before it is not swipeable either", () => {
		const f = facts([reply, mine])
		expect(f(reply).show).toBe(false)
		expect(f(reply).right).toBe(false)
	})

	test("the newest assistant line is still swipeable and regenerable", () => {
		const next: SwipeRow = { id: 3, role: "assistant" }
		const f = facts([reply, mine, next])
		expect(f(next).show).toBe(true)
		expect(f(next).right).toBe(true)
		expect(f(next).regen).toBe(true)
	})
})

describe("swipe with personas is unchanged", () => {
	test("arrows on the newest reply only", () => {
		const a: SwipeRow = { id: 1, role: "assistant" }
		const p = { id: 2, role: "user", personaId: 9 } as SwipeRow
		const b: SwipeRow = { id: 3, role: "assistant" }
		const f = facts([a, p, b])
		expect(f(a).show).toBe(false)
		expect(f(p).show).toBe(false)
		expect(f(b).show).toBe(true)
	})

	test("a genre that switches swipe off shows none", () => {
		const b: SwipeRow = { id: 1, role: "assistant" }
		expect(facts([b], true, false)(b).show).toBe(false)
	})

	test("a greeting with no author line after it shows arrows", () => {
		const g: SwipeRow = {
			id: 1,
			role: "assistant",
			metadata: { isGreeting: true, swipes: { currentIdx: 0, history: [1, 2] } }
		}
		const f = facts([g])
		expect(f(g).show).toBe(true)
		expect(f(g).right).toBe(true)
		expect(f(g).regen).toBe(false)
	})
})
