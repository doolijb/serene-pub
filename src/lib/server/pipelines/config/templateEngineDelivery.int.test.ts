/**
 * A template renders in the language it declares.
 *
 * This is the one test in the suite that could not have passed the day before
 * it was written, and the bug it pins was invisible from every other angle.
 *
 * `derefTemplate` in `world.ts` resolved a template row — engine and source
 * together, correctly — and then returned `row.source` alone. So the assemble
 * slot arrived at the binding as a bare string, `input.template.engine` was
 * `undefined` on every run on every install, and `renderTemplate` answered that
 * absence with core's Handlebars. Every context template on the instance
 * rendered in Handlebars whatever it declared, silently. On core there was
 * nothing to notice, because core ships one engine; on the first plugin that
 * shipped its own assembler, its template would have gone to the model as
 * unrendered markup.
 *
 * Nothing in the type system saw it (a `string` where an object was expected,
 * dropped through `?.`), nothing logged, and no existing test asked. So the
 * shape of the test is: **register a renderer that is provably not core's,
 * point a real template at it, take the real config path, and assert the fake
 * ran.** Anything narrower — asserting the world carries an `engine` path, say
 * — would have gone green on a half-fix that never reached the renderer.
 */

import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { resolveConfigSources } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"
import {
	CORE_TEMPLATE_ENGINE,
	TemplateEngineError,
	_resetRenderers,
	registerRenderer,
	renderTemplate
} from "$lib/server/pipelines/prompt/renderers"

/** Deliberately not Handlebars: it ignores the template and stamps its own mark. */
const FAKE_ENGINE = "test:template/echo@1"
const FAKE_MARK = "RENDERED-BY-THE-FAKE-ENGINE"

let db: TestDb
let dataDir: string
let userId: number
let sessionId: number
let specId: number
/** The node whose slot holds the story string, and the slot's authored name. */
let templateNodeKey: string
let templateSlot: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "engine-delivery-test-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-engine-delivery-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "engine-delivery-user", isAdmin: false })
		.returning()
	userId = user.id
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	sessionId = session.id

	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)

	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
	specId = spec.id

	// Read rather than hardcoded: the slot's name is the spec author's, and a
	// test naming `template` would keep passing against a pipeline that renamed
	// it while the projection quietly stopped dereferencing anything.
	const { declarations } = await import("$lib/server/pipelines/config/panel")
	const decl = (await declarations(db as any, spec.activeVersionId!)).find(
		(d) => d.control === "context-template-ref"
	)
	expect(
		decl,
		"the reply pipeline declares no context template slot"
	).toBeTruthy()
	templateNodeKey = decl!.nodeKey
	templateSlot = decl!.slot
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

afterEach(() => {
	// Plugin engines are process-global. Left registered, a later file's
	// "unknown engine throws" assertion would pass or fail depending on which
	// file ran first.
	_resetRenderers()
})

/** The whole template slot, as the assemble binding would receive it. */
const templateSlotValue = async () => {
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	const world = await buildWorld(db as any, {
		sessionId,
		specId: RESPOND_SPEC_ID
	})
	const sourced = resolveConfigSources(world as any, [templateNodeKey])
	const slot = sourced[templateNodeKey]?.[templateSlot]
	return {
		source: slot?.source?.value as string | undefined,
		engine: slot?.engine?.value as string | undefined
	}
}

/** Select a template row for this session's assemble node. */
const selectTemplate = async (templateId: number | null) => {
	await db
		.delete(schema.pipelineNodeOverrides)
		.where(eq(schema.pipelineNodeOverrides.scopeId, sessionId))
	if (templateId == null) return
	await db.insert(schema.pipelineNodeOverrides).values({
		specId,
		scopeKind: "session",
		scopeId: sessionId,
		nodeKey: templateNodeKey,
		slot: templateSlot,
		path: "",
		value: templateId
	})
}

describe("the engine reaches the renderer", () => {
	it("hands the assemble step the template's own engine, and that engine renders", async () => {
		registerRenderer(FAKE_ENGINE, "test-lane", () => FAKE_MARK)

		const { createContextTemplate } = await import(
			"$lib/server/pipelines/entities/contextTemplates"
		)
		const row = await createContextTemplate(db as any, {
			nodeTypeId: "core:task/assemble",
			name: "Written in another language",
			// Valid Handlebars, and that is the point: if the engine is lost,
			// core's renderer will happily render this and produce a string
			// that looks like a successful render. Only the mark distinguishes
			// "the right engine ran" from "something ran".
			source: "{{#systemBlock}}plain{{/systemBlock}}",
			engine: FAKE_ENGINE
		})
		await selectTemplate(row.id)

		const slot = await templateSlotValue()
		expect(slot.source).toBe("{{#systemBlock}}plain{{/systemBlock}}")
		// The assertion the old code fails: the engine was resolved and then
		// discarded, so this was `undefined` on every run ever made.
		expect(
			slot.engine,
			"the template slot arrived without its engine — see derefTemplate"
		).toBe(FAKE_ENGINE)

		// End to end: the same two values, through the real render path.
		const { render } = await import("$lib/server/pipelines/prompt/assemble")
		const out = await render({
			allocation: {
				blocks: [],
				totalTokens: 0,
				budget: { total: 0, used: 0, remaining: 0 },
				groups: {}
			},
			template: slot.source!,
			engine: slot.engine!,
			messages: []
		})
		expect(
			out.rendered,
			"the template was rendered by core's engine instead of its own"
		).toBe(FAKE_MARK)
	})

	it("still delivers core's engine for a template that declares core's", async () => {
		// The other half, and not a formality: a fix that only carried
		// *non-core* engines would pass the test above and leave every ordinary
		// install with no engine at all, which now throws rather than silently
		// falling back.
		const { shippedContextTemplate } = await import(
			"$lib/server/pipelines/entities/contextTemplates"
		)
		const shipped = await shippedContextTemplate(
			db as any,
			"core:task/assemble"
		)
		expect(shipped).toBeTruthy()
		await selectTemplate(shipped!.id)

		const slot = await templateSlotValue()
		expect(slot.engine).toBe(CORE_TEMPLATE_ENGINE)
		expect(slot.source?.length).toBeGreaterThan(0)
	})

	it("drops the source and the engine together when the reference dangles", async () => {
		// Both or neither. Half a pair is worse than none: the node would be
		// handed an engine naming a language for a source that never arrived,
		// then fall through to its in-code default while claiming to render
		// something else.
		await selectTemplate(2_000_000_000)

		const slot = await templateSlotValue()
		const shipped = await (async () => {
			const { shippedContextTemplate } = await import(
				"$lib/server/pipelines/entities/contextTemplates"
			)
			return await shippedContextTemplate(db as any, "core:task/assemble")
		})()

		// What survives is the config's own selection underneath, never a
		// source with no engine or an engine with no source.
		if (slot.source === undefined) expect(slot.engine).toBeUndefined()
		else {
			expect(slot.engine).toBeTruthy()
			expect(slot.source).toBe(shipped!.source)
		}
	})
})

describe("the assemble binding refuses a template it cannot identify", () => {
	/**
	 * ⚠ The guard on a defect this lane found rather than introduced.
	 *
	 * An unresolved slot arrives as `{}` — an empty object, not `undefined`.
	 * The binding read its source as `String(slot?.source ?? slot ?? "")`,
	 * which fell through to the object itself and produced the literal seven
	 * characters `[object Object]`. Truthy, so the "no template" halt never
	 * fired; valid Handlebars, so the renderer accepted it; and the entire
	 * prompt for that run was a stringified empty object sent to the model as
	 * prose.
	 *
	 * It is reachable on a real install: `bootstrapPipelines` returns early on
	 * a `TypeRegistryConflictError` without writing config values, and this
	 * slot then resolves to `{}` on every run afterwards.
	 */
	const assemble = async (template: unknown) => {
		const { coreBindings } = await import(
			"$lib/server/pipelines/runtime/bindings"
		)
		return (await coreBindings()["core:task/assemble@2"]!(
			{ template, decisions: [], messages: [], budget: { total: 100 } },
			{} as any
		)) as any
	}

	it("halts on an unresolved slot instead of rendering '[object Object]'", async () => {
		const result = await assemble({})
		expect(result.kind).toBe("halt")
		expect(result.reason).toMatch(/no template/i)
		expect(JSON.stringify(result)).not.toContain("[object Object]")
	})

	it("halts on a resolved source with no engine, rather than guessing core's", async () => {
		// A source with no engine cannot come out of the config layer —
		// `pushTemplate` emits both paths or neither — so it is a delivery
		// fault and is named as one.
		const result = await assemble({ source: "{{budget.total}}" })
		expect(result.kind).toBe("halt")
		expect(result.reason).toMatch(/no engine/i)
	})

	it("renders a bare string as core's, which is the only thing it can be", async () => {
		// An in-code author default has nowhere to record a language, so this
		// one absence is answerable rather than a fault.
		const result = await assemble("{{budget.total}}")
		expect(result.kind).toBe("ok")
		expect(result.value.context.rendered).toBe("100")
	})
})

describe("renderTemplate refuses to guess", () => {
	it("throws rather than defaulting to Handlebars when handed no engine", async () => {
		// The fallback that let the delivery bug survive a release. With both
		// template tables NOT NULL, an absent engine can only mean a caller
		// dropped it — which is a fault, not a default.
		await expect(
			renderTemplate("" as any, { template: "x", variables: {} })
		).rejects.toBeInstanceOf(TemplateEngineError)
		await expect(
			renderTemplate(undefined as any, { template: "x", variables: {} })
		).rejects.toBeInstanceOf(TemplateEngineError)
	})

	it("throws for an engine nobody registered, naming what is known", async () => {
		await expect(
			renderTemplate("nobody:template/here@1", {
				template: "x",
				variables: {}
			})
		).rejects.toThrow(CORE_TEMPLATE_ENGINE)
	})
})
