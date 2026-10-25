/**
 * What a person edits in the pipeline panel is what the run uses.
 *
 * This is the seam that decides whether the whole configuration layer is real.
 * Everything else can be correct — the panel, the configs, the prompts, the
 * migration — and if the run still resolves against the legacy projection alone
 * then every screen agrees with the user and the model does something else. It
 * is the worst class of bug in this area, because there is nothing to see.
 *
 * The three layers are checked separately because they arrive by different
 * routes and can each be wired wrongly on their own:
 *
 *  1. a **selected config**, which lands at `preset`;
 *  2. a **single override**, at the scope it was written at, over the config;
 *  3. a **prompt reference**, which is stored as an id and has to become words.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { resolveConfigSources } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { STORY_RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"

let db: TestDb
let dataDir: string
let userId: number
let sessionId: number
let specId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "world-layer-test-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-world-layer-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "world-layer-user", isAdmin: false })
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
	await bootstrapPipelines(db)

	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND_SPEC_ID))
	specId = spec.id
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const worldFor = async () => {
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	return await buildWorld(db, {
		sessionId,
		specId: STORY_RESPOND_SPEC_ID
	})
}

const resolvedAt = async (nodeKey: string, slot: string, path: string) => {
	const world = await worldFor()
	const sourced = resolveConfigSources(world as any, [nodeKey])
	return sourced[nodeKey]?.[slot]?.[path]
}

const declarationsFor = async (specVersionId: number) => {
	const { declarations } = await import("$lib/server/pipelines/config/panel")
	return await declarations(db, specVersionId)
}

/**
 * The reply pipeline's prompts declaration for one node.
 *
 * Read rather than hardcoded: the pool is `(node type, slot)` and both halves
 * are the spec's to choose, so a test naming `core:task/build-template-context`
 * in a string would go green against the wrong pool the day that node was
 * replaced — which is precisely the kind of reuse this refactor exists to make
 * cheap.
 */
const promptDeclFor = async (nodeKey: string) => {
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.id, specId))
	const decl = (await declarationsFor(spec.activeVersionId!)).find(
		(d) => d.nodeKey === nodeKey && d.control === "prompts-ref"
	)
	expect(decl, `${nodeKey} declares no prompts slot`).toBeTruthy()
	expect(
		decl!.nodeDefinitionId,
		"a prompts declaration must carry its node type — it is half the pool key"
	).toBeTruthy()
	return decl!
}

/**
 * A prompt row in the same pool as `nodeKey`'s prompts slot.
 *
 * `pipeline_prompts` no longer has a `spec_id`; inserting one means naming the
 * pool it lands in, and a row in the wrong pool is simply never offered.
 */
const promptInPoolOf = async (
	nodeKey: string,
	name: string,
	fields: Record<string, string>
) => {
	const decl = await promptDeclFor(nodeKey)
	const [row] = await db
		.insert(schema.pipelinePrompts)
		.values({
			nodeDefinitionId: decl.nodeDefinitionId!,
			slot: decl.slot,
			createdForSpecId: specId,
			name,
			fields
		})
		.returning()
	return row
}

describe("the shipped configuration reaches a run", () => {
	it("puts the selected config's prompt text where the node reads it", async () => {
		// The prompt is stored as an *id* on the config and the node needs the
		// words. If the dereference is missing the node renders a blank, which
		// reads as the model ignoring an instruction.
		const resolved = await resolvedAt("context", "prompts", "systemPrompt")
		expect(resolved).toBeTruthy()
		expect(typeof resolved!.value).toBe("string")
		expect(String(resolved!.value).length).toBeGreaterThan(0)
	})

	it("falls back to the namespace's own default when nothing else selects a prompt", async () => {
		// The floor. Every layer above it is optional — a config need not
		// carry a prompts value, and clearing an override deletes a row
		// rather than writing one — so without this a run could go out with
		// empty instructions, which reads as the model ignoring its
		// character sheet rather than as "no prompt is selected".
		await db
			.delete(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.slot, "prompts"))
		await db
			.delete(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.slot, "prompts"))

		const resolved = await resolvedAt("context", "prompts", "systemPrompt")
		expect(resolved).toBeTruthy()
		expect(String(resolved!.value).length).toBeGreaterThan(0)

		// It is the prompt this pipeline ships for *that step's pool* — the
		// floor is resolved per pool now, not once per pipeline — and it sits
		// at `defaults`, under anything anyone actually chose.
		const { defaultPromptFor } = await import(
			"$lib/server/pipelines/boot/seedPrompts"
		)
		const decl = await promptDeclFor("context")
		const id = await defaultPromptFor(
			db,
			decl.nodeDefinitionId!,
			decl.slot,
			{
				id: specId,
				slug: STORY_RESPOND_SPEC_ID
			}
		)
		const { resolvePromptFields } = await import(
			"$lib/server/pipelines/entities/prompts"
		)
		const fields = await resolvePromptFields(db, id!)
		expect(resolved!.value).toBe(fields.systemPrompt)
		// 🚧 R38 (PLAN-layering D5): the pipeline's declared defaults name it
		// — its `.defaults()` reference resolved to the pool's row — at
		// `author`, and the instance floor at `defaults` steps aside for a
		// pick the pipeline made.
		expect(resolved!.scopeKind).toBe("author")
	})
})

/**
 * The floor resolves per POOL, and this is the test that says so.
 *
 * It used to resolve one `defaultPromptFor(db, spec.id)` and push its fields
 * onto every prompts node in the spec. A summarize pipeline has several prompts
 * nodes of *different types*, so pool-blind that puts one step's wording on all
 * of them — the world summarizer's drafting instructions arriving on the
 * name-entry step. That text renders. It reads as plausible English. Nothing
 * anywhere says the step is following instructions written for another step,
 * which is why this is asserted rather than eyeballed.
 */
describe("the prompts floor follows each node's own pool", () => {
	it("gives each step the prompt written for that step, not one row's for all", async () => {
		const { SUMMARIZE_WORLD_SPEC_ID } = await import(
			"$lib/server/pipelines/specs"
		)
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, SUMMARIZE_WORLD_SPEC_ID))
		const decls = (await declarationsFor(spec.activeVersionId!)).filter(
			(d) => d.control === "prompts-ref"
		)

		// The premise: this pipeline really does have prompts nodes of more
		// than one type. Without it the test would pass on a pipeline where
		// pool-blind and pool-aware are the same answer, and prove nothing.
		const pools = new Set(decls.map((d) => `${d.nodeDefinitionId}#${d.slot}`))
		expect(
			pools.size,
			"the summarize pipeline should declare prompts on more than one kind of step"
		).toBeGreaterThan(1)

		const { buildWorld } = await import(
			"$lib/server/pipelines/config/world"
		)
		const world: any = await buildWorld(db, {
			sessionId,
			specId: SUMMARIZE_WORLD_SPEC_ID
		})
		const { defaultPromptFor } = await import(
			"$lib/server/pipelines/boot/seedPrompts"
		)
		const { resolvePromptFields } = await import(
			"$lib/server/pipelines/entities/prompts"
		)

		for (const d of decls) {
			const id = await defaultPromptFor(
				db,
				d.nodeDefinitionId!,
				d.slot,
				{ id: spec.id, slug: SUMMARIZE_WORLD_SPEC_ID }
			)
			if (id == null) continue
			const fields = await resolvePromptFields(db, id)
			// The declared defaults (`author`) or, where they pick nothing,
			// the instance floor (`defaults`) — either way this step's pool.
			const floor = world.overrides.filter(
				(o: any) =>
					(o.scopeKind === "defaults" || o.scopeKind === "author") &&
					o.nodeKey === d.nodeKey &&
					o.slot === "prompts"
			)
			expect(
				floor.length,
				`${d.nodeKey} got no prompts floor at all`
			).toBeGreaterThan(0)
			for (const o of floor)
				expect(
					o.value,
					`${d.nodeKey} was floored with text from another step's pool`
				).toBe(fields[o.path])
		}
	})
})

describe("a value someone set wins", () => {
	it("lets a session override beat the selected config — the whole chain now", async () => {
		// The chain since the simplification (2026-08-24): a session's override
		// is the only scoped row left, and it wins over the selected config.
		const [node] = await db
			.select()
			.from(schema.pipelineNodes)
			.where(eq(schema.pipelineNodes.nodeKey, "rank"))
			.limit(1)
		expect(node).toBeTruthy()

		await db.insert(schema.pipelineNodeOverrides).values({
			specId,
			scopeKind: "session",
			scopeId: sessionId,
			nodeKey: "rank",
			slot: "params",
			path: "budget",
			value: 4321
		})

		const resolved = await resolvedAt("rank", "params", "budget")
		expect(resolved!.value).toBe(4321)
		expect(resolved!.scopeKind).toBe("session")
	})

	it("keeps another session's override out of this world", async () => {
		const [other] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false })
			.returning()

		await db.insert(schema.pipelineNodeOverrides).values({
			specId,
			scopeKind: "session",
			scopeId: other.id,
			nodeKey: "rank",
			slot: "params",
			path: "minInclude",
			value: 999
		})

		const resolved = await resolvedAt("rank", "params", "minInclude")
		// Either unset, or set by something that is not that session.
		expect(resolved?.value).not.toBe(999)
	})
})

describe("a prompt edited in the panel", () => {
	it("reaches the node as text, not as a row id", async () => {
		// The failure this catches is specific and silent: a config stores the
		// reference, so a world that forwarded it unchanged would hand the node
		// the number 7 where its system prompt should be.
		const prompt = await promptInPoolOf("context", "Panel-edited prompt", {
			systemPrompt: "SPEAK ONLY IN RIDDLES",
			system: "SPEAK ONLY IN RIDDLES"
		})

		// 🚧 An administrator's pick for every session — the genre's defaults'
		// registration of the reply, changed (A15, R38) — stores the reference.
		const { genreValueTargets, setGenreValue, resetGenreValues } = await import(
			"$lib/server/pipelines/registrations/genreValues"
		)
		const targets = await genreValueTargets(db as any, STORY_RESPOND_SPEC_ID)
		expect(targets.length).toBeGreaterThan(0)
		await setGenreValue(db as any, targets, { nodeKey: "context", slot: "prompts", path: "" }, prompt.id)
		try {
			const resolved = await resolvedAt("context", "prompts", "systemPrompt")
			expect(resolved!.value).toBe("SPEAK ONLY IN RIDDLES")
			// The genre's layer: under a session's override, over the
			// pipeline's declared defaults.
			expect(resolved!.scopeKind).toBe("genre")
		} finally {
			await resetGenreValues(db as any, targets)
		}
	})

	it("reaches the node as text when picked as an override, too", async () => {
		// The panel's writeOption stores a prompts-ref the same way a config
		// value does — `(slot: "prompts", path: "", value: <row id>)` — but in
		// `pipeline_node_overrides`. That row travels a different loop in
		// `applyPipelineLayer`, so it can be broken while the config path is
		// green: the node gets a number where its system prompt should be.
		const prompt = await promptInPoolOf(
			"context",
			"Override-picked prompt",
			{
				systemPrompt: "ANSWER ONLY IN HAIKU",
				system: "ANSWER ONLY IN HAIKU"
			}
		)

		await db.insert(schema.pipelineNodeOverrides).values({
			specId,
			scopeKind: "session",
			scopeId: sessionId,
			nodeKey: "context",
			slot: "prompts",
			path: "",
			value: prompt.id
		})

		const resolved = await resolvedAt("context", "prompts", "systemPrompt")
		expect(resolved!.value).toBe("ANSWER ONLY IN HAIKU")
		// At the scope it was written at — over the selected config's preset
		// layer, so a per-session pick beats the named config in that session.
		expect(resolved!.scopeKind).toBe("session")
	})
})

/**
 * 🚧 A pipeline's instance values (R50, lane F1 2026-10-21): the
 * administrator's values on this pub, under the genre layer and over the
 * declared defaults — and the whole of what a pipeline nothing registers (a
 * card action) reads beside its declared defaults. No configuration is read.
 */
describe("instance values (R50)", () => {
	/** A plain params address the spec declares — read, never spelled (the value is not judged on the read path). */
	const paramsAddressOf = async (slug: string) => {
		const [spec] = await db.select().from(schema.pipelineSpecs).where(eq(schema.pipelineSpecs.slug, slug))
		const decls = await declarationsFor(spec.activeVersionId!)
		const decl =
			decls.find((d) => d.slot === "params" && d.path !== "" && (d.control === "integer" || d.control === "number")) ??
			decls.find((d) => d.slot === "params" && d.path !== "")
		expect(decl, `${slug} declares no param`).toBeTruthy()
		return { nodeKey: decl!.nodeKey, slot: decl!.slot, path: decl!.path }
	}

	it("a registered pipeline reads them under the genre's defaults", async () => {
		const { setInstanceValue } = await import("$lib/server/pipelines/registrations/instanceValues")
		const { setPipelineGenreValue } = await import("$lib/server/pipelines/registrations/genreValues")
		const at = await paramsAddressOf(STORY_RESPOND_SPEC_ID)
		await setInstanceValue(db as never, STORY_RESPOND_SPEC_ID, at, 4242)
		expect((await resolvedAt(at.nodeKey, at.slot, at.path))?.value).toBe(4242)
		// The genre's defaults (an administrator's change on them) win where both speak.
		await setPipelineGenreValue(db as never, STORY_RESPOND_SPEC_ID, at, 4343)
		expect((await resolvedAt(at.nodeKey, at.slot, at.path))?.value).toBe(4343)
		await setPipelineGenreValue(db as never, STORY_RESPOND_SPEC_ID, at, undefined)
		expect((await resolvedAt(at.nodeKey, at.slot, at.path))?.value).toBe(4242)
		await setInstanceValue(db as never, STORY_RESPOND_SPEC_ID, at, undefined)
		expect((await resolvedAt(at.nodeKey, at.slot, at.path))?.value).not.toBe(4242)
	}, 60_000)

	it("a pipeline nothing registers (a card action) reads its instance values, never a selected configuration", async () => {
		const { CHARACTER_PORTRAIT_SPEC_ID } = await import("@serene-pub/core-catalog")
		const { registrationValueLayers } = await import("$lib/server/pipelines/registrations/values")
		const { setInstanceValue, instanceValuesOf } = await import("$lib/server/pipelines/registrations/instanceValues")
		const at = await paramsAddressOf(CHARACTER_PORTRAIT_SPEC_ID)
		await setInstanceValue(db as never, CHARACTER_PORTRAIT_SPEC_ID, at, 7)
		expect(await instanceValuesOf(db as never, CHARACTER_PORTRAIT_SPEC_ID)).toEqual({ [at.nodeKey]: { [at.slot]: { [at.path]: 7 } } })
		const layers = await registrationValueLayers(db as never, { specSlug: CHARACTER_PORTRAIT_SPEC_ID })
		expect(layers).toEqual({
			key: null,
			instance: { [at.nodeKey]: { [at.slot]: { [at.path]: 7 } } },
			genre: null,
			preset: null,
			session: null
		})
		const { buildWorld } = await import("$lib/server/pipelines/config/world")
		const world = await buildWorld(db, { sessionId: null, specId: CHARACTER_PORTRAIT_SPEC_ID } as never)
		const sourced = resolveConfigSources(world as any, [at.nodeKey])
		expect(sourced[at.nodeKey]?.[at.slot]?.[at.path]?.value).toBe(7)
	}, 60_000)
})
