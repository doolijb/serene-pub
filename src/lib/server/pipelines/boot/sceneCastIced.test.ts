/**
 * The scene summarizer no longer asks a model who was in the scene — and the
 * step it stopped calling is still there to be called.
 *
 * ⚠ **On ice, not deleted** (plan §2, ruled 2026-09-08). Both halves are pinned
 * here because both can regress on their own and neither is visible from the
 * app: an accidental re-add of `extractsCast` puts an unmeasured LLM call back
 * into every scene summary, and a "tidy up the dead node type" would turn the
 * ice into a rewrite nobody voted for.
 *
 * ⚠ This file checks the CATALOG DOCUMENT, not a database. Publishing is
 * idempotent by `(slug, semver)`, so an already-seeded install keeps the old
 * document until a migration deletes its version row — that pairing is
 * `0104_ice_scene_cast_extraction`, and a green test here says nothing about
 * whether it ran.
 */

import { describe, expect, it } from "vitest"
import { CORE_SPECS } from "@serene-pub/core-catalog"
import { allTypes } from "@serene-pub/sdk"
import "@serene-pub/contracts"

const CAST_TYPE = "core:provider/extract-cast"

const documentFor = (slug: string) => {
	const entry = CORE_SPECS.find((s) => s.slug === slug)
	if (!entry) throw new Error(`no core spec ${slug}`)
	return entry.build()
}

const typeIdsOf = (slug: string) =>
	documentFor(slug).nodes.map((n: { typeId: string }) => n.typeId)

describe("the scene cast extraction is on ice", () => {
	it("is not wired into the scene summarize document", () => {
		const ids = typeIdsOf("core:spec/summarize-scene")
		// Sanity that we are looking at the right document at all — otherwise
		// "no cast node" would pass against an empty list.
		// Node `typeId`s in a compiled document are UNVERSIONED — the pin lives
		// on the node's own `version` field — so this matches on the prefix
		// everywhere rather than on a pin that only reads like one.
		expect(ids).toContain("core:provider/summarize-synth")
		expect(ids.filter((id: string) => id.startsWith(CAST_TYPE))).toEqual([])
	})

	it("is not wired into any other summarize namespace either", () => {
		// It never was; stated so that reviving it into the wrong one of the
		// four is a failure rather than a surprise.
		for (const slug of [
			"core:spec/summarize-world",
			"core:spec/summarize-character",
			"core:spec/summarize-history"
		])
			expect(
				typeIdsOf(slug).filter((id: string) => id.startsWith(CAST_TYPE))
			).toEqual([])
	})

	it("keeps the node type published, so reviving it is one line", () => {
		// The type is what makes this ice rather than a deletion: its
		// declaration, its script hooks and its seeded prompt all survive, so
		// restoring `extractsCast: true` in the catalog is the whole revival.
		const published = allTypes().map((t: { id: string }) => t.id)
		expect(published).toContain(`${CAST_TYPE}@1`)
	})
})
