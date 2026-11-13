/**
 * The write side of the pub's layout and layout references
 * (PLAN variable-layouts 2026-11-10): `setPubLayout`, create/update with a
 * reference, `stampReference`, and the refusals that keep a layout while it is
 * the pub's, a preset's choice or a leftover pick.
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	createVariableTemplate,
	deleteVariableTemplate,
	layoutByReference,
	presetVariableLayoutsOf,
	pubLayoutOf,
	setPubLayout,
	stampReference,
	updateVariableTemplate,
	variableSlotNames,
	VariableTemplateNotUsableError
} from "$lib/server/pipelines/entities/variableTemplates"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

const CHARS = "core:var/characters@1"
const PERS = "core:var/personas@1"
const SOURCE = "{{{json characters}}}"

let db: TestDb

const make = (
	name: string,
	extra: Record<string, unknown> = {},
	variableId = CHARS
) => createVariableTemplate(db, { variableId, name, source: SOURCE, ...extra })
const rowOf = async (id: number) =>
	(
		await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.id, id))
	)[0]!

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import("../boot/bootstrap")
	await bootstrapPipelines(db)
})

describe("variableSlotNames", () => {
	it("reads the registry's variables slots of the active specs, not the panel's controls", async () => {
		expect(await variableSlotNames(db)).toContain("variables")
	})
})

describe("references on create and update", () => {
	it("builds the reference from owner, slug and the variable's major", async () => {
		const row = await make("Prose", {
			reference: { ownerSlug: "acme", slug: "prose" }
		})
		expect(row.reference).toBe("acme/prose@1")
		expect(await layoutByReference(db, CHARS, "acme/prose@1")).toBe(row.id)
	})

	it("refuses a malformed reference and a taken one, in words", async () => {
		await expect(
			make("Bad", { reference: { ownerSlug: "Acme Co", slug: "Prose!" } })
		).rejects.toThrow(/not a valid layout reference/)
		await expect(
			make("Again", { reference: { ownerSlug: "acme", slug: "prose" } })
		).rejects.toThrow(/already goes by 'acme\/prose@1'/)
		// The same name on another variable is fine: unique within its variable.
		await expect(
			make(
				"Prose",
				{ reference: { ownerSlug: "acme", slug: "prose" } },
				PERS
			)
		).resolves.toBeTruthy()
	})

	it("fixes a reference once saved, and gives one to a row that has none", async () => {
		const withRef = await make("Fixed", {
			reference: { ownerSlug: "acme", slug: "fixed" }
		})
		await expect(
			updateVariableTemplate(db, withRef.id, {
				reference: { ownerSlug: "acme", slug: "other" }
			})
		).rejects.toThrow(/fixed once/)
		await expect(
			updateVariableTemplate(db, withRef.id, {
				reference: { ownerSlug: "acme", slug: "fixed" },
				name: "Fixed too"
			})
		).resolves.toBeUndefined()
		const bare = await make("Bare")
		expect(bare.reference).toBeNull()
		await updateVariableTemplate(db, bare.id, {
			reference: { ownerSlug: "acme", slug: "bare" }
		})
		expect((await rowOf(bare.id)).reference).toBe("acme/bare@1")
	})

	it("stamps an older row from its name, refusing a taken reference", async () => {
		const old = await make("Old Style Cast")
		const stamped = await stampReference(db, old.id, "acme")
		expect(stamped.reference).toBe("acme/old-style-cast@1")
		await expect(stampReference(db, old.id, "acme")).rejects.toThrow(
			/fixed once/
		)
		const twin = await make("Old style cast!")
		await expect(stampReference(db, twin.id, "acme")).rejects.toThrow(
			/already goes by/
		)
	})
})

describe("the owner slug core belongs to Serene Pub", () => {
	it("is refused, in words, on a person's create, stamp and update", async () => {
		await expect(
			make("Mine A", { reference: { ownerSlug: "core", slug: "mine-a" } })
		).rejects.toThrow(
			/core is Serene Pub's own\. Use an owner slug of your own\./
		)
		await expect(
			make("Mine A", { reference: { ownerSlug: "core", slug: "mine-a" } })
		).rejects.toBeInstanceOf(VariableTemplateNotUsableError)

		const old = await make("Mine B")
		await expect(stampReference(db, old.id, "core")).rejects.toThrow(
			/core is Serene Pub's own/
		)
		expect((await rowOf(old.id)).reference).toBeNull()

		await expect(
			updateVariableTemplate(db, old.id, {
				reference: { ownerSlug: "core", slug: "mine-b" }
			})
		).rejects.toThrow(/core is Serene Pub's own/)
		expect((await rowOf(old.id)).reference).toBeNull()
	})

	it("still passes for a shipped row (a seed key or immutable)", async () => {
		const shipped = await make("Shipped C", {
			seedKey: "test:shipped-c",
			isImmutable: true,
			reference: { ownerSlug: "core", slug: "shipped-c" }
		})
		expect(shipped.reference).toBe("core/shipped-c@1")
		const seeded = await make("Seeded D", {
			seedKey: "test:seeded-d",
			reference: { ownerSlug: "core", slug: "seeded-d" }
		})
		expect(seeded.reference).toBe("core/seeded-d@1")
	})
})

describe("the pub's layout", () => {
	it("is chosen in one step, replaced, and cleared back to the package's default", async () => {
		const a = await make("Pub A")
		const b = await make("Pub B")
		await setPubLayout(db, CHARS, a.id)
		expect(await pubLayoutOf(db, CHARS)).toBe(a.id)
		await setPubLayout(db, CHARS, b.id)
		expect(await pubLayoutOf(db, CHARS)).toBe(b.id)
		expect((await rowOf(a.id)).pubDefault).toBe(false)
		await setPubLayout(db, CHARS, null)
		expect(await pubLayoutOf(db, CHARS)).toBeNull()
	})

	it("refuses a row of another variable and a withdrawn one, in words", async () => {
		const other = await make("Personas thing", {}, PERS)
		await expect(setPubLayout(db, CHARS, other.id)).rejects.toThrow(
			/lays out something else/
		)
		const gone = await make("Withdrawn")
		await db
			.update(schema.pipelineVariableTemplates)
			.set({ withdrawnAt: new Date() })
			.where(eq(schema.pipelineVariableTemplates.id, gone.id))
		await expect(setPubLayout(db, CHARS, gone.id)).rejects.toThrow(
			/switched off/
		)
		expect(await pubLayoutOf(db, CHARS)).toBeNull()
	})

	it("create with useEverywhere makes it the pub's layout in the same step", async () => {
		const first = await make("Everywhere", { useEverywhere: true })
		expect(first.pubDefault).toBe(true)
		expect(await pubLayoutOf(db, CHARS)).toBe(first.id)
		const second = await make("Everywhere 2", { useEverywhere: true })
		expect(await pubLayoutOf(db, CHARS)).toBe(second.id)
		expect((await rowOf(first.id)).pubDefault).toBe(false)
		// A refused create leaves the pub's layout where it was.
		await expect(
			make("Broken", { useEverywhere: true, source: "{{#each" })
		).rejects.toThrow()
		expect(await pubLayoutOf(db, CHARS)).toBe(second.id)
		await setPubLayout(db, CHARS, null)
	})
})

describe("deleting a layout that something still holds", () => {
	it("refuses while it is the pub's layout", async () => {
		const row = await make("Held by pub")
		await setPubLayout(db, CHARS, row.id)
		await expect(deleteVariableTemplate(db, row.id)).rejects.toThrow(
			/pub's layout/
		)
		await setPubLayout(db, CHARS, null)
		await expect(
			deleteVariableTemplate(db, row.id)
		).resolves.toBeUndefined()
	})

	it("refuses while a preset chose it, naming the preset", async () => {
		const row = await make("Held by preset", {
			reference: { ownerSlug: "acme", slug: "held-by-preset" }
		})
		const [preset] = await db
			.insert(schema.sessionPresets)
			.values({
				name: "Small model",
				genreId: "core:genre/story",
				variableLayouts: { [CHARS]: row.reference! }
			})
			.returning()
		expect(await presetVariableLayoutsOf(db, preset!.id)).toEqual({
			[CHARS]: "acme/held-by-preset@1"
		})
		const err = await deleteVariableTemplate(db, row.id).catch((e) => e)
		expect(err).toBeInstanceOf(VariableTemplateNotUsableError)
		expect(String(err.message)).toContain("'Small model'")
		await db
			.update(schema.sessionPresets)
			.set({ variableLayouts: {} })
			.where(eq(schema.sessionPresets.id, preset!.id))
		await expect(
			deleteVariableTemplate(db, row.id)
		).resolves.toBeUndefined()
	})

	it("refuses while a leftover pick holds it", async () => {
		const row = await make("Held by pick")
		const [reg] = await db
			.insert(schema.registrations)
			.values({
				scopeKind: "genre",
				scopeRef: "core:genre/story",
				key: "admin:test-leftover",
				origin: "admin",
				values: { assemble: { variables: { characters: row.id } } }
			})
			.returning()
		await expect(deleteVariableTemplate(db, row.id)).rejects.toThrow(
			/still in use/
		)
		await db
			.delete(schema.registrations)
			.where(eq(schema.registrations.id, reg!.id))
		await expect(
			deleteVariableTemplate(db, row.id)
		).resolves.toBeUndefined()
	})

	it("refuses while a context template names it by reference, naming the template", async () => {
		const row = await make("Named by template", {
			reference: { ownerSlug: "acme", slug: "named-by-template" }
		})
		const [tpl] = await db
			.insert(schema.pipelineContextTemplates)
			.values({
				nodeDefinitionId: "core:task/assemble",
				name: "Cast first",
				engine: "core:template/handlebars@1",
				source: `{{{layout characters "${row.reference}"}}}`
			} as any)
			.returning()
		const err = await deleteVariableTemplate(db, row.id).catch((e) => e)
		expect(err).toBeInstanceOf(VariableTemplateNotUsableError)
		expect(String(err.message)).toContain("'Cast first'")
		await db
			.delete(schema.pipelineContextTemplates)
			.where(eq(schema.pipelineContextTemplates.id, tpl!.id))
		await expect(
			deleteVariableTemplate(db, row.id)
		).resolves.toBeUndefined()
	})
})
