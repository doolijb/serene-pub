/**
 * The post-history trigger reaches every stage that assembles a prompt.
 *
 * The two numbers a person sets on a Session Prompt — how deep the reminder
 * sits and how long the session must be before it appears at all — are a
 * projection onto the `params` slot of an ASSEMBLE node. A pipeline with one of
 * those is served by naming its key; a genre that plans, narrates, gives each
 * speaker a voice and then writes the numbers down has four, and three of them
 * resolving the declaration's `0` means the reminder goes out on every turn
 * while the panel shows the number somebody set.
 *
 * That is invisible from the inside: nothing errors, the prompt is well-formed,
 * and the only evidence is a "Response reminder" block in a two-message
 * session. So it is asserted here, against the published specs, node by node.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import { resolveConfigSources } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	ADVENTURE_RESPOND_SPEC_ID,
	RESPOND_SPEC_ID
} from "$lib/server/pipelines/specs"

let db: TestDb
let dataDir: string
let userId: number
let sessionId: number
/** The instance-wide Session Prompt, carrying a trigger nothing short passes. */
let strictConfigId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "post-history-params-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-post-history-params-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "post-history-user", isAdmin: false })
		.returning()
	userId = user.id
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	sessionId = session.id

	const [config] = await db
		.insert(schema.promptConfigs)
		.values({
			name: "Strict reminder",
			systemPrompt: "You are {{char}}.",
			postHistoryInstructions: "Write one reply only.",
			postHistoryDepth: 2,
			postHistoryTokenTrigger: 100000
		})
		.returning()
	strictConfigId = config.id
	await db
		.update(schema.systemSettings)
		.set({ defaultPromptConfigId: strictConfigId })

	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** The specs' own answer to "which nodes assemble a prompt here". */
const assembleKeysOf = async (slug: string): Promise<string[]> => {
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
	const nodes = await db
		.select()
		.from(schema.pipelineNodes)
		.where(
			and(
				eq(schema.pipelineNodes.specVersionId, spec.activeVersionId!),
				eq(schema.pipelineNodes.definitionId, "core:task/assemble")
			)
		)
	return nodes.map((n) => n.nodeKey)
}

const triggersFor = async (slug: string, keys: string[]) => {
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	const world = await buildWorld(db, { sessionId, specId: slug })
	const sourced = resolveConfigSources(world as any, keys)
	return Object.fromEntries(
		keys.map((k) => [k, sourced[k]?.params?.postHistoryTokenTrigger])
	)
}

describe("the Session Prompt's post-history numbers", () => {
	it("reach the reply pipeline's one assemble node", async () => {
		const resolved = await triggersFor(RESPOND_SPEC_ID, ["prompt"])
		expect(resolved.prompt?.value).toBe(100000)

		const { buildWorld } = await import(
			"$lib/server/pipelines/config/world"
		)
		const world = await buildWorld(db, {
			sessionId,
			specId: RESPOND_SPEC_ID
		})
		const sourced = resolveConfigSources(world as any, ["prompt"])
		expect(sourced.prompt?.params?.postHistoryDepth?.value).toBe(2)
	}, 60_000)

	it("reach every assemble node of a genre that has several", async () => {
		const keys = await assembleKeysOf(ADVENTURE_RESPOND_SPEC_ID)
		// The premise. On a pipeline with one assemble node, naming a key and
		// walking the spec are the same answer and this test proves nothing.
		expect(keys.length).toBeGreaterThan(1)
		expect(keys).toContain("scenePrompt")

		const resolved = await triggersFor(ADVENTURE_RESPOND_SPEC_ID, keys)
		for (const key of keys)
			expect(
				resolved[key]?.value,
				`${key} resolves the trigger somebody set`
			).toBe(100000)
	}, 60_000)

	it("give way to a value set on that node in the pipeline panel", async () => {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, ADVENTURE_RESPOND_SPEC_ID))
		await db.insert(schema.pipelineNodeOverrides).values({
			specId: spec.id,
			scopeKind: "session",
			scopeId: sessionId,
			nodeKey: "scenePrompt",
			slot: "params",
			path: "postHistoryTokenTrigger",
			value: 500,
			updatedBy: userId
		})

		const keys = await assembleKeysOf(ADVENTURE_RESPOND_SPEC_ID)
		const resolved = await triggersFor(ADVENTURE_RESPOND_SPEC_ID, keys)
		expect(resolved.scenePrompt?.value).toBe(500)
		for (const key of keys.filter((k) => k !== "scenePrompt"))
			expect(
				resolved[key]?.value,
				`${key} keeps the Session Prompt's number`
			).toBe(100000)

		await db
			.delete(schema.pipelineNodeOverrides)
			.where(
				and(
					eq(schema.pipelineNodeOverrides.specId, spec.id),
					eq(schema.pipelineNodeOverrides.nodeKey, "scenePrompt")
				)
			)
	}, 60_000)

	it("take the session's own Session Prompt over the instance default", async () => {
		const [own] = await db
			.insert(schema.promptConfigs)
			.values({
				name: "This session's reminder",
				systemPrompt: "You are {{char}}.",
				postHistoryInstructions: "Write one reply only.",
				postHistoryTokenTrigger: 7
			})
			.returning()
		await db
			.update(schema.sessions)
			.set({ promptConfigId: own.id })
			.where(eq(schema.sessions.id, sessionId))

		const keys = await assembleKeysOf(ADVENTURE_RESPOND_SPEC_ID)
		const resolved = await triggersFor(ADVENTURE_RESPOND_SPEC_ID, keys)
		for (const key of keys)
			expect(resolved[key]?.value, `${key} reads the session's`).toBe(7)

		await db
			.update(schema.sessions)
			.set({ promptConfigId: null })
			.where(eq(schema.sessions.id, sessionId))
	}, 60_000)
})
