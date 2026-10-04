/**
 * A clause inside a clause survives the store (lair pass F2 / B2).
 *
 * A nested clause is addressed by its parent AND the parent's chain it sits
 * in (`clauseId` + `clauseChain`), exactly as a node is. The store kept only
 * the parent, so a loaded document's nested clause matched no level in the
 * executor and never ran — silently: the Lair's cast voices and the keeper's
 * commit were both lost this way. These assert the loaded document is the
 * in-code one, byte for byte, for every spec core ships.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { and, eq, isNotNull } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { saveDocument, loadDocument } from "$lib/server/pipelines/boot/store"
import { canonicalHash } from "@serene-pub/sdk"
import { lairRespondSpec, LAIR_RESPOND_SPEC_ID } from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

/** The document a slug's active version loads as. */
async function loadActive(slug: string) {
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
		.limit(1)
	return loadDocument(db, spec!.activeVersionId!)
}

describe("nested clauses round-trip through the store", () => {
	it("the Lair's respond spec loads back with every clause's chain (hash equal)", async () => {
		const doc = lairRespondSpec()
		const saved = await saveDocument(
			db,
			{ ...doc, id: "test:spec/lair-round-trip" },
			{ publish: true }
		)
		const back = await loadDocument(db, saved.specVersionId)
		const want = { ...doc, id: "test:spec/lair-round-trip" }

		// Named first because it is the defect: a nested clause without its
		// chain matches no level in the executor and never runs.
		const nested = (d: typeof doc) =>
			d.clauses
				.filter((c) => c.clauseId)
				.map((c) => [c.id, c.clauseId, c.clauseChain])
		expect(nested(back)).toEqual(nested(want))
		expect(nested(want)).toEqual(
			expect.arrayContaining([
				// R8 (2026-09-28): `via` routes Narrate first; the knock or
				// the play is the `door`, after who speaks (`pick`); the play
				// runs the session's party speech (owner ruling 2026-09-30):
				// each delver's character turn (with its own propose-or-apply
				// inside it) or the Castellan for the party; the Castellan's
				// keeper is on the spine.
				["via.turn.channel", "via", "turn"],
				["via.turn.channel.story.pick", "via.turn.channel", "story"],
				["via.turn.channel.story.door", "via.turn.channel", "story"],
				["via.turn.channel.story.door.play.speech", "via.turn.channel.story.door", "play"],
				["via.turn.channel.story.door.play.speech.each.character", "via.turn.channel.story.door.play.speech", "each"],
				["via.turn.channel.story.door.play.speech.each.character.turn.commit", "via.turn.channel.story.door.play.speech.each.character", "turn"],
				["via.turn.channel.story.door.play.speech.castellan.party", "via.turn.channel.story.door.play.speech", "castellan"],
				["via.turn.channel.story.door.play.speech.castellan.party.speaks.row", "via.turn.channel.story.door.play.speech.castellan.party", "speaks"],
				["keep.played.commit", "keep", "played"]
			])
		)
		expect(back.clauses).toEqual(want.clauses)
		expect(canonicalHash(back)).toBe(canonicalHash(want))
	}, 60_000)

	it("every shipped core spec, published at boot, loads back as the in-code document", async () => {
		const { bootstrapPipelines } = await import(
			"$lib/server/pipelines/boot/bootstrap"
		)
		await bootstrapPipelines(db as any)
		const { CORE_SPECS } = await import("$lib/server/pipelines/specs")
		const drift: string[] = []
		for (const entry of CORE_SPECS) {
			const doc = entry.build()
			const back = await loadActive(doc.id)
			if (canonicalHash(back) !== canonicalHash(doc)) drift.push(doc.id)
		}
		expect(drift).toEqual([])
	}, 180_000)

	it("a version stored before the chain was kept is healed by the boot's republish", async () => {
		// Rows as a pre-B2 install holds them: the right hash, the chain
		// missing. The seed sees the hash as present, so only the heal can
		// repair it.
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, LAIR_RESPOND_SPEC_ID))
			.limit(1)
		await db
			.update(schema.pipelineClauses)
			.set({ parentClauseChain: null })
			.where(
				and(
					eq(schema.pipelineClauses.specVersionId, spec!.activeVersionId!),
					isNotNull(schema.pipelineClauses.parentClauseId)
				)
			)
		const doc = lairRespondSpec()
		expect(canonicalHash(await loadActive(doc.id))).not.toBe(
			canonicalHash(doc)
		)

		const { seedCoreSpecs } = await import("$lib/server/pipelines/boot/seed")
		await seedCoreSpecs(db as any)

		const [after] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, LAIR_RESPOND_SPEC_ID))
			.limit(1)
		// Healed in place — the same version row, not a new one.
		expect(after!.activeVersionId).toBe(spec!.activeVersionId)
		expect(canonicalHash(await loadActive(doc.id))).toBe(canonicalHash(doc))
	}, 180_000)
})
