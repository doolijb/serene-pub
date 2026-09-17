/**
 * The docs lane's ranking, pinned.
 *
 * `matchDocSections` is the only place that decides what "searching the
 * documentation" means, and both callers — the Jump overlay and the Help
 * view's registered scope — read it. It is also the kind of rule that fails
 * quietly: a comparator one sign backwards buries the page a reader typed the
 * name of under three of its own subsections, and nothing anywhere errors.
 *
 * Fixture slugs on purpose. The real manifest is compiled build output, so a
 * test that leaned on it would be asserting today's documentation rather than
 * the ranking; an unknown slug also exercises the subtitle's fallback.
 */
import { describe, expect, test } from "vitest"
import { matchDocSections } from "./docsJump"
import type { DocSection } from "$lib/shared/utils/docsIndex"

function section(
	over: Partial<DocSection> & Pick<DocSection, "title">
): DocSection {
	return {
		slug: "fixture-page",
		anchor: "an-anchor",
		depth: 2,
		preview: "",
		...over
	}
}

describe("matchDocSections", () => {
	test("a heading match outranks a mention in the prose", () => {
		const hits = matchDocSections(
			[
				section({
					title: "Nothing to do with it",
					preview: "sessions"
				}),
				section({ title: "Sessions and swipes", anchor: "swipes" })
			],
			"sessions",
			8
		)
		expect(hits.map((h) => h.title)).toEqual([
			"Sessions and swipes",
			"Nothing to do with it"
		])
	})

	// The page called "Sessions" is a better answer to "sessions" than any
	// subsection of it.
	test("a page's own H1 comes first among heading matches", () => {
		const hits = matchDocSections(
			[
				section({ title: "Sessions and swipes" }),
				section({ title: "Sessions", depth: 1, anchor: "" })
			],
			"sessions",
			8
		)
		expect(hits.map((h) => h.title)).toEqual([
			"Sessions",
			"Sessions and swipes"
		])
	})

	test("equal ranks keep the compiler's reading order", () => {
		const hits = matchDocSections(
			[
				section({ title: "Tag a character" }),
				section({ title: "Tag a lorebook" }),
				section({ title: "Tag a session" })
			],
			"tag",
			8
		)
		expect(hits.map((h) => h.title)).toEqual([
			"Tag a character",
			"Tag a lorebook",
			"Tag a session"
		])
	})

	test("the cap is spent on the best rows, not the first ones", () => {
		const hits = matchDocSections(
			[
				section({ title: "Elsewhere", preview: "tags" }),
				section({ title: "Tags", depth: 1, anchor: "" })
			],
			"tags",
			1
		)
		expect(hits.map((h) => h.title)).toEqual(["Tags"])
	})

	test("a hit carries the slug as its id and the heading as its anchor", () => {
		const [hit] = matchDocSections(
			[section({ slug: "a-guide", title: "Swipes", anchor: "swipes" })],
			"swipes",
			8
		)
		expect(hit).toEqual({
			kind: "doc",
			id: "a-guide",
			anchor: "swipes",
			title: "Swipes",
			// No such page in the manifest, so the slug stands in for its title.
			subtitle: "a-guide"
		})
	})

	// "" is the top of the page, which is the ABSENCE of an anchor rather than
	// an anchor named "" — `openJumpHit` would otherwise navigate to a bare `#`.
	test("a page's own H1 carries no anchor", () => {
		const [hit] = matchDocSections(
			[section({ title: "Sessions", depth: 1, anchor: "" })],
			"sessions",
			8
		)
		expect(hit.anchor).toBeUndefined()
	})

	test("case is a typing convenience, not a distinction", () => {
		expect(
			matchDocSections([section({ title: "Lorebooks" })], "  LORE  ", 8)
		).toHaveLength(1)
	})

	// The minimum query length is JUMP_MIN_QUERY_LENGTH and the overlay's
	// rule, applied once for every lane rather than again in each of them.
	test("a one-character query is matched, not refused", () => {
		expect(
			matchDocSections([section({ title: "Tags" })], "t", 8)
		).toHaveLength(1)
	})

	test.each([[""], ["   "]])("%o matches nothing", (query) => {
		expect(
			matchDocSections([section({ title: "Tags" })], query, 8)
		).toEqual([])
	})

	// A checkout that has not compiled the docs has no sections at all.
	test("an empty index is an empty answer, not a throw", () => {
		expect(matchDocSections([], "sessions", 8)).toEqual([])
	})
})
