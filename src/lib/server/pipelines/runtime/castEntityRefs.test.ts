/**
 * Retrieval's tier-one vocabulary: what goes into it, and in what order.
 *
 * ## The defect this closes
 *
 * Two subsystems built different recognition vocabularies for one lorebook.
 * `annotations/loadVocabulary` reads **every** `lorebook_bindings` row and
 * unions `name`, `aliases` and `absorbedAliases`; `castEntityRefs` read the
 * session cast alone. So a character the book binds but this scene never seated
 * was a name annotations resolved and retrieval could not — and because the
 * `gazetteer_hash` those annotations are filed under is computed from the
 * annotation vocabulary, no receipt anywhere could show the disagreement.
 *
 * ## Why the assertions are on the *order* and not only the membership
 *
 * `buildGazetteer` lets the first claimant of a name keep it. That is the whole
 * mechanism behind "a character called Vell resolves to the character rather
 * than to an entry titled after her", and widening the source is exactly the
 * kind of change that disturbs it silently: append the roster in the wrong place
 * and a background NPC starts winning names the person in the room was using.
 * The order is therefore asserted positionally rather than as a set.
 *
 * It cannot be asserted anywhere else. The pipeline's diagnostics report an
 * entity's *surface text*, never which row claimed the key, so a precedence
 * inversion is invisible from `receipt.nodes` and from every integration
 * fixture. That is what the export on `castEntityRefs` is for.
 */

import { describe, it, expect } from "vitest"
import { castEntityRefs } from "./bindings"
import { buildGazetteer } from "$lib/server/pipelines/ranking/entities"

/** One seated character, in the shape `session_cast` hands over. */
const seated = (
	id: number,
	name: string,
	extra: {
		nickname?: string | null
		aliases?: unknown
		absorbedAliases?: unknown
	} = {}
) => ({
	character: {
		id,
		name,
		nickname: extra.nickname ?? null,
		aliases: extra.aliases ?? []
	},
	absorbedAliases: extra.absorbedAliases ?? []
})

const bound = (
	row: Partial<{
		characterId: number | null
		name: string
		aliases: unknown
		absorbedAliases: unknown
	}>
) => ({
	characterId: null,
	name: "",
	aliases: [],
	absorbedAliases: [],
	...row
})

const names = (out: ReturnType<typeof castEntityRefs>) => out.map((n) => n.name)

describe("the vocabulary reaches the whole book, not only the room", () => {
	it("resolves a bound character the session never seated", () => {
		const out = castEntityRefs({
			sessionCharacters: [seated(7, "Vell")],
			lorebookBindings: [bound({ characterId: 3, name: "Ceyla" })]
		})
		expect(out).toContainEqual({
			name: "Ceyla",
			ref: { kind: "character", id: 3 }
		})
	})

	it("resolves that character's aliases too, not just her name", () => {
		const out = castEntityRefs({
			lorebookBindings: [
				bound({
					characterId: 3,
					name: "Ceyla",
					aliases: ["Warden of the Sluice"]
				})
			]
		})
		expect(names(out)).toEqual(["Ceyla", "Warden of the Sluice"])
	})

	/**
	 * The graph-merge case, and the one the column exists for.
	 *
	 * `absorbedAliases` is where `narrativeGraph:mergeNode` puts the identity a
	 * merge absorbed. It is deliberately not `aliases` — the sync helpers
	 * REPLACE `aliases` wholesale on every entity edit — so a consumer reading
	 * one column finds half the names, and the schema note makes reading both
	 * mandatory.
	 */
	it("resolves an absorbed identity on an unseated binding", () => {
		const out = castEntityRefs({
			lorebookBindings: [
				bound({
					characterId: 3,
					name: "Ceyla",
					aliases: ["Warden"],
					absorbedAliases: ["the sluicekeeper"]
				})
			]
		})
		expect(names(out)).toEqual(["Ceyla", "Warden", "the sluicekeeper"])
	})

	it("resolves an absorbed identity on a seated one, from the cast row", () => {
		const out = castEntityRefs({
			sessionCharacters: [
				seated(7, "Vell", { absorbedAliases: ["the commander"] })
			]
		})
		expect(out).toContainEqual({
			name: "the commander",
			ref: { kind: "character", id: 7 }
		})
	})

	it("resolves a bound persona the session never seated", () => {
		// A persona is a character, so the binding that names one is a
		// character binding and it resolves under that kind. What the test is
		// still for: a persona bound in the book but absent from the room
		// reaches the vocabulary at all.
		const out = castEntityRefs({
			lorebookBindings: [bound({ characterId: 4, name: "Warren" })]
		})
		expect(out).toEqual([
			{ name: "Warren", ref: { kind: "character", id: 4 } }
		])
	})

	/**
	 * A background NPC the graph minted binds nothing, and there is no row for
	 * it to resolve *to* — `EntityRef` names a character or an entry.
	 * `loadVocabulary` drops it for the same reason, and inventing a third kind
	 * is a schema decision neither seam should make alone. Its name still
	 * reaches the open tier as a string.
	 */
	it("drops a binding that names neither a character nor a persona", () => {
		const out = castEntityRefs({
			lorebookBindings: [bound({ name: "the man in the doorway" })]
		})
		expect(out).toEqual([])
	})

	it("survives a session that no longer exists", () => {
		expect(castEntityRefs(null)).toEqual([])
		expect(castEntityRefs({})).toEqual([])
	})

	it("drops blank names rather than claiming the empty string", () => {
		const out = castEntityRefs({
			lorebookBindings: [
				bound({
					characterId: 3,
					name: "   ",
					aliases: ["", "  Ceyla "]
				})
			]
		})
		expect(names(out)).toEqual(["Ceyla"])
	})
})

describe("the order the gazetteer will read it in", () => {
	/**
	 * Seated first, roster second. Both name `character:3`, so membership alone
	 * cannot tell a correct append from one that put the roster in front — only
	 * the position can, which is why this is `toEqual` on an array.
	 */
	it("puts the room before the rest of the book", () => {
		const out = castEntityRefs({
			sessionCharacters: [seated(7, "Vell")],
			sessionPersonas: [
				{ persona: { id: 9, name: "Warren", aliases: [] } }
			],
			lorebookBindings: [
				bound({ characterId: 3, name: "Ceyla" }),
				bound({ characterId: 7, name: "Vell" })
			]
		})
		expect(names(out)).toEqual(["Vell", "Warren", "Ceyla", "Vell"])
	})

	/**
	 * The consequence, at the seam that consumes it: two bindings claiming one
	 * name are settled in favour of the one in the room. Without the ordering
	 * above, "Vell" in this scene would resolve to a character who is not in it.
	 */
	it("gives a contested name to the seated claimant", () => {
		const g = buildGazetteer(
			castEntityRefs({
				sessionCharacters: [seated(7, "Vell")],
				lorebookBindings: [bound({ characterId: 3, name: "Vell" })]
			})
		)
		expect(g.byName.get("vell")).toEqual({ kind: "character", id: 7 })
	})

	/**
	 * The precedence `keywordQuery` documents, re-asserted through the widened
	 * source: cast **and** roster are both written before entry titles, so a
	 * character called Vell still beats an entry titled after her. The widening
	 * appends within the first tier; it does not push either half past the
	 * entries.
	 */
	it("still beats an entry titled after the character — seated or not", () => {
		const entries = [
			{ name: "Vell", ref: { kind: "entry" as const, id: 11 } },
			{ name: "Ceyla", ref: { kind: "entry" as const, id: 12 } }
		]
		const g = buildGazetteer([
			...castEntityRefs({
				sessionCharacters: [seated(7, "Vell")],
				lorebookBindings: [bound({ characterId: 3, name: "Ceyla" })]
			}),
			...entries
		])
		expect(g.byName.get("vell")).toEqual({ kind: "character", id: 7 })
		expect(g.byName.get("ceyla")).toEqual({ kind: "character", id: 3 })
	})
})
