/**
 * Variable layouts, sockets part 2 (PLAN variable-layouts 2026-11-10, W3
 * writes and W4 leftover picks): the library's variable-layout writes carry a
 * reference and *use everywhere*; the pipeline step's ⏳ leftover picks are
 * read, removed (**Remove this pick**) and moved into the step's context template
 * (**Move into the template**), all admin-only.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { getVariable } from "@serene-pub/sdk"
import { variableLayoutCalls } from "@serene-pub/sdk/template-check"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { stepKeyFor } from "$lib/server/pipelines/config/panel/ids"
import { STORY_RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"

const WORLD_LORE = "core:var/world-lore@1"
const CHARACTER_LORE = "core:var/character-lore@1"
const CURRENT_DATE = "core:var/current-date@1"
const SLUG = STORY_RESPOND_SPEC_ID
const GENRE = "core:genre/story"
const KEY = "message-respond→story-respond"
/** Storage is by node key; the wire carries the panel's opaque step handle. */
const STEP = { nodeKey: "prompt", slot: "variables" }
const SECRET = "leftover-picks-test-secret"
const WIRE = { stepKey: stepKeyFor(SECRET, "prompt"), slot: "variables" }

let db: TestDb
let dataDir: string
let admin: { id: number }
let member: { id: number }

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "leftover-picks-test-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-leftover-picks-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await (
		await import("$lib/server/pipelines/boot/bootstrap")
	).bootstrapPipelines(db as any)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	admin = await createTestUser(db, "leftover-admin")
	member = await createTestUser(db, "leftover-member")
	await db
		.update(schema.users)
		.set({ isAdmin: true })
		.where(eq(schema.users.id, admin.id))
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socketFor = (userId: number, isAdmin: boolean) =>
	({
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	}) as any
const asAdmin = () => socketFor(admin.id, true)
const asMember = () => socketFor(member.id, false)

function recorder() {
	const seen: Array<[string, any]> = []
	return {
		emit: (event: string, data: any) => seen.push([event, data]),
		last: (event: string) => seen.filter(([e]) => e === event).at(-1)?.[1]
	}
}

const call = async (name: string, socket: any, params: any) => {
	const handlers = await import("./pipelines")
	const rec = recorder()
	const res: any = await (handlers as any)[name].handler(
		socket,
		params,
		rec.emit
	)
	return { res, rec }
}

const variableRow = async (
	variableId: string,
	name: string,
	extra: object = {}
) => {
	const { createVariableTemplate } = await import(
		"$lib/server/pipelines/entities/variableTemplates"
	)
	return createVariableTemplate(
		db as any,
		{
			variableId,
			name,
			source: `${name} {{{json value}}}`,
			...extra
		} as any
	)
}

/** A pick stored at the genre's defaults — what the old panel wrote. */
const pickAtGenre = async (key: string, templateId: number | undefined) => {
	const { setPipelineGenreValue } = await import(
		"$lib/server/pipelines/registrations/genreValues"
	)
	await setPipelineGenreValue(
		db as any,
		SLUG,
		{ ...STEP, path: key },
		templateId
	)
}

const stepsOf = async (params: object = {}) => {
	const { res } = await call("pipelinesLeftoverPicks", asAdmin(), {
		slug: SLUG,
		...params
	})
	return res.steps as any[]
}

describe("library writes, variable kind", () => {
	test("create takes a reference and use-everywhere; the library rows carry both", async () => {
		const { res, rec } = await call(
			"pipelinesLibraryCreateTemplate",
			asAdmin(),
			{
				kind: "variable",
				poolId: WORLD_LORE,
				name: "Prose it",
				source: "{{{json value}}}",
				reference: { ownerSlug: "acme", slug: "prose-it" },
				useEverywhere: true
			}
		)
		expect(res.error).toBeUndefined()
		expect(rec.last("pipelines:libraryCreateTemplate")).toEqual(res)
		const row = res.library.variableTemplates.find(
			(t: any) => t.id === res.createdId
		)
		expect(row).toMatchObject({
			reference: "acme/prose-it@1",
			pubDefault: true
		})
		// A shipped row has a reference too and is not the pub's.
		const others = res.library.variableTemplates.filter(
			(t: any) => t.poolId === WORLD_LORE && t.id !== res.createdId
		)
		expect(others.every((t: any) => t.pubDefault === false)).toBe(true)
	}, 60_000)

	test("update refuses a changed reference, in words, and accepts the same one", async () => {
		const [row] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(
				eq(
					schema.pipelineVariableTemplates.reference,
					"acme/prose-it@1"
				)
			)
		const refused = await call(
			"pipelinesLibraryUpdateTemplate",
			asAdmin(),
			{
				kind: "variable",
				id: row!.id,
				reference: { ownerSlug: "acme", slug: "something-else" }
			}
		)
		expect(refused.res.error).toMatch(/already goes by 'acme\/prose-it@1'/)
		expect(
			refused.rec.last("pipelines:libraryUpdateTemplate:error")
		).toEqual(refused.res)
		const same = await call("pipelinesLibraryUpdateTemplate", asAdmin(), {
			kind: "variable",
			id: row!.id,
			reference: { ownerSlug: "acme", slug: "prose-it" }
		})
		expect(same.res.error).toBeUndefined()
	}, 60_000)

	test("delete is refused while the layout is the pub's", async () => {
		const [row] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(
				eq(
					schema.pipelineVariableTemplates.reference,
					"acme/prose-it@1"
				)
			)
		const { res } = await call(
			"pipelinesLibraryDeleteTemplate",
			asAdmin(),
			{
				kind: "variable",
				id: row!.id
			}
		)
		expect(res.error).toMatch(/pub's layout/i)
		const [still] = await db
			.select({ id: schema.pipelineVariableTemplates.id })
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.id, row!.id))
		expect(still).toBeDefined()
		// Handed back to the package's default, it can go.
		const { setPubLayout } = await import(
			"$lib/server/pipelines/entities/variableTemplates"
		)
		await setPubLayout(db as any, WORLD_LORE, null)
		const gone = await call("pipelinesLibraryDeleteTemplate", asAdmin(), {
			kind: "variable",
			id: row!.id
		})
		expect(gone.res.error).toBeUndefined()
	}, 60_000)

	test("a member is refused each write", async () => {
		for (const [name, params] of [
			[
				"pipelinesLibraryCreateTemplate",
				{ kind: "variable", poolId: WORLD_LORE }
			],
			["pipelinesLibraryUpdateTemplate", { kind: "variable", id: 1 }],
			["pipelinesLibraryDeleteTemplate", { kind: "variable", id: 1 }]
		] as const) {
			const { res } = await call(name, asMember(), params)
			expect(res.error).toMatch(/Only admin/)
		}
	}, 60_000)
})

describe("pipelines:leftoverPicks, :clearLeftoverPick", () => {
	test("a member is refused each event", async () => {
		for (const name of [
			"pipelinesLeftoverPicks",
			"pipelinesClearLeftoverPick",
			"pipelinesMoveLeftoversIntoTemplate",
			"pipelinesStampVariableTemplateReference"
		])
			expect(
				(await call(name, asMember(), { slug: SLUG })).res.error
			).toMatch(/Only admin/)
	}, 60_000)

	test("answers and refusals echo the asker's slug, sessionId and presetId, each only when sent", async () => {
		for (const name of [
			"pipelinesLeftoverPicks",
			"pipelinesClearLeftoverPick",
			"pipelinesMoveLeftoversIntoTemplate"
		]) {
			const sent = { slug: SLUG, sessionId: 9999, presetId: 8888 }
			const gate = await call(name, asMember(), sent)
			expect(gate.res).toMatchObject({
				...sent,
				error: expect.any(String)
			})
			expect(
				gate.rec.last(
					`pipelines:${name.slice(9, 10).toLowerCase()}${name.slice(10)}:error`
				)
			).toMatchObject(sent)
			const slugOnly = await call(name, asMember(), { slug: SLUG })
			expect(slugOnly.res).toEqual({
				slug: SLUG,
				error: expect.any(String)
			})
			// The work itself (an answer or a refusal): the echo rides on either.
			const work = await call(name, asAdmin(), {
				...sent,
				scope: { kind: "instance" },
				stepKey: stepKeyFor(SECRET, "ghost"),
				slot: "variables",
				key: "x"
			})
			expect(work.res).toMatchObject(sent)
			if (name === "pipelinesClearLeftoverPick")
				expect(work.res.error).toEqual(expect.any(String))
		}
		// The answer, too.
		const ok = await call("pipelinesLeftoverPicks", asAdmin(), {
			slug: SLUG,
			presetId: 0
		})
		if (!ok.res.error)
			expect(ok.res).toMatchObject({ slug: SLUG, presetId: 0 })
	}, 60_000)

	test("read lists a stored leftover with its layout, scope and the step's template", async () => {
		expect(await stepsOf()).toEqual([])
		const pick = await variableRow(WORLD_LORE, "Old pick", {
			reference: { ownerSlug: "acme", slug: "old-pick" }
		})
		await pickAtGenre("worldLore", pick.id)
		const { res, rec } = await call("pipelinesLeftoverPicks", asAdmin(), {
			slug: SLUG
		})
		expect(res.error).toBeUndefined()
		expect(rec.last("pipelines:leftoverPicks")).toEqual(res)
		expect(res.steps).toHaveLength(1)
		expect(res.steps[0]).toMatchObject({
			...WIRE,
			canMoveIntoTemplate: false,
			contextTemplate: { name: "Default" }
		})
		// The panel's handle is the only name a step has on the wire.
		expect(res.steps[0]).not.toHaveProperty("nodeKey")
		expect(res.steps[0].picks[0]).not.toHaveProperty("nodeKey")
		expect(res.steps[0].picks).toEqual([
			{
				...WIRE,
				key: "worldLore",
				variableId: WORLD_LORE,
				variableLabel: expect.any(String),
				templateId: pick.id,
				layoutName: "Old pick",
				scope: { kind: "genre", genreId: GENRE }
			}
		])
	}, 60_000)

	test("Remove this pick removes it, and answers with the fresh list", async () => {
		const { res, rec } = await call(
			"pipelinesClearLeftoverPick",
			asAdmin(),
			{
				slug: SLUG,
				scope: { kind: "genre", genreId: GENRE },
				...WIRE,
				key: "worldLore"
			}
		)
		expect(res.error).toBeUndefined()
		expect(res.steps).toEqual([])
		expect(rec.last("pipelines:clearLeftoverPick")).toEqual(res)
		expect(await stepsOf()).toEqual([])
		// Asking again names nothing: refused in words.
		const again = await call("pipelinesClearLeftoverPick", asAdmin(), {
			slug: SLUG,
			scope: { kind: "genre", genreId: GENRE },
			...WIRE,
			key: "worldLore"
		})
		expect(again.res.error).toMatch(/no longer set here/)
	}, 60_000)

	test("a line under another step's template names its step; the template's own step and genre picks carry no extra", async () => {
		const { published, declarationsAndVariableKeys } = await import(
			"$lib/server/pipelines/config/panel/declarations"
		)
		const at = await published(db as any, SLUG)
		const { variableKeys } = await declarationsAndVariableKeys(
			db as any,
			at!.specVersionId
		)
		const other = variableKeys.find(
			(k: any) =>
				k.nodeKey !== "prompt" &&
				k.variableId &&
				getVariable(k.variableId)
		) as any
		expect(other).toBeTruthy()
		const row = await variableRow(other.variableId, "Elsewhere pick")
		const { setPipelineGenreValue } = await import(
			"$lib/server/pipelines/registrations/genreValues"
		)
		const at2 = (path: string, nodeKey: string, id: number | undefined) =>
			setPipelineGenreValue(
				db as any,
				SLUG,
				{ nodeKey, slot: other.slot, path },
				id
			)
		await at2(other.path, other.nodeKey, row.id)
		try {
			const { namespaceView } = await import(
				"$lib/server/pipelines/config/panel"
			)
			const { groupOptions } = await import(
				"$lib/server/pipelines/config/panel/groups"
			)
			const view: any = await namespaceView(db as any, SECRET, SLUG, {
				userId: 1,
				isAdmin: true
			} as any)
			const heading = groupOptions(view.groups).find(
				(o: any) => o.step?.key === stepKeyFor(SECRET, other.nodeKey)
			)?.step?.heading
			expect(heading).toEqual(expect.any(String))
			const steps = await stepsOf()
			expect(steps).toHaveLength(1)
			expect(steps[0].stepHeading).toBe(heading)
			expect(steps[0].picks[0]).not.toHaveProperty("presetName")
			// No value is the node key itself (a heading may end with the same word).
			expect(JSON.stringify(steps)).not.toContain('"' + other.nodeKey + '"')
			expect(steps[0]).not.toHaveProperty("nodeKey")
		} finally {
			await at2(other.path, other.nodeKey, undefined)
		}
		expect(await stepsOf()).toEqual([])

		// The template's own step: no heading.
		const own = await variableRow(WORLD_LORE, "Own pick")
		await pickAtGenre("worldLore", own.id)
		try {
			const steps = await stepsOf()
			expect(steps[0]).not.toHaveProperty("stepHeading")
		} finally {
			await pickAtGenre("worldLore", undefined)
		}
		expect(await stepsOf()).toEqual([])
	}, 60_000)

	test("a preset's own leftover is listed in its view and removed from its row", async () => {
		const [preset] = await db
			.insert(schema.sessionPresets)
			.values({ name: "Leftover preset", genreId: GENRE })
			.returning()
		const { writePresetChanges } = await import(
			"$lib/server/pipelines/registrations/presetRows"
		)
		const pick = await variableRow(WORLD_LORE, "Preset old pick")
		await writePresetChanges(db as any, preset!.id, {
			change: [
				{
					key: KEY,
					values: { prompt: { variables: { worldLore: pick.id } } }
				}
			]
		} as any)
		// Not in view without the preset.
		expect(await stepsOf()).toEqual([])
		const steps = await stepsOf({ presetId: preset!.id })
		expect(steps[0].picks[0].scope).toEqual({
			kind: "preset",
			presetId: preset!.id
		})
		expect(steps[0].picks[0].presetName).toBe("Leftover preset")
		const { res } = await call("pipelinesClearLeftoverPick", asAdmin(), {
			slug: SLUG,
			presetId: preset!.id,
			scope: { kind: "preset", presetId: preset!.id },
			...WIRE,
			key: "worldLore"
		})
		expect(res.error).toBeUndefined()
		expect(res.steps).toEqual([])
		const rows = await db
			.select()
			.from(schema.registrations)
			.where(eq(schema.registrations.presetId, preset!.id))
		expect(rows).toEqual([])
	}, 60_000)
})

describe("pipelines:moveLeftoversIntoTemplate", () => {
	let copyId: number
	const SOURCE = [
		"A {{{worldLore}}}",
		"B {{ worldLore }}",
		"C {{#if worldLore}}yes{{/if}}",
		"D {{{characterLore}}}",
		'E {{{layout history "core/json@1"}}}',
		"F {{worldLore.name}}"
	].join("\n")
	let worldPick: { id: number; name: string }
	let lorePick: { id: number; name: string }
	let datePick: { id: number }

	const source = async () =>
		(
			await db
				.select()
				.from(schema.pipelineContextTemplates)
				.where(eq(schema.pipelineContextTemplates.id, copyId))
		)[0]!.source

	test("refused on a shipped template, in words, changing nothing", async () => {
		worldPick = await variableRow(WORLD_LORE, "Needs a reference")
		lorePick = await variableRow(CHARACTER_LORE, "Lore pick", {
			reference: { ownerSlug: "acme", slug: "lore-pick" }
		})
		datePick = await variableRow(CURRENT_DATE, "Date pick", {
			reference: { ownerSlug: "acme", slug: "date-pick" }
		})
		await pickAtGenre("worldLore", worldPick.id)
		await pickAtGenre("characterLore", lorePick.id)
		await pickAtGenre("currentDate", datePick.id)
		const steps = await stepsOf()
		expect(steps[0].canMoveIntoTemplate).toBe(false)
		const { res } = await call(
			"pipelinesMoveLeftoversIntoTemplate",
			asAdmin(),
			{
				slug: SLUG,
				...WIRE,
				ownerSlug: "acme"
			}
		)
		expect(res.error).toMatch(/not this pub's own copy/)
		expect(res.code).toBeUndefined()
		expect((await stepsOf())[0].picks).toHaveLength(3)
	}, 60_000)

	test("on the pub's own copy: refused without an owner slug when a row needs a reference", async () => {
		const { createContextTemplate } = await import(
			"$lib/server/pipelines/entities/contextTemplates"
		)
		const copy = await createContextTemplate(db as any, {
			nodeDefinitionId: "core:task/assemble",
			name: "My story string",
			source: SOURCE
		})
		copyId = copy.id
		const { setPipelineGenreValue } = await import(
			"$lib/server/pipelines/registrations/genreValues"
		)
		await setPipelineGenreValue(
			db as any,
			SLUG,
			{ nodeKey: "prompt", slot: "template", path: "" },
			copyId
		)
		const steps = await stepsOf()
		expect(steps[0]).toMatchObject({
			canMoveIntoTemplate: true,
			contextTemplate: { id: copyId, name: "My story string" }
		})
		const { res } = await call(
			"pipelinesMoveLeftoversIntoTemplate",
			asAdmin(),
			{
				slug: SLUG,
				...WIRE
			}
		)
		expect(res.error).toMatch(/Needs a reference.*no reference yet/)
		expect(res.error).toMatch(/owner slug, for example 'acme'/)
		expect(res.code).toBe("needs-owner-slug")
		// Refused whole: the template, the reference and the picks are as they were.
		expect(await source()).toBe(SOURCE)
		const [row] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.id, worldPick.id))
		expect(row!.reference).toBeNull()
		expect((await stepsOf())[0].picks).toHaveLength(3)
	}, 60_000)

	test("names the picked layouts at every bare read, clears them, and leaves the rest alone", async () => {
		const { res, rec } = await call(
			"pipelinesMoveLeftoversIntoTemplate",
			asAdmin(),
			{
				slug: SLUG,
				...WIRE,
				ownerSlug: "acme"
			}
		)
		expect(res.error).toBeUndefined()
		expect(rec.last("pipelines:moveLeftoversIntoTemplate")).toEqual(res)
		expect(res.templateId).toBe(copyId)
		expect(res.stamped).toEqual([
			{ templateId: worldPick.id, reference: "acme/needs-a-reference@1" }
		])
		expect(res.moved).toEqual([
			{
				key: "worldLore",
				reference: "acme/needs-a-reference@1",
				reads: 2
			},
			{ key: "characterLore", reference: "acme/lore-pick@1", reads: 1 }
		])
		// currentDate is never read bare in the template: its pick stays.
		expect(res.kept).toEqual([
			{
				key: "currentDate",
				why: expect.stringContaining("never reads currentDate")
			}
		])
		expect(res.steps[0].picks.map((p: any) => p.key)).toEqual([
			"currentDate"
		])

		const next = await source()
		expect(next).toBe(
			[
				'A {{{layout worldLore "acme/needs-a-reference@1"}}}',
				'B {{{layout worldLore "acme/needs-a-reference@1"}}}',
				"C {{#if worldLore}}yes{{/if}}",
				'D {{{layout characterLore "acme/lore-pick@1"}}}',
				'E {{{layout history "core/json@1"}}}',
				"F {{worldLore.name}}"
			].join("\n")
		)
		// The calls the new source carries are exactly the ones written (and the
		// one that was already there).
		const { CORE_TEMPLATE_ENGINE } = await import(
			"$lib/shared/pipelines/templateEngines"
		)
		expect(variableLayoutCalls(CORE_TEMPLATE_ENGINE, next)).toEqual([
			{ key: "worldLore", reference: "acme/needs-a-reference@1" },
			{ key: "worldLore", reference: "acme/needs-a-reference@1" },
			{ key: "characterLore", reference: "acme/lore-pick@1" },
			{ key: "history", reference: "core/json@1" }
		])
		// Output unchanged: each call names the very row the pick named.
		const { layoutByReference } = await import(
			"$lib/server/pipelines/entities/variableTemplates"
		)
		expect(
			await layoutByReference(
				db as any,
				WORLD_LORE,
				"acme/needs-a-reference@1"
			)
		).toBe(worldPick.id)
		expect(
			await layoutByReference(
				db as any,
				CHARACTER_LORE,
				"acme/lore-pick@1"
			)
		).toBe(lorePick.id)
	}, 60_000)

	test("a second move has nothing left to do for the moved keys", async () => {
		const steps = await stepsOf()
		expect(steps[0].picks.map((p: any) => p.key)).toEqual(["currentDate"])
		const { res } = await call(
			"pipelinesMoveLeftoversIntoTemplate",
			asAdmin(),
			{
				slug: SLUG,
				...WIRE,
				ownerSlug: "acme"
			}
		)
		expect(res.error).toMatch(
			/doesn't write any of these variables out by name/
		)
		expect(res.steps).toBeUndefined()
	}, 60_000)

	test("Liquid reads are named with the filter", async () => {
		const { nameLayoutAtBareReads } = await import(
			"$lib/server/pipelines/config/leftoverPicks"
		)
		const { CORE_LIQUID_ENGINE } = await import(
			"$lib/shared/pipelines/templateEngines"
		)
		const out = nameLayoutAtBareReads(
			CORE_LIQUID_ENGINE,
			'{{ characters }} {{- characters -}} {% if characters %}x{% endif %} {{ characters | upcase }} {{ characters | layout: "core/json@1" }}',
			"characters",
			"core/prose@1"
		)
		expect(out.count).toBe(2)
		expect(out.source).toBe(
			'{{ characters | layout: "core/prose@1" }} {{- characters | layout: "core/prose@1" -}} {% if characters %}x{% endif %} {{ characters | upcase }} {{ characters | layout: "core/json@1" }}'
		)
		expect(variableLayoutCalls(CORE_LIQUID_ENGINE, out.source)).toEqual([
			{ key: "characters", reference: "core/prose@1" },
			{ key: "characters", reference: "core/prose@1" },
			{ key: "characters", reference: "core/json@1" }
		])
	}, 60_000)
})

describe("pipelines:stampVariableTemplateReference", () => {
	test("gives an older row a reference, refuses one that has it, and answers with the library", async () => {
		const old = await variableRow(WORLD_LORE, "An older row")
		const { res, rec } = await call(
			"pipelinesStampVariableTemplateReference",
			asAdmin(),
			{
				templateId: old.id,
				ownerSlug: "acme"
			}
		)
		expect(res.error).toBeUndefined()
		expect(res).toMatchObject({
			templateId: old.id,
			reference: "acme/an-older-row@1"
		})
		expect(rec.last("pipelines:stampVariableTemplateReference")).toEqual(
			res
		)
		expect(
			res.library.variableTemplates.find((t: any) => t.id === old.id)
				.reference
		).toBe("acme/an-older-row@1")
		const again = await call(
			"pipelinesStampVariableTemplateReference",
			asAdmin(),
			{
				templateId: old.id,
				ownerSlug: "acme"
			}
		)
		expect(again.res.error).toMatch(/already goes by/)
	}, 60_000)
})

describe("a step's handle is the panel's own", () => {
	test("on a pipeline with two context templates, a leftover on the second step carries exactly that option's step.key", async () => {
		const { namespaceView } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const { groupOptions } = await import(
			"$lib/server/pipelines/config/panel/groups"
		)
		// Two steps of this shipped pipeline each own a context template.
		const slug = "core:spec/story-illustrate-scene"
		const view: any = await namespaceView(db as any, SECRET, slug, {
			userId: admin.id,
			isAdmin: true
		} as any)
		const templates = groupOptions(view.groups).filter(
			(o: any) => o.control === "context-template-ref"
		) as any[]
		expect(templates).toHaveLength(2)
		const second = templates[1]
		const first = templates[0]
		expect(second.step.key).not.toBe(first.step.key)

		const { locateStep } = await import(
			"$lib/server/pipelines/config/variableLayoutsView"
		)
		const { published } = await import(
			"$lib/server/pipelines/config/panel/declarations"
		)
		const at = (await published(db as any, slug))!
		const nodeKey = (await locateStep(
			db as any,
			SECRET,
			at.specVersionId,
			second.step.key
		))!
		expect(nodeKey).toEqual(expect.any(String))

		const pick = await variableRow(WORLD_LORE, "Second step pick")
		const { setInstanceValue } = await import(
			"$lib/server/pipelines/registrations/instanceValues"
		)
		const address = { nodeKey, slot: "variables", path: "worldLore" }
		await setInstanceValue(db as any, slug, address, pick.id)
		try {
			const { res } = await call("pipelinesLeftoverPicks", asAdmin(), {
				slug
			})
			expect(res.error).toBeUndefined()
			expect(res.steps).toHaveLength(1)
			expect(res.steps[0].stepKey).toBe(second.step.key)
			expect(res.steps[0].stepKey).not.toBe(first.step.key)
			expect(res.steps[0].picks[0].stepKey).toBe(second.step.key)
			expect(res.steps[0]).not.toHaveProperty("nodeKey")
			expect(res.steps[0].picks[0]).not.toHaveProperty("nodeKey")
		} finally {
			await setInstanceValue(db as any, slug, address, undefined)
		}
	}, 60_000)
})
