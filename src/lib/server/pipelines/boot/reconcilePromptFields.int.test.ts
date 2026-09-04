/**
 * The archive sweep, and the four ways it could quietly lose somebody's words.
 *
 * A prompt row holds `fields`, and the panel renders one box per DECLARED
 * field — so text under a name the slot has stopped declaring is not wrong, it
 * is *invisible*. The sweep is the mechanism the ruling asks for: move it
 * somewhere the panel can show it read-only, and move it back if a later
 * version declares the name again.
 *
 * Everything here is about the boundaries, because the happy path is trivial
 * and the boundaries are where a silent loss lives:
 *
 *  1. A declared key is never touched — that is what makes running on every
 *     boot safe, and what keeps an edit made between two boots.
 *  2. It converges: the second run writes nothing.
 *  3. An unrecognised pool is skipped rather than emptied, so a disabled plugin
 *     does not archive every prompt written for it.
 *  4. A field one registered VERSION still declares is not archived because a
 *     newer version dropped it — a spec pinned to the old version is still
 *     reading it.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	bootstrapPipelines,
	RESPOND_SPEC_ID
} from "$lib/server/pipelines/boot/bootstrap"
import {
	declaredFieldsByPool,
	reconcilePromptFields
} from "$lib/server/pipelines/boot/reconcilePromptFields"
import { createPrompt } from "$lib/server/pipelines/entities/prompts"
import { promptPoolKeyFor } from "$lib/server/pipelines/entities/promptPool"

let db: TestDb
let pool: { nodeTypeId: string; slot: string }
/** The narrator's — a different node type, and it declares `narratorName`. */
let narratorPool: { nodeTypeId: string; slot: string }

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db as any)

	const { declarations } = await import("$lib/server/pipelines/config/panel")
	const [respond] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
	const decl = (await declarations(db as any, respond.activeVersionId!)).find(
		(d) => d.control === "prompts-ref"
	)!
	pool = { nodeTypeId: decl.nodeTypeId!, slot: decl.slot }

	const { NARRATE_SPEC_ID } = await import("$lib/server/pipelines/specs")
	const [narrate] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, NARRATE_SPEC_ID))
	const nDecl = (
		await declarations(db as any, narrate.activeVersionId!)
	).find((d) => d.control === "prompts-ref")!
	narratorPool = { nodeTypeId: nDecl.nodeTypeId!, slot: nDecl.slot }
}, 60_000)

const rowOf = async (id: number) => {
	const [row] = await db
		.select()
		.from(schema.pipelinePrompts)
		.where(eq(schema.pipelinePrompts.id, id))
	return row as any
}

describe("what the registry declares", () => {
	it("reads the field set off the rows, not off an in-process descriptor", async () => {
		// The same property `declarations` has and for the same reason: a
		// `transport: 'process'` plugin type has no descriptor in this process,
		// so a map would silently classify all of its fields as undeclared and
		// archive every one of them.
		const declared = await declaredFieldsByPool(db as any)
		const set = declared.get(promptPoolKeyFor(pool.nodeTypeId, pool.slot))
		expect(set).toBeTruthy()
		expect([...set!]).toContain("systemPrompt")
		expect([...set!]).toContain("postHistoryInstructions")
	})

	it("keeps the two pipelines' field sets apart", async () => {
		const declared = await declaredFieldsByPool(db as any)
		const reply = declared.get(
			promptPoolKeyFor(pool.nodeTypeId, pool.slot)
		)!
		const narrator = declared.get(
			promptPoolKeyFor(narratorPool.nodeTypeId, narratorPool.slot)
		)!
		expect([...reply]).not.toContain("narratorName")
		expect([...narrator]).toContain("narratorName")
	})
})

describe("archiving", () => {
	it("moves an undeclared key out of fields and leaves the declared ones", async () => {
		const p = await createPrompt(db as any, {
			...pool,
			name: "Carries a dead key",
			fields: {
				systemPrompt: "keep me",
				postHistoryInstructions: "keep me too",
				narratorName: "an afternoon's work"
			}
		})

		const report = await reconcilePromptFields(db as any)
		const mine = report.find((r) => r.promptId === p.id)
		expect(mine?.archived).toEqual(["narratorName"])

		const after = await rowOf(p.id)
		expect(Object.keys(after.fields).sort()).toEqual([
			"postHistoryInstructions",
			"systemPrompt"
		])
		expect(after.fields.systemPrompt).toBe("keep me")
		// Moved, never deleted — the whole point of the ruling.
		expect(after.archivedFields).toEqual({
			narratorName: "an afternoon's work"
		})
	})

	it("leaves the narrator's own name alone", async () => {
		// The scoping that migrations 0110 and 0114 had to get right by hand.
		// `narratorName` is dead on the reply node and load-bearing on the
		// narrator's — it names the seed line the model continues from — so an
		// unscoped sweep would leave narrations seeded with a blank speaker.
		const p = await createPrompt(db as any, {
			...narratorPool,
			name: "Narrator keeps its name",
			fields: {
				systemPrompt: "s",
				postHistoryInstructions: "p",
				narratorName: "The GM"
			}
		})
		await reconcilePromptFields(db as any)
		const after = await rowOf(p.id)
		expect(after.fields.narratorName).toBe("The GM")
		expect(after.archivedFields).toEqual({})
	})

	it("skips a pool the registry has never heard of, rather than emptying it", async () => {
		// A plugin somebody switched off. Archiving here would blank every
		// prompt written for it, and switching it back on would restore them —
		// with the panel having shown nothing at all in between.
		const p = await createPrompt(db as any, {
			nodeTypeId: "plugin:task/not-installed",
			slot: "prompts",
			name: "From a disabled plugin",
			fields: { anything: "mine" }
		})
		await reconcilePromptFields(db as any)
		const after = await rowOf(p.id)
		expect(after.fields).toEqual({ anything: "mine" })
		expect(after.archivedFields).toEqual({})
	})

	it("keeps a field an older registered version still declares", async () => {
		// The registry holds one row per (type, version) and a published spec
		// pins the version it was authored against. Sweeping on the newest
		// version alone would empty a field a still-running pipeline reads —
		// blank instructions, and nothing on any screen to say why.
		const [live] = await db
			.select()
			.from(schema.pipelineTypeRegistry)
			.where(eq(schema.pipelineTypeRegistry.typeId, pool.nodeTypeId))
		expect(
			live,
			"the reply context type is not in the registry"
		).toBeTruthy()

		// A newer version of the same type that drops one field.
		const slots = JSON.parse(JSON.stringify(live.slots))
		delete slots[pool.slot].fields.postHistoryInstructions
		await db.insert(schema.pipelineTypeRegistry).values({
			...live,
			id: undefined,
			version: (live.version ?? 1) + 1,
			slots
		} as any)

		const p = await createPrompt(db as any, {
			...pool,
			name: "Written against the older version",
			fields: {
				systemPrompt: "s",
				postHistoryInstructions: "still read by @1"
			}
		})
		await reconcilePromptFields(db as any)
		const after = await rowOf(p.id)
		expect(after.fields.postHistoryInstructions).toBe("still read by @1")
		expect(after.archivedFields).toEqual({})

		// Scoped to the row this test inserted. Matching on `version` alone would
		// delete every OTHER type's row that happens to share the number — and
		// version 2 is not rare — leaving later tests reconciling against a
		// registry with holes in it.
		await db
			.delete(schema.pipelineTypeRegistry)
			.where(
				and(
					eq(schema.pipelineTypeRegistry.typeId, pool.nodeTypeId),
					eq(
						schema.pipelineTypeRegistry.version,
						(live.version ?? 1) + 1
					)
				)
			)
	})

	it("archives a field once the version declaring it is no longer pinned", async () => {
		// The converse of the test above, and the one that proves the sweep can
		// archive anything at all.
		//
		// `syncTypeRegistry` inserts and updates but never deletes, so a
		// superseded version's row lives on forever. While the sweep unioned
		// declared fields across EVERY registry row, a field dropped in a new
		// version was still "declared" by the old row sitting beside it — so
		// nothing was ever archived and the whole feature was inert. What makes a
		// declaration count is that some published spec still PINS that version.
		const [live] = await db
			.select()
			.from(schema.pipelineTypeRegistry)
			.where(eq(schema.pipelineTypeRegistry.typeId, pool.nodeTypeId))

		// Drop the field from the row the pipeline actually PINS...
		const slots = JSON.parse(JSON.stringify(live.slots))
		delete slots[pool.slot].fields.postHistoryInstructions
		await db
			.update(schema.pipelineTypeRegistry)
			.set({ slots })
			.where(eq(schema.pipelineTypeRegistry.id, live.id))

		// ...while leaving an UNPINNED newer row that still declares it. This is
		// the pair that discriminates: unioning over every registry row would
		// find the field here and keep it, which is precisely the bug. Nothing
		// points at this version, so its declaration is history.
		await db.insert(schema.pipelineTypeRegistry).values({
			...live,
			id: undefined,
			version: (live.version ?? 1) + 1,
			slots: live.slots
		} as any)

		const p = await createPrompt(db as any, {
			...pool,
			name: "Written before the field went away",
			fields: { systemPrompt: "s", postHistoryInstructions: "keep me" }
		})
		await reconcilePromptFields(db as any)

		const after = await rowOf(p.id)
		expect(after.fields.postHistoryInstructions).toBeUndefined()
		// Archived, not deleted — the text is what the user wrote.
		expect(after.archivedFields.postHistoryInstructions).toBe("keep me")

		// Put the registry back for the tests after this one.
		await db
			.update(schema.pipelineTypeRegistry)
			.set({ slots: live.slots })
			.where(eq(schema.pipelineTypeRegistry.id, live.id))
		await db
			.delete(schema.pipelineTypeRegistry)
			.where(
				and(
					eq(schema.pipelineTypeRegistry.typeId, pool.nodeTypeId),
					eq(
						schema.pipelineTypeRegistry.version,
						(live.version ?? 1) + 1
					)
				)
			)
	})
})

describe("restoring", () => {
	it("moves a key back when the slot declares it again", async () => {
		// The other direction, and the reason nothing is ever deleted: a field
		// dropped in one release and restored in the next must bring its text
		// with it, or the archive is just a slower way of losing the work.
		const p = await createPrompt(db as any, {
			...pool,
			name: "Archive restored",
			fields: { systemPrompt: "s" },
			archivedFields: {
				postHistoryInstructions: "came back",
				narratorName: "still dead here"
			}
		})

		const report = await reconcilePromptFields(db as any)
		const mine = report.find((r) => r.promptId === p.id)
		expect(mine?.restored).toEqual(["postHistoryInstructions"])

		const after = await rowOf(p.id)
		expect(after.fields.postHistoryInstructions).toBe("came back")
		// And the key nothing declares stays archived rather than riding along.
		expect(after.archivedFields).toEqual({
			narratorName: "still dead here"
		})
	})

	it("lets the live text win a collision, and stops finding it", async () => {
		// Only reachable if a slot re-declared a field while the row still
		// carried an archived copy. The live text is the one the panel has been
		// showing and editing, so it stays — and the stale copy is dropped
		// rather than left for the sweep to trip over on every future boot.
		const p = await createPrompt(db as any, {
			...pool,
			name: "Collision",
			fields: { systemPrompt: "the live one" },
			archivedFields: { systemPrompt: "the stale one" }
		})
		await reconcilePromptFields(db as any)
		const after = await rowOf(p.id)
		expect(after.fields.systemPrompt).toBe("the live one")
		expect(after.archivedFields).toEqual({})

		const again = await reconcilePromptFields(db as any)
		expect(again.find((r) => r.promptId === p.id)).toBeUndefined()
	})
})

describe("it is a fixed point", () => {
	it("writes nothing on the second run", async () => {
		// The property that lets this run unconditionally at boot rather than
		// behind a "have we swept yet" flag — a flag that eventually lies.
		await reconcilePromptFields(db as any)
		const before = await db.select().from(schema.pipelinePrompts)
		const second = await reconcilePromptFields(db as any)
		expect(second).toEqual([])
		const after = await db.select().from(schema.pipelinePrompts)
		expect(
			after.map((r: any) => [r.id, r.fields, r.archivedFields])
		).toEqual(before.map((r: any) => [r.id, r.fields, r.archivedFields]))
	})

	it("leaves an edit made between two boots exactly alone", async () => {
		// A key somebody is actively editing is by definition a declared one,
		// which is why "never touch a declared key" is the same rule as "never
		// undo a person's work".
		const p = await createPrompt(db as any, {
			...pool,
			name: "Edited between boots",
			fields: { systemPrompt: "before" }
		})
		await reconcilePromptFields(db as any)
		await db
			.update(schema.pipelinePrompts)
			.set({ fields: { systemPrompt: "after" } })
			.where(eq(schema.pipelinePrompts.id, p.id))
		await reconcilePromptFields(db as any)
		expect((await rowOf(p.id)).fields).toEqual({ systemPrompt: "after" })
	})
})
