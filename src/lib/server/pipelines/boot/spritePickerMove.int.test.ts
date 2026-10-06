/**
 * The sprite picker's stored settings follow it to its new node key, once
 * (plan PLAN-embeddings-ner-connections D4, ruled 2026-10-05): from the
 * retired tail's `spriteTail.show.spritePick` to `spritePick`, on the four
 * specs the wrapper wrapped. Idempotent, a value already at the new address
 * wins, and nothing outside those specs or that key moves.
 */

import { beforeAll, describe, expect, it } from "vitest"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import { moveSpritePickerSettings } from "./spritePickerMove"

const OLD = "spriteTail.show.spritePick"
const NEW = "spritePick"

let db: TestDb
let userId: number
const specs: Record<string, number> = {}

beforeAll(async () => {
	db = await createTestDb()
	userId = (await createTestUser(db, "sprite-picker-move")).id
	for (const slug of [
		"core:spec/chat-respond",
		"core:spec/tool-loop",
		"core:spec/chat-side-character",
		"core:spec/guide-respond",
		// Two of the four before the 2026-10-05 spec id rename: a database
		// the rename pass has not reached yet holds these spellings.
		"core:spec/respond",
		"core:spec/narrate-character",
		// Never carried the tail: a row at the old key here is not core's to move.
		"acme:spec/room"
	]) {
		const [row] = await db
			.insert(schema.pipelineSpecs)
			.values({ slug, name: slug })
			.returning()
		specs[slug] = row.id
	}
}, 60_000)

async function makeSession() {
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: "sprites" })
		.returning()
	return session.id
}

const override = (
	spec: string,
	sessionId: number,
	nodeKey: string,
	path: string,
	value: unknown
) =>
	db.insert(schema.pipelineNodeOverrides).values({
		specId: specs[spec]!,
		scopeKind: "session",
		scopeId: sessionId,
		nodeKey,
		slot: "params",
		path,
		value: value as any,
		updatedBy: userId
	})

const overridesAt = (spec: string, sessionId: number, nodeKey: string) =>
	db
		.select()
		.from(schema.pipelineNodeOverrides)
		.where(
			and(
				eq(schema.pipelineNodeOverrides.specId, specs[spec]!),
				eq(schema.pipelineNodeOverrides.scopeId, sessionId),
				eq(schema.pipelineNodeOverrides.nodeKey, nodeKey)
			)
		)

describe("the sprite picker's settings move to `spritePick`", () => {
	it("moves session settings on each of the four specs, keeping who set them", async () => {
		const sessionId = await makeSession()
		await override("core:spec/chat-respond", sessionId, OLD, "enabled", false)
		await override("core:spec/chat-respond", sessionId, OLD, "margin", 0.2)
		await override("core:spec/guide-respond", sessionId, OLD, "floor", 0.3)
		await override("core:spec/tool-loop", sessionId, OLD, "enabled", false)
		await override(
			"core:spec/chat-side-character",
			sessionId,
			OLD,
			"enabled",
			false
		)

		const report = await moveSpritePickerSettings(db as any)
		expect(report.moved.overrides).toBe(5)

		for (const spec of [
			"core:spec/chat-respond",
			"core:spec/guide-respond",
			"core:spec/tool-loop",
			"core:spec/chat-side-character"
		])
			expect(await overridesAt(spec, sessionId, OLD)).toEqual([])
		const respond = await overridesAt("core:spec/chat-respond", sessionId, NEW)
		expect(
			Object.fromEntries(respond.map((r) => [r.path, r.value]))
		).toEqual({ enabled: false, margin: 0.2 })
		expect(
			respond.every((r) => r.updatedBy === userId && r.slot === "params")
		).toBe(true)
		expect(
			(await overridesAt("core:spec/guide-respond", sessionId, NEW)).map(
				(r) => [r.path, r.value]
			)
		).toEqual([["floor", 0.3]])
	}, 60_000)

	it("finds a spec still at its pre-rename slug", async () => {
		const sessionId = await makeSession()
		await override("core:spec/respond", sessionId, OLD, "enabled", false)
		await override(
			"core:spec/narrate-character",
			sessionId,
			OLD,
			"floor",
			0.25
		)

		const report = await moveSpritePickerSettings(db as any)
		expect(report.moved.overrides).toBe(2)
		expect(
			(await overridesAt("core:spec/respond", sessionId, NEW)).map(
				(r) => [r.path, r.value]
			)
		).toEqual([["enabled", false]])
		expect(
			(
				await overridesAt("core:spec/narrate-character", sessionId, NEW)
			).map((r) => [r.path, r.value])
		).toEqual([["floor", 0.25]])
	}, 60_000)

	it("is idempotent: a second boot moves nothing", async () => {
		await moveSpritePickerSettings(db as any)
		const again = await moveSpritePickerSettings(db as any)
		expect(again).toEqual({
			moved: { overrides: 0, rebinds: 0, configValues: 0 },
			kept: 0
		})
	}, 60_000)

	it("a value already at the new address wins, and the old row goes", async () => {
		const sessionId = await makeSession()
		await override("core:spec/chat-respond", sessionId, NEW, "enabled", true)
		await override("core:spec/chat-respond", sessionId, OLD, "enabled", false)
		const report = await moveSpritePickerSettings(db as any)
		expect(report).toMatchObject({ moved: { overrides: 0 }, kept: 1 })
		expect(await overridesAt("core:spec/chat-respond", sessionId, OLD)).toEqual(
			[]
		)
		expect(
			(await overridesAt("core:spec/chat-respond", sessionId, NEW)).map(
				(r) => r.value
			)
		).toEqual([true])
	}, 60_000)

	it("moves session rebinds and config values; leaves an instance rebind and another spec's rows", async () => {
		const sessionId = await makeSession()
		await db.insert(schema.pipelineNodeRebinds).values([
			{
				specId: specs["core:spec/chat-respond"]!,
				scopeKind: "session",
				scopeId: sessionId,
				nodeKey: OLD,
				definitionId: "acme:oracle/pick-by-mood@1"
			},
			{
				specId: specs["core:spec/chat-respond"]!,
				scopeKind: "pub",
				scopeId: 0,
				nodeKey: OLD,
				definitionId: "acme:oracle/pick-by-mood@1"
			}
		])
		const [config] = await db
			.insert(schema.pipelineConfigs)
			.values({
				specId: specs["core:spec/tool-loop"]!,
				name: "Quiet faces"
			})
			.returning()
		await db.insert(schema.pipelineConfigValues).values({
			configId: config.id,
			nodeKey: OLD,
			slot: "params",
			path: "margin",
			value: 0.4 as any
		})
		await override("acme:spec/room", sessionId, OLD, "enabled", false)

		const report = await moveSpritePickerSettings(db as any)
		expect(report.moved).toEqual({
			overrides: 0,
			rebinds: 1,
			configValues: 1
		})

		const rebinds = await db
			.select()
			.from(schema.pipelineNodeRebinds)
			.where(
				eq(
					schema.pipelineNodeRebinds.specId,
					specs["core:spec/chat-respond"]!
				)
			)
		expect(rebinds.map((r) => [r.scopeKind, r.nodeKey]).sort()).toEqual([
			["pub", OLD],
			["session", NEW]
		])
		const values = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, config.id))
		expect(values.map((v) => [v.nodeKey, v.path, v.value])).toEqual([
			[NEW, "margin", 0.4]
		])
		expect(
			(await overridesAt("acme:spec/room", sessionId, OLD)).length
		).toBe(1)
	}, 60_000)
})
