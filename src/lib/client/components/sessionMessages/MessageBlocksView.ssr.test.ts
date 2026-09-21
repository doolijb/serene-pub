/**
 * The block renderer's three form states, rendered (plans/29 R-15 *Forms* ·
 * *Staleness and order*; plans/30 U5d, U5f).
 *
 * `render` from `svelte/server`, like `CharacterCreatorModal.ssr.test.ts`:
 * the repo has no browser test environment, and the markup is what this is
 * about. Three branches beside each other: **awaiting** (somebody else's to
 * answer — no buttons), **answered** (the answer in place of the buttons),
 * and **superseded** (U5f — the channel moved past the form: one quiet line,
 * no question (the row's body already showed it), `data-superseded`, no
 * buttons). Answered beats stale.
 */
import { describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"

vi.mock("$app/environment", () => ({ dev: false, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))

import MessageBlocksView from "./MessageBlocksView.svelte"

const choices = (over: Record<string, unknown> = {}) => ({
	kind: "choices",
	id: "q1",
	head: 47,
	addressee: "character:12",
	question: "Will you come to the festival?",
	actions: [
		{ fn: "answer", action: "core:spec/ask#answer", label: "Yes", choice: "yes" },
		{ fn: "answer", action: "core:spec/ask#answer", label: "No", choice: "no" }
	],
	...over
})

const form = (over: Record<string, unknown> = {}) => ({
	kind: "form",
	id: "f1",
	head: 47,
	fn: "rsvp",
	action: "core:spec/ask#rsvp",
	addressee: "character:12",
	question: "How many are coming?",
	fields: { count: { type: "integer", min: 0 } },
	...over
})

function html(blocks: unknown[], isStale?: (b: { head?: unknown }) => boolean): string {
	return render(MessageBlocksView, {
		props: { blocks: blocks as any[], onAction: () => {}, isStale }
	}).body
}

describe("MessageBlocksView · a form's three states", () => {
	test("a live form shows its buttons", () => {
		const out = html([choices()])
		expect(out).toContain("Yes")
		expect(out).toContain("<button")
		expect(out).not.toContain('data-superseded="true"')
		expect(out).not.toContain("Superseded")
	})

	test("a superseded form collapses to one quiet line, with no question and no buttons", () => {
		const out = html([choices()], () => true)
		expect(out).toContain('data-superseded="true"')
		expect(out).toContain("Superseded — the conversation moved on")
		expect(out).not.toContain("Will you come to the festival?")
		expect(out).not.toContain("<button")
		expect(out).not.toContain('role="group"')
		// The same for a `form` block.
		const f = html([form()], () => true)
		expect(f).toContain('data-superseded="true"')
		expect(f).toContain("Superseded — the conversation moved on")
		expect(f).not.toContain("How many are coming?")
		expect(f).not.toContain("<button")
		expect(f).not.toContain("<input")
	})

	test("answered beats stale: an answered form stays answered when the channel has moved on", () => {
		const out = html(
			[choices({ answered: { by: "character:12", at: "2026-09-17T00:00:00Z", choice: "yes" } })],
			() => true
		)
		expect(out).toContain('data-answered="true"')
		expect(out).toContain("Answered")
		expect(out).not.toContain('data-superseded="true"')
		expect(out).not.toContain("<button")
	})

	test("the verdict is asked per block, and a block inside a group is asked too", () => {
		const asked: unknown[] = []
		const out = html(
			[
				choices({ id: "a" }),
				{ kind: "group", blocks: [choices({ id: "b" })] },
				// `kv` rather than `md`: markdown wants the DOM sanitizer, which
				// the server render has no document for.
				{ kind: "kv", rows: [{ label: "Where", value: "the square" }] }
			],
			(b) => {
				asked.push((b as { id?: unknown }).id)
				return (b as { id?: unknown }).id === "b"
			}
		)
		expect(asked).toEqual(["a", "b"])
		expect(out.split('data-superseded="true"')).toHaveLength(2)
		expect(out).toContain("<button")
	})

	test("with no verdict handed down, nothing is superseded", () => {
		const out = html([choices()])
		expect(out).not.toContain("Superseded")
	})
})
