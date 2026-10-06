/**
 * `embed-text`'s connection value leaves named configs quietly, before the
 * reconcile would cull it with a notice — and nothing else goes with it.
 */
import { beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import {
	dropEmbedTextConnectionValues,
	EMBED_TEXT_DEFINITION_ID
} from "./embedTextConnectionDrop"

let db: TestDb
let configId: number

beforeAll(async () => {
	db = await createTestDb()
	const [spec] = await db
		.insert(schema.pipelineSpecs)
		.values({ slug: "core:spec/chat-respond", name: "Respond" })
		.returning()
	const [version] = await db
		.insert(schema.pipelineSpecVersions)
		.values({ specId: spec.id, semver: "1.0.0", canonicalHash: "h" })
		.returning()
	await db
		.update(schema.pipelineSpecs)
		.set({ activeVersionId: version.id })
		.where(eq(schema.pipelineSpecs.id, spec.id))
	await db.insert(schema.pipelineNodes).values([
		{
			specVersionId: version.id,
			nodeKey: "semantic.arm.embed",
			kind: "oracle",
			definitionId: EMBED_TEXT_DEFINITION_ID,
			position: 0
		},
		{
			specVersionId: version.id,
			nodeKey: "generate",
			kind: "oracle",
			definitionId: "core:oracle/generate-text",
			position: 1
		}
	])
	const [config] = await db
		.insert(schema.pipelineConfigs)
		.values({ specId: spec.id, name: "Mine" })
		.returning()
	configId = config.id
	await db.insert(schema.pipelineConfigValues).values([
		// The inert one: goes.
		{
			configId,
			nodeKey: "semantic.arm.embed",
			slot: "connection",
			path: "",
			value: 3
		},
		// Same node, another slot: stays.
		{
			configId,
			nodeKey: "semantic.arm.embed",
			slot: "params",
			path: "topK",
			value: 8
		},
		// A real connection choice on another node: stays.
		{
			configId,
			nodeKey: "generate",
			slot: "connection",
			path: "",
			value: 5
		}
	])
}, 60_000)

const remaining = async () =>
	(
		await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, configId))
	)
		.map((r) => `${r.nodeKey}.${r.slot}${r.path ? "." + r.path : ""}`)
		.sort()

describe("dropEmbedTextConnectionValues", () => {
	it("removes only embed-text's connection value, with no notice", async () => {
		expect(await dropEmbedTextConnectionValues(db)).toBe(1)
		expect(await remaining()).toEqual([
			"generate.connection",
			"semantic.arm.embed.params.topK"
		])
		const notices = await db
			.select()
			.from(schema.pipelineConfigNotices)
			.where(eq(schema.pipelineConfigNotices.configId, configId))
		expect(notices).toEqual([])
	}, 60_000)

	it("is idempotent: a second boot finds nothing", async () => {
		expect(await dropEmbedTextConnectionValues(db)).toBe(0)
		expect(await remaining()).toEqual([
			"generate.connection",
			"semantic.arm.embed.params.topK"
		])
	}, 60_000)
})
