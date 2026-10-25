/**
 * The `blocks` param, end to end: declaration → configuration → preset → prompt.
 *
 * Four claims, and the first two are the deviations rule applied to a value that
 * is a list rather than a number — which is the shape that would break it if
 * anything were going to. A pack equal to the shipped one has to store nothing,
 * because a stored copy resolves identically today and pins the configuration to
 * that order forever after; and "I dragged it back" and "I chose today's order
 * on purpose" would then be the same gesture with permanently different
 * consequences.
 *
 * The last claim is the one the ruling of 2026-09-10 rests on. A prompt-module
 * pack is a param **inside the preset's pipeline configuration**, so a preset
 * carries it to every session started from it through machinery that already
 * exists — `resolveSelectedConfig`'s preset layer — with no preset-lane code at
 * all. This file is what says that is true rather than plausible.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	bootstrapPipelines,
	STORY_RESPOND_SPEC_ID
} from "$lib/server/pipelines/boot/bootstrap"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { resolveConfigSources } from "@serene-pub/sdk"
import { optionId, writeOption } from "$lib/server/pipelines/config/panel"
import {
	SHIPPED_PROMPT_BLOCKS,
	SHIPPED_PROMPT_BLOCK_IDS
} from "@serene-pub/sdk"
import { render } from "$lib/server/pipelines/prompt/assemble"
import { SHIPPED_CONTEXT_TEMPLATE } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import { CORE_TEMPLATE_ENGINE } from "$lib/shared/pipelines/templateEngines"

const SECRET = "prompt-blocks-test-secret"

/** The assembly step in `respond` (`core-catalog/src/respond.ts`, `.task('prompt')`). */
const NODE = "prompt"
const SLOT = "params"
const PATH = "blocks"

/** The pack this file configures: the shipped one with the cast moved to the top. */
const REORDERED = [
	{ id: "characters", enabled: true },
	{ id: "instructions", enabled: true },
	{ id: "scenario", enabled: false },
	{ id: "worldLore", enabled: true }
]

let db: TestDb
let specId: number
let adminId: number

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)

	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND_SPEC_ID))
	specId = spec.id

	const [admin] = await db
		.insert(schema.users)
		.values({ username: "prompt-blocks-admin", isAdmin: true })
		.returning()
	adminId = admin.id
}, 60_000)

const shippedConfig = async () => {
	const [row] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(
			eq(
				schema.pipelineConfigs.seedKey,
				`pipeline-default:${STORY_RESPOND_SPEC_ID}`
			)
		)
	return row
}

const rowAt = async (configId: number) => {
	const [row] = await db
		.select()
		.from(schema.pipelineConfigValues)
		.where(
			and(
				eq(schema.pipelineConfigValues.configId, configId),
				eq(schema.pipelineConfigValues.nodeKey, NODE),
				eq(schema.pipelineConfigValues.slot, SLOT),
				eq(schema.pipelineConfigValues.path, PATH)
			)
		)
	return row
}

/** What a run resolves, through the executor's own two calls. */
const resolvedBlocks = async (sessionId?: number) => {
	const world = await buildWorld(db, { specId: STORY_RESPOND_SPEC_ID, sessionId })
	const sources: any = resolveConfigSources(world as any, [NODE])
	return sources?.[NODE]?.[SLOT]?.[PATH]
}

const handle = () => optionId(SECRET, NODE, SLOT, PATH)

describe("the declared default costs no row", () => {
	it("stores nothing for the shipped pack on a fresh install", async () => {
		expect(
			await rowAt((await shippedConfig()).id),
			`the shipped configuration materialized ${NODE}/${SLOT}/${PATH}. A row ` +
				`there is indistinguishable from one an administrator set, and it ` +
				`pins the configuration to today's block order forever after.`
		).toBeUndefined()
	})

	it("resolves the declared order through the run's own resolver", async () => {
		const resolved = await resolvedBlocks()
		expect(resolved?.scopeKind).toBe("author")
		expect((resolved?.value as { id: string }[]).map((b) => b.id)).toEqual([
			...SHIPPED_PROMPT_BLOCK_IDS
		])
	})

	it("writing the shipped pack back is a reset, not a stored copy", async () => {
		// 🚧 An instance-wide write lands as a change to the genre's defaults
		// (R38, A15); putting the order back removes it.
		const genreBlocks = async () =>
			(
				await db
					.select()
					.from(schema.registrations)
					.where(and(eq(schema.registrations.scopeKind, "genre"), eq(schema.registrations.origin, "admin")))
			).map((r) => (r.values as any)?.[NODE]?.[SLOT]?.[PATH])
		await writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, { userId: adminId, isAdmin: true }, handle(), REORDERED)
		expect((await genreBlocks()).length).toBe(1)

		await writeOption(
			db,
			SECRET,
			STORY_RESPOND_SPEC_ID,
			{ userId: adminId, isAdmin: true },
			handle(),
			SHIPPED_PROMPT_BLOCKS
		)
		expect(
			await genreBlocks(),
			"putting the order back stored a copy of the default instead of " +
				"deleting the deviation"
		).toEqual([])
	})
})

describe("a preset carries the pack to its sessions", () => {
	let presetId: number
	let sessionId: number

	beforeAll(async () => {
		// 🚧 A preset's change to the reply's registration (R38): the reorder
		// as its values — what an administrator building a preset sets.
		const [preset] = await db
			.insert(schema.sessionPresets)
			.values({ name: "Cast first", genreId: "core:genre/story" })
			.returning()
		presetId = preset.id
		const { writePresetChanges } = await import("$lib/server/pipelines/registrations/presetRows")
		await writePresetChanges(db as any, presetId, {
			change: [{ key: "message-respond→story-respond", values: { [NODE]: { [SLOT]: { [PATH]: REORDERED } } } }]
		})

		const [session] = await db
			.insert(schema.sessions)
			.values({
				isGroup: false,
				userId: adminId,
				presetId: preset.id
			})
			.returning()
		sessionId = session.id
	}, 60_000)

	it("stores the reorder as the preset's change", async () => {
		const [row] = await db
			.select()
			.from(schema.registrations)
			.where(eq(schema.registrations.presetId, presetId))
		expect(((row!.values as any)[NODE][SLOT][PATH] as { id: string }[]).map((b) => b.id)).toEqual([
			"characters",
			"instructions",
			"scenario",
			"worldLore"
		])
	})

	it("a session born on that preset inherits it, with no preset-lane read", async () => {
		const resolved = await resolvedBlocks(sessionId)
		expect(
			(resolved?.value as { id: string }[]).map((b) => b.id),
			"the preset's change did not reach the run — " +
				"the value cascade's preset layer is what carries it (R38)"
		).toEqual(["characters", "instructions", "scenario", "worldLore"])
	})

	it("and the prompt comes out in that order", async () => {
		const resolved = await resolvedBlocks(sessionId)
		const rendered = await render({
			allocation: {
				blocks: [],
				totalTokens: 0,
				budget: { total: 100, used: 0, remaining: 100 },
				groups: {}
			},
			engine: CORE_TEMPLATE_ENGINE,
			messages: [],
			template: SHIPPED_CONTEXT_TEMPLATE,
			templateContext: {
				characters: "CHARACTERS",
				instructions: "INSTRUCTIONS",
				scenario: "SCENARIO",
				personas: "PERSONAS"
			},
			blocks: resolved?.value
		})
		const text = rendered.rendered!
		expect(text.indexOf("CHARACTERS")).toBeGreaterThan(-1)
		expect(text.indexOf("CHARACTERS")).toBeLessThan(
			text.indexOf("INSTRUCTIONS")
		)
		// Switched off, so it is not in the prompt at all — and neither is a
		// block the pack never listed.
		expect(text).not.toContain("SCENARIO")
		expect(text).not.toContain("PERSONAS")
		expect(rendered.notes).toContainEqual(
			"prompt blocks, in order: characters, instructions, worldLore."
		)
	})
})
