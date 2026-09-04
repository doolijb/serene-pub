/**
 * Prompts as a swappable entity, and what the pool does and does not refuse.
 *
 * The refusals are the point. A prompt is chosen from a picker, stored as an
 * id, and dereferenced at run time — so the failure mode this file exists to
 * prevent is a selection that *stores cleanly and does nothing*. Every screen
 * would show the prompt the user chose while the run used something else, and
 * there would be nothing anywhere to look at.
 *
 * ## What changed when prompts stopped being namespaced
 *
 * The old file's central claim was "a prompt written for one pipeline is
 * refused in another". That claim is now **false on purpose**: a prompt follows
 * the node that consumes it, so a pipeline reusing that node is meant to be
 * offered the same rows. The separation it was protecting is still here and is
 * stronger, because it comes from the node type rather than from a column
 * somebody has to keep pointing at the right spec — a reply's wording cannot
 * reach a summarizer's picker no matter how many pipelines are involved, since
 * `build-template-context` and `summarize-batch` are different types.
 *
 * So the two properties tested here are the two halves of that trade:
 *
 *  1. **It travels.** A prompt written against a node is offered wherever that
 *     node is reused, with nothing seeded and nothing copied.
 *  2. **It does not leak.** A prompt from another pool is refused, and the
 *     refusal names the step rather than the pipeline.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	bootstrapPipelines,
	RESPOND_SPEC_ID
} from "$lib/server/pipelines/boot/bootstrap"
import {
	assertSelectable,
	createPrompt,
	declaredFields,
	duplicatePrompt,
	listPrompts,
	resolvePromptFields,
	updatePrompt,
	deletePrompt,
	PromptNotFoundError,
	PromptNotUsableError
} from "$lib/server/pipelines/entities/prompts"

let db: TestDb
let specId: number
let specVersionId: number
/** The reply pipeline's context pool — `(node type, slot)`, discovered not typed. */
let pool: { nodeTypeId: string; slot: string }
/** The narrator's, which is a different node type and therefore a different pool. */
let narratorPool: { nodeTypeId: string; slot: string }
let narrateVersionId: number

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db as any)

	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
	specId = spec.id
	specVersionId = spec.activeVersionId!

	// Read off the declarations rather than written down here. The pool is the
	// thing under test; a hardcoded type id would keep passing on the day the
	// wiring stopped producing one.
	const { declarations } = await import("$lib/server/pipelines/config/panel")
	const decl = (await declarations(db as any, specVersionId)).find(
		(d) => d.nodeKey === "context" && d.control === "prompts-ref"
	)!
	pool = { nodeTypeId: decl.nodeTypeId!, slot: decl.slot }

	const { NARRATE_SPEC_ID } = await import("$lib/server/pipelines/specs")
	const [narrate] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, NARRATE_SPEC_ID))
	narrateVersionId = narrate.activeVersionId!
	const nDecl = (await declarations(db as any, narrateVersionId)).find(
		(d) => d.control === "prompts-ref"
	)!
	narratorPool = { nodeTypeId: nDecl.nodeTypeId!, slot: nDecl.slot }
}, 60_000)

describe("what a node declares", () => {
	it("reports the text fields from the descriptor, not from a list in core", async () => {
		// The property that makes a plugin's node work: the field set comes from
		// the registry row, so core needs to know nothing about it in advance.
		const fields = await declaredFields(
			db as any,
			specVersionId,
			"context",
			"prompts"
		)
		expect(fields).toContain("systemPrompt")
		expect(fields).toContain("postHistoryInstructions")
	})

	it("gives each pipeline only its own fields", async () => {
		// The reply pipeline and the narrator share an implementation and every
		// node key, so for a while they shared one type — and the panel, which
		// is generated from the registry row, showed each of them the other's
		// controls. Every reply prompt carried an empty `narratorName`. Two
		// surfaces is two types; this is the assertion that says so.
		const reply = await declaredFields(
			db as any,
			specVersionId,
			"context",
			"prompts"
		)
		const narrator = await declaredFields(
			db as any,
			narrateVersionId,
			"context",
			"prompts"
		)
		expect(reply).not.toContain("narratorName")
		expect(narrator).toContain("narratorName")
	})

	it("gives the narrator no layout it cannot fill", async () => {
		// `exampleDialogue` is read off the speaking character a narrator does
		// not have, and `speakerRelationships` is never supplied by the narrate
		// spec at all. Offering either is a control wired to nothing.
		//
		// Not `declaredFields`: that reads a prompts slot's `fields`, and a
		// variables slot declares `renders`. Asking it for layouts returns an
		// empty list, which would make every "not.toContain" below pass
		// without testing anything.
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const layouts = (await declarations(db as any, narrateVersionId))
			.filter((d) => d.nodeKey === "context" && d.slot === "variables")
			.map((d) => d.path)
		expect(layouts.length).toBeGreaterThan(0)
		expect(layouts).not.toContain("exampleDialogue")
		expect(layouts).not.toContain("speakerRelationships")
		// Still renders the ones it does produce.
		expect(layouts).toContain("characters")
		expect(layouts).toContain("personaNames")
	})

	it("puts the pool on the declaration, both halves", async () => {
		// The half that used to be missing. Without `nodeTypeId` on a
		// prompts-ref the picker has nothing to narrow by, and every prompt on
		// the instance is a candidate for every step.
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		for (const d of await declarations(db as any, specVersionId))
			if (d.control === "prompts-ref") {
				expect(d.nodeTypeId, `${d.nodeKey}.${d.slot} has no pool`).toBeTruthy()
				// Unversioned — a type bump must not strand the prompts a
				// person wrote against the old one.
				expect(d.nodeTypeId).not.toMatch(/@\d+$/)
				expect(d.slot).toBeTruthy()
			}
	})
})

describe("selecting a prompt", () => {
	let good: number

	beforeAll(async () => {
		const p = await createPrompt(db as any, {
			...pool,
			createdForSpecId: specId,
			name: "Complete",
			fields: {
				systemPrompt: "be helpful",
				postHistoryInstructions: "stay in character"
			}
		})
		good = p.id
	})

	it("accepts one that covers every declared field", async () => {
		const res = await assertSelectable(
			db as any,
			specVersionId,
			"context",
			"prompts",
			good
		)
		expect(res.name).toBe("Complete")
	})

	it("accepts one that has more than the slot asks for", async () => {
		// Extra keys are inert. Refusing them would make a prompt written for a
		// richer node unusable on a simpler one, for no gain.
		const extra = await createPrompt(db as any, {
			...pool,
			name: "Generous",
			fields: {
				systemPrompt: "be helpful",
				postHistoryInstructions: "stay in character",
				somethingElseEntirely: "harmless"
			}
		})
		await expect(
			assertSelectable(
				db as any,
				specVersionId,
				"context",
				"prompts",
				extra.id
			)
		).resolves.toBeTruthy()
	})

	it("refuses one missing a field the step needs, and names the field", async () => {
		// Falling short is not inert: the node renders a blank where it expects
		// text, which reads as the model ignoring an instruction.
		const short = await createPrompt(db as any, {
			...pool,
			name: "Half written",
			fields: { systemPrompt: "be helpful" }
		})
		await expect(
			assertSelectable(
				db as any,
				specVersionId,
				"context",
				"prompts",
				short.id
			)
		).rejects.toThrow(/postHistoryInstructions/)
	})

	it("refuses one from another pool, and blames the step rather than the pipeline", async () => {
		// The narrator's context node is a different type, so its prompts are a
		// different pool — which is how a reply's wording is kept out of a
		// summarizer's picker now that nothing is namespaced to a spec.
		const foreign = await createPrompt(db as any, {
			...narratorPool,
			name: "From another kind of step",
			fields: {
				systemPrompt: "x",
				postHistoryInstructions: "y",
				narratorName: "z"
			}
		})
		await expect(
			assertSelectable(
				db as any,
				specVersionId,
				"context",
				"prompts",
				foreign.id
			)
		).rejects.toThrow(PromptNotUsableError)
		// The wording matters: "a different pipeline" is no longer true of
		// anything, and telling somebody that would send them looking for a
		// setting that does not exist.
		await expect(
			assertSelectable(
				db as any,
				specVersionId,
				"context",
				"prompts",
				foreign.id
			)
		).rejects.toThrow(/different kind of step/)
	})

	it("keeps one pool's rows out of another's list", async () => {
		const mine = await listPrompts(
			db as any,
			pool.nodeTypeId,
			pool.slot,
			specId
		)
		expect(mine.map((p) => p.name)).not.toContain(
			"From another kind of step"
		)
		expect(mine.map((p) => p.name)).toContain("Complete")
	})
})

/**
 * The prize, stated as a test.
 *
 * An action that reuses a node inherits its prompts with no seed, no copy and
 * no code — and a pipeline built from other nodes is offered none of them. This
 * is the property the whole re-keying exists for, and it is the one whose
 * absence would be silent: the panel would simply show a shorter list.
 */
describe("a prompt follows its node", () => {
	it("is offered to a second pipeline that reuses the same node", async () => {
		// A second published pipeline is not needed to state this: what the
		// picker narrows by is the pool, so a row created against the pool is
		// visible to *any* caller asking about that pool — which is exactly what
		// a reusing pipeline's declaration produces.
		const mine = await createPrompt(db as any, {
			...pool,
			createdForSpecId: specId,
			name: "Written while configuring replies",
			fields: {
				systemPrompt: "s",
				postHistoryInstructions: "p"
			}
		})

		// Asked as some *other* pipeline would ask: same pool, different spec.
		const elsewhere = await listPrompts(
			db as any,
			pool.nodeTypeId,
			pool.slot,
			specId + 10_000
		)
		const seen = elsewhere.find((p) => p.id === mine.id)
		expect(
			seen,
			"a prompt stopped following its node into another pipeline"
		).toBeTruthy()
		// Offered, and honestly labelled: it says where it came from rather
		// than pretending it was written here.
		expect(seen!.group).toBe("alsoFits")
		expect(seen!.originSlug).toBe(RESPOND_SPEC_ID)
	})

	it("sorts the pipeline's own first, then shipped, then everything else", async () => {
		const rows = await listPrompts(
			db as any,
			pool.nodeTypeId,
			pool.slot,
			specId
		)
		const rank = { usedHere: 0, shipped: 1, alsoFits: 2 } as const
		const seen = rows.map((r) => rank[r.group])
		expect(seen).toEqual([...seen].sort((a, b) => a - b))
	})

	it("offers nothing to a pool nobody has written for", async () => {
		const rows = await listPrompts(
			db as any,
			"plugin:task/nothing-here",
			"prompts",
			specId
		)
		expect(rows).toEqual([])
	})
})

describe("editing", () => {
	it("dereferences to the text a run uses", async () => {
		const p = await createPrompt(db as any, {
			...pool,
			name: "Dereference me",
			fields: { systemPrompt: "the words themselves" }
		})
		expect(await resolvePromptFields(db as any, p.id)).toEqual({
			systemPrompt: "the words themselves"
		})
	})

	it("refuses to edit a shipped prompt, and says what to do instead", async () => {
		// Same rule as the shipped config: the thing a copy was derived from has
		// to keep meaning what it meant.
		const shipped = await createPrompt(db as any, {
			...pool,
			name: "Shipped",
			isImmutable: true,
			fields: { systemPrompt: "core's wording" }
		})
		await expect(
			updatePrompt(db as any, shipped.id, { name: "mine now" })
		).rejects.toThrow(/[Dd]uplicate/)
	})

	it("duplicates for editing, leaving the original pointed-at", async () => {
		const [shipped] = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.name, "Shipped"))

		const copy = await duplicatePrompt(db as any, shipped.id, "My version")
		expect(copy.fields).toEqual(shipped.fields)
		expect(copy.isImmutable).toBe(false)
		// Into the same pool, or the copy would be unselectable at the very
		// control the Duplicate button sits on.
		expect(copy.nodeTypeId).toBe(shipped.nodeTypeId)
		expect(copy.slot).toBe(shipped.slot)

		await updatePrompt(db as any, copy.id, {
			fields: { systemPrompt: "my wording" }
		})
		expect(await resolvePromptFields(db as any, shipped.id)).toEqual({
			systemPrompt: "core's wording"
		})
	})

	it("carries the archive onto a copy, which is the recovery path", async () => {
		// The ruling's own words: recover or archive the text "so the user can
		// reference/copy it to a different pipeline/node later". A duplicate
		// that dropped the archive would make that impossible from any screen.
		const p = await createPrompt(db as any, {
			...pool,
			name: "Has an archive",
			fields: { systemPrompt: "live" },
			archivedFields: { narratorName: "an afternoon's work" }
		})
		const copy = await duplicatePrompt(db as any, p.id, "Archive carrier")
		expect(copy.archivedFields).toEqual({
			narratorName: "an afternoon's work"
		})
	})

	it("will not let a patch reach the archive", async () => {
		// `updatePrompt` names its two writable fields rather than spreading the
		// patch, because a patch is shaped by a socket payload and the archive
		// is the one column whose purpose is to hold text the panel does NOT
		// render. A caller able to write it could destroy the only copy of a
		// field the slot no longer declares.
		const p = await createPrompt(db as any, {
			...pool,
			name: "Archive is not writable",
			fields: { systemPrompt: "live" },
			archivedFields: { narratorName: "keep me" }
		})
		await updatePrompt(db as any, p.id, {
			name: "renamed",
			archivedFields: { narratorName: "clobbered" }
		} as any)
		const [after] = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.id, p.id))
		expect(after.name).toBe("renamed")
		expect(after.archivedFields).toEqual({ narratorName: "keep me" })
	})
})

describe("deleting", () => {
	it("deletes an unreferenced copy", async () => {
		const p = await createPrompt(db as any, {
			...pool,
			name: "Disposable",
			fields: { systemPrompt: "gone soon" }
		})
		await deletePrompt(db as any, p.id)
		const rows = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.id, p.id))
		expect(rows).toHaveLength(0)
	})

	it("refuses a shipped prompt", async () => {
		const [shipped] = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.name, "Shipped"))
		await expect(deletePrompt(db as any, shipped.id)).rejects.toThrow(
			PromptNotUsableError
		)
	})

	it("refuses one a named config still points at", async () => {
		// A config value holding the id of a deleted row is a selection that
		// stores cleanly and does nothing — the exact failure this file's
		// header promises to refuse.
		const p = await createPrompt(db as any, {
			...pool,
			name: "Held by a config",
			fields: { systemPrompt: "held" }
		})
		const [config] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId, name: "Holds a prompt" })
			.returning()
		await db.insert(schema.pipelineConfigValues).values({
			configId: config.id,
			nodeKey: "context",
			slot: "prompts",
			path: "",
			value: p.id
		})
		await expect(deletePrompt(db as any, p.id)).rejects.toThrow(
			/still selected/
		)
	})

	it("refuses one an override still points at, then allows after the reference moves", async () => {
		const p = await createPrompt(db as any, {
			...pool,
			name: "Held by an override",
			fields: { systemPrompt: "held" }
		})
		await db.insert(schema.pipelineNodeOverrides).values({
			specId,
			scopeKind: "session",
			scopeId: 1,
			nodeKey: "context",
			slot: "prompts",
			path: "",
			value: p.id,
			updatedBy: 1
		})
		await expect(deletePrompt(db as any, p.id)).rejects.toThrow(
			/still selected/
		)

		// Point the override elsewhere; the delete now goes through.
		await db
			.delete(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.specId, specId))
		await deletePrompt(db as any, p.id)
	})

	it("says so when the prompt is already gone", async () => {
		await expect(deletePrompt(db as any, 999_999)).rejects.toThrow(
			PromptNotFoundError
		)
	})
})

describe("what the picker is sent", () => {
	/**
	 * The choice list travels with the option rather than being fetched
	 * separately, because it is *scoped by the declaration* — this pool's
	 * prompts, this shape's connections. A panel that fetched "all prompts"
	 * would have to re-derive both rules on the client, and the second copy is
	 * the one that eventually disagrees.
	 */
	it("offers only prompts from this step's pool", async () => {
		const { namespaceView } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const view = await namespaceView(
			db as any,
			"prompt-picker-test-secret",
			RESPOND_SPEC_ID,
			{ userId: 1, isAdmin: true }
		)
		const refs = view!.steps
			.flatMap((s) => [...s.options, ...s.advanced])
			.filter((o) => o.control === "prompts-ref")
		expect(refs.length).toBeGreaterThan(0)

		for (const ref of refs) {
			expect(ref.choices).toBeTruthy()
			const labels = ref.choices!.map((c) => c.label)
			expect(labels).toContain("Complete")
			// Written against the narrator's node, and must not be offered here.
			expect(labels).not.toContain("From another kind of step")
		}
	})

	it("still leaks no node key through the choice list", async () => {
		// The choice labels are user-supplied text, so this is the one place a
		// user could put a node key into the payload themselves. Labels are prose
		// and exempt; the property names around them are not, and that is what
		// this re-checks now that the payload has a new shape.
		const { namespaceView } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const keys = (
			await db
				.select({ nodeKey: schema.pipelineNodes.nodeKey })
				.from(schema.pipelineNodes)
		).map((k: any) => k.nodeKey)

		const view = await namespaceView(
			db as any,
			"prompt-picker-test-secret",
			RESPOND_SPEC_ID,
			{ userId: 1, isAdmin: true }
		)
		for (const option of view!.steps.flatMap((s) => [
			...s.options,
			...s.advanced
		]))
			for (const choice of option.choices ?? [])
				for (const k of Object.keys(choice))
					for (const nodeKey of keys)
						expect(
							new RegExp(`\\b${nodeKey}\\b`).test(k),
							`choice property '${k}' is named for a node`
						).toBe(false)
	})
})

/**
 * Deleting the prompt you currently have selected.
 *
 * Delete sits beside the *selected* prompt, and selecting is itself a
 * reference — so without an exemption the button is unreachable. The exemption
 * has to be told to the delete rather than applied before it: an earlier
 * version released the caller's rows first and then attempted the delete, so a
 * **refused** delete reset the selection on its way to failing. The prompt
 * survived, the choice did not, and nothing said so.
 */
describe("deleting what you have selected", () => {
	it("ignores the caller's own rows without releasing them first", async () => {
		const p = await createPrompt(db as any, {
			...pool,
			name: "Selected then deleted",
			fields: { systemPrompt: "mine" }
		})

		// Two references: the caller's own, and somebody else's.
		const [mine] = await db
			.insert(schema.pipelineNodeOverrides)
			.values({
				specId,
				scopeKind: "session",
				scopeId: 1,
				nodeKey: "context",
				slot: "prompts",
				path: "",
				value: p.id
			})
			.returning()
		await db.insert(schema.pipelineNodeOverrides).values({
			specId,
			scopeKind: "session",
			scopeId: 2,
			nodeKey: "context",
			slot: "prompts",
			path: "",
			value: p.id
		})

		const ignore = { ignoreOverrideIds: new Set([mine.id]) }

		// Still refused — the other user's selection holds it alive.
		await expect(deletePrompt(db as any, p.id, ignore)).rejects.toThrow(
			/still selected/
		)

		// And the caller's row is untouched by the refusal, which is the part
		// that regressed.
		const after = await db
			.select()
			.from(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.id, mine.id))
		expect(after.length).toBe(1)

		// With the other reference gone, the caller's own no longer blocks it.
		await db
			.delete(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.scopeId, 2))
		await expect(
			deletePrompt(db as any, p.id, ignore)
		).resolves.toBeUndefined()
	})
})
