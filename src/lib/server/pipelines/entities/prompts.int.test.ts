/**
 * Prompts as a swappable entity, and the two selections they refuse.
 *
 * The refusals are the point. A prompt is chosen from a picker, stored as an
 * id, and dereferenced at run time — so the failure mode this file exists to
 * prevent is a selection that *stores cleanly and does nothing*. Every screen
 * would show the prompt the user chose while the run used something else, and
 * there would be nothing anywhere to look at.
 *
 * Both refusals are therefore hard. Neither degrades to a warning.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { bootstrapPipelines, RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
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
let otherSpecId: number

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db as any)

	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
	specId = spec.id
	specVersionId = spec.activeVersionId!

	const [other] = await db
		.insert(schema.pipelineSpecs)
		.values({ slug: "core:spec/somewhere-else", name: "Somewhere else" })
		.returning()
	otherSpecId = other.id
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
		const { NARRATE_SPEC_ID } = await import(
			"$lib/server/pipelines/specs"
		)
		const [narrate] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, NARRATE_SPEC_ID))

		const reply = await declaredFields(
			db as any,
			specVersionId,
			"context",
			"prompts"
		)
		const narrator = await declaredFields(
			db as any,
			narrate.activeVersionId!,
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
		const { NARRATE_SPEC_ID } = await import(
			"$lib/server/pipelines/specs"
		)
		const [narrate] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, NARRATE_SPEC_ID))
		// Not `declaredFields`: that reads a prompts slot's `fields`, and a
		// variables slot declares `renders`. Asking it for layouts returns an
		// empty list, which would make every "not.toContain" below pass
		// without testing anything.
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const layouts = (await declarations(db as any, narrate.activeVersionId!))
			.filter((d) => d.nodeKey === "context" && d.slot === "variables")
			.map((d) => d.path)
		expect(layouts.length).toBeGreaterThan(0)
		expect(layouts).not.toContain("exampleDialogue")
		expect(layouts).not.toContain("speakerRelationships")
		// Still renders the ones it does produce.
		expect(layouts).toContain("characters")
		expect(layouts).toContain("personaNames")
	})
})

describe("selecting a prompt", () => {
	let good: number

	beforeAll(async () => {
		const p = await createPrompt(db as any, {
			specId,
			name: "Complete",
			fields: {
				systemPrompt: "be helpful",
				postHistoryInstructions: "stay in character",
				narratorName: "Narrator"
			}
		})
		good = p.id
	})

	it("accepts one that covers every declared field", async () => {
		const res = await assertSelectable(
			db as any,
			specId,
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
			specId,
			name: "Generous",
			fields: {
				systemPrompt: "be helpful",
				postHistoryInstructions: "stay in character",
				narratorName: "Narrator",
				somethingElseEntirely: "harmless"
			}
		})
		await expect(
			assertSelectable(
				db as any,
				specId,
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
			specId,
			name: "Half written",
			fields: { systemPrompt: "be helpful" }
		})
		await expect(
			assertSelectable(
				db as any,
				specId,
				specVersionId,
				"context",
				"prompts",
				short.id
			)
		).rejects.toThrow(/postHistoryInstructions/)
	})

	it("refuses one belonging to another namespace", async () => {
		const foreign = await createPrompt(db as any, {
			specId: otherSpecId,
			name: "From elsewhere",
			fields: {
				systemPrompt: "x",
				postHistoryInstructions: "y",
				narratorName: "z"
			}
		})
		await expect(
			assertSelectable(
				db as any,
				specId,
				specVersionId,
				"context",
				"prompts",
				foreign.id
			)
		).rejects.toThrow(PromptNotUsableError)
	})

	it("keeps namespaces out of each other's lists", async () => {
		const mine = await listPrompts(db as any, specId)
		expect(mine.map((p) => p.name)).not.toContain("From elsewhere")
	})
})

describe("editing", () => {
	it("dereferences to the text a run uses", async () => {
		const p = await createPrompt(db as any, {
			specId,
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
			specId,
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

		await updatePrompt(db as any, copy.id, {
			fields: { systemPrompt: "my wording" }
		})
		expect(await resolvePromptFields(db as any, shipped.id)).toEqual({
			systemPrompt: "core's wording"
		})
	})
})

describe("deleting", () => {
	it("deletes an unreferenced copy", async () => {
		const p = await createPrompt(db as any, {
			specId,
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
			specId,
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
			specId,
			name: "Held by an override",
			fields: { systemPrompt: "held" }
		})
		await db.insert(schema.pipelineNodeOverrides).values({
			specId,
			scopeKind: "user",
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
	 * separately, because it is *scoped by the declaration* — this namespace's
	 * prompts, this shape's connections. A panel that fetched "all prompts"
	 * would have to re-derive both rules on the client, and the second copy is
	 * the one that eventually disagrees.
	 */
	it("offers only prompts from this namespace", async () => {
		const { namespaceView } = await import("$lib/server/pipelines/config/panel")
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
			// Written for `core:spec/somewhere-else`, and must not be offered here.
			expect(labels).not.toContain("From elsewhere")
		}
	})

	it("still leaks no node key through the choice list", async () => {
		// The choice labels are user-supplied text, so this is the one place a
		// user could put a node key into the payload themselves. Labels are prose
		// and exempt; the property names around them are not, and that is what
		// this re-checks now that the payload has a new shape.
		const { namespaceView } = await import("$lib/server/pipelines/config/panel")
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
			specId,
			name: "Selected then deleted",
			fields: { systemPrompt: "mine" }
		})

		// Two references: the caller's own, and somebody else's.
		const [mine] = await db
			.insert(schema.pipelineNodeOverrides)
			.values({
				specId,
				scopeKind: "user",
				scopeId: 1,
				nodeKey: "context",
				slot: "prompts",
				path: "",
				value: p.id
			})
			.returning()
		await db.insert(schema.pipelineNodeOverrides).values({
			specId,
			scopeKind: "user",
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
