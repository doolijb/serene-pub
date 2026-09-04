/**
 * The shipped prompt catalog, checked as data — before a database sees it.
 *
 * `seedPipelinePrompts` matches on `seedKey` and writes what the catalog says.
 * That makes the seed idempotent only if the catalog itself is well-formed, so
 * this file asserts the well-formedness rather than asking the seed to defend
 * itself at runtime. A duplicate caught here is a failing unit test; the same
 * duplicate caught at boot is a `pipeline_prompts_pool_name_idx` violation on a
 * FRESH INSTALL — the seed pass aborts, and since `bootstrapPipelines` reports
 * rather than throws, the app comes up with no prompts and no visible reason.
 *
 * Everything here is a property of the list alone. There is no database, and
 * deliberately no import of the app's pool helpers: this must fail because the
 * catalog is wrong, never because a helper moved.
 *
 * Note that `@serene-pub/core-catalog` resolves to its **`dist`** (its package
 * `exports` say so), which is the same copy the seed pass loads — so this
 * guards what actually ships. The trap is the other half of that: editing
 * `serene-pub-sdk/core-catalog/src/prompts.ts` changes nothing here until that
 * package is rebuilt. If you edited the catalog and this test did not react,
 * you have not rebuilt it, and neither has the app.
 */

import { describe, it, expect } from "vitest"
import { CORE_PROMPTS, CORE_SPECS } from "@serene-pub/core-catalog"

/** The pool a row lives in. Mirrors `pipeline_prompts (node_type_id, slot)`. */
const poolOf = (p: { nodeType: string; slot: string }) =>
	`${p.nodeType}#${p.slot}`

const SPEC_SLUGS = new Set(CORE_SPECS.map((s) => s.slug))

describe("the shipped prompt catalog is seedable", () => {
	/**
	 * The idempotence key. Two rows sharing one means the second boot updates
	 * the row the first wrote — the catalog would ship 30 rows and the install
	 * would hold fewer, with whichever row lost the race silently absent from
	 * its picker. The unique constraint turns that into a crash instead, which
	 * is better and still much worse than this.
	 */
	it("gives every prompt its own seed key", () => {
		const seen = new Map<string, string>()
		const dupes: string[] = []
		for (const p of CORE_PROMPTS) {
			const prior = seen.get(p.seedKey)
			if (prior) dupes.push(`${p.seedKey} — '${prior}' and '${p.name}'`)
			seen.set(p.seedKey, p.name)
		}
		expect(dupes, `duplicate seed keys:\n  ${dupes.join("\n  ")}`).toEqual([])
		expect(seen.size).toBe(CORE_PROMPTS.length)
	})

	/**
	 * The DB's unique index is `(node_type_id, slot, name)`, so this is that
	 * constraint asserted a build earlier. It is NOT global: three pools each
	 * hold a row called "Default Scene Summarization", because they are three
	 * different prompts that used to travel as one bundle. Only a collision
	 * *within* one pool is the bug — that is a picker offering two entries with
	 * one name, where the difference between them is invisible.
	 */
	it("names every prompt uniquely within its pool", () => {
		const seen = new Set<string>()
		const dupes: string[] = []
		for (const p of CORE_PROMPTS) {
			const key = `${poolOf(p)}#${p.name}`
			if (seen.has(key)) dupes.push(`${poolOf(p)} — '${p.name}'`)
			seen.add(key)
		}
		expect(dupes, `two rows, one name, one pool:\n  ${dupes.join("\n  ")}`).toEqual(
			[]
		)
	})

	/**
	 * `pipeline-prompt:<nodeType>:<slot>:<slug>`.
	 *
	 * The key embeds the pool, so moving a row to another pool without re-keying
	 * it leaves a key naming a pool the row is no longer in. Nothing breaks
	 * loudly — the seed still matches on the string — but the key stops being
	 * readable evidence of where the row belongs, which is the whole reason it
	 * is spelled this way rather than being an opaque id.
	 */
	it("spells each seed key with the pool the row is in", () => {
		for (const p of CORE_PROMPTS)
			expect(
				p.seedKey,
				`${p.name} sits in ${poolOf(p)} but is keyed elsewhere`
			).toMatch(
				new RegExp(
					`^pipeline-prompt:${p.nodeType}:${p.slot}:[a-z0-9]+(?:-[a-z0-9]+)*$`
				)
			)
	})

	/**
	 * ⚠ The pool key is UNVERSIONED, and this is the silent one.
	 *
	 * Reads normalize the node type through `poolKeyFor`, which strips `@n`, so
	 * a row seeded under `core:task/build-template-context@1` lands in a pool
	 * key that no lookup ever produces. There is no error and no empty result
	 * to notice: the picker simply shows the other rows, and the prompt is
	 * invisible for as long as the version stays in the catalog.
	 */
	it("keys pools by an unversioned node type", () => {
		for (const p of CORE_PROMPTS)
			expect(
				p.nodeType,
				`${p.seedKey} pins a version; the pool strips it, so this row would never be found`
			).not.toMatch(/@/)
	})

	/**
	 * Resolution order starts at "a row in this pool whose `defaultForSpecs`
	 * contains this spec". Two rows claiming one spec in one pool makes that
	 * step ambiguous, and ambiguity resolves by row order — so which prompt a
	 * pipeline ships with becomes a fact about insertion id rather than about
	 * the catalog. It would look like a working default, just not the intended
	 * one.
	 */
	it("offers at most one default per spec in any pool", () => {
		const claimed = new Map<string, string>()
		const clashes: string[] = []
		for (const p of CORE_PROMPTS)
			for (const spec of p.defaultForSpecs) {
				const key = `${poolOf(p)}#${spec}`
				const prior = claimed.get(key)
				if (prior)
					clashes.push(
						`${poolOf(p)} — both '${prior}' and '${p.name}' claim ${spec}`
					)
				claimed.set(key, p.name)
			}
		expect(clashes, `ambiguous defaults:\n  ${clashes.join("\n  ")}`).toEqual([])
	})

	/**
	 * A typo in a spec slug costs a pipeline its shipped default, and costs it
	 * quietly: resolution falls through to the immutable row in the pool, so
	 * the pipeline still gets *a* prompt. `summarize-character` inheriting the
	 * world summarizer's wording is exactly the failure `defaultForSpecs` was
	 * introduced to prevent, and it does not announce itself.
	 */
	it("names only real core specs", () => {
		for (const p of CORE_PROMPTS) {
			for (const spec of p.defaultForSpecs)
				expect(
					SPEC_SLUGS.has(spec),
					`${p.seedKey} defaults for unknown spec '${spec}'`
				).toBe(true)
			if (p.createdForSpec !== undefined)
				expect(
					SPEC_SLUGS.has(p.createdForSpec),
					`${p.seedKey} was authored for unknown spec '${p.createdForSpec}'`
				).toBe(true)
		}
	})

	/**
	 * An empty field is the one defect that survives every other check here and
	 * still reaches the model: the panel renders the box, the row selects, and
	 * the slot contributes nothing. That reads as the model ignoring an
	 * instruction rather than as prose nobody wrote.
	 */
	it("ships prose in every declared field", () => {
		for (const p of CORE_PROMPTS) {
			const names = Object.keys(p.fields)
			expect(names.length, `${p.seedKey} declares no fields`).toBeGreaterThan(0)
			for (const [field, text] of Object.entries(p.fields))
				expect(text.trim(), `${p.seedKey} .${field} is blank`).not.toBe("")
		}
	})
})
