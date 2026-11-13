/**
 * Story's retired reply tick leaves its stored settings at boot, quietly and
 * once: the two node keys go from every registration row of the reply, from
 * its instance values and its session settings, and nothing else goes with
 * them — not another node's values, not another spec's `tick`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import { REGISTRATION_KEY_JOIN, registrationKeyOf } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	replyStepKeys,
	type TestDb
} from "$lib/server/utils/testDb"
import { genreChangeKey } from "$lib/server/pipelines/registrations/rows"
import { dropReplyTickSettings, REPLY_TICK_NODE_KEYS } from "./replyTickDrop"
import "@serene-pub/contracts"
import "@serene-pub/core-catalog"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const STORY_RESPOND = "core:spec/story-respond"
const OTHER = "acme:spec/other"
const TRIGGER = {
	family: "event" as const,
	event: "core:event/message-respond@1"
}
const OTHER_TRIGGER = {
	family: "event" as const,
	event: "core:event/round-ended@1"
}

let db: TestDb
let dataDir: string
let otherNode: string
let presetId: number
let sessionId: number
let storyRespondId: number
let otherSpecId: number
let configId: number

const KEY = registrationKeyOf(TRIGGER, STORY_RESPOND)
const OTHER_KEY = registrationKeyOf(OTHER_TRIGGER, OTHER)
const PARAMS = { params: { by: 3 } }
const KEPT = { params: { temperature: 0.5 } }

const bootstrap = async () => {
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	return await bootstrapPipelines(db)
}
const seeded = async () => {
	const rows = await db
		.select({
			key: schema.registrations.key,
			scopeKind: schema.registrations.scopeKind,
			values: schema.registrations.values
		})
		.from(schema.registrations)
		.where(and(eq(schema.registrations.origin, "reply-tick-test")))
	return rows.sort((a, b) =>
		(a.scopeKind + a.key).localeCompare(b.scopeKind + b.key)
	)
}
const specRows = async () =>
	(
		await db
			.select({
				slug: schema.pipelineSpecs.slug,
				iv: schema.pipelineSpecs.instanceValues
			})
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND))
	)[0]!.iv
const overrideKeys = async (specId: number) =>
	(
		await db
			.select({ nodeKey: schema.pipelineNodeOverrides.nodeKey })
			.from(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.specId, specId))
	)
		.map((r) => r.nodeKey)
		.sort()

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-reply-tick-drop-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = await createTestDb()
	await bootstrap()
	otherNode = (await replyStepKeys(db, STORY_RESPOND)).generate
	const userId = (await createTestUser(db, "reply-tick-drop")).id
	const [preset] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-story-living"))
	presetId = preset!.id
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: "tick drop" })
		.returning()
	sessionId = session!.id
	const [respond] = await db
		.select({ id: schema.pipelineSpecs.id })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND))
	storyRespondId = respond!.id
	const [other] = await db
		.insert(schema.pipelineSpecs)
		.values({
			slug: OTHER,
			name: "Other",
			instanceValues: { tick: PARAMS }
		})
		.returning()
	otherSpecId = other!.id

	const both = {
		tick: PARAMS,
		"clock.moves.advance": PARAMS,
		[otherNode]: KEPT
	}
	await db.insert(schema.registrations).values([
		// A Story session's own registration of the reply.
		{
			scopeKind: "session",
			scopeRef: String(sessionId),
			sessionId,
			key: KEY,
			triggerFamily: "event",
			triggerRef: TRIGGER.event,
			specSlug: STORY_RESPOND,
			values: both,
			origin: "reply-tick-test"
		},
		// A preset's change of it: no spec slug, the key names the pipeline.
		{
			scopeKind: "preset",
			scopeRef: String(presetId),
			presetId,
			key: KEY,
			values: both,
			origin: "reply-tick-test"
		},
		// A genre-scope administrator's change: the key carries a prefix.
		{
			scopeKind: "genre",
			scopeRef: "test:genre/tick",
			key: genreChangeKey(KEY),
			values: { tick: PARAMS },
			origin: "reply-tick-test"
		},
		// Another pipeline's row with a `tick` of its own: left alone.
		{
			scopeKind: "session",
			scopeRef: String(sessionId),
			sessionId,
			key: OTHER_KEY,
			triggerFamily: "event",
			triggerRef: OTHER_TRIGGER.event,
			specSlug: OTHER,
			values: { tick: PARAMS },
			origin: "reply-tick-test"
		}
	])
	await db
		.update(schema.pipelineSpecs)
		.set({ instanceValues: both })
		.where(eq(schema.pipelineSpecs.id, storyRespondId))
	await db.insert(schema.pipelineNodeOverrides).values([
		{
			specId: storyRespondId,
			scopeKind: "session",
			scopeId: sessionId,
			nodeKey: "tick",
			slot: "params",
			path: "by",
			value: 3
		},
		{
			specId: storyRespondId,
			scopeKind: "session",
			scopeId: sessionId,
			nodeKey: otherNode,
			slot: "params",
			path: "x",
			value: 1
		},
		{
			specId: otherSpecId,
			scopeKind: "session",
			scopeId: sessionId,
			nodeKey: "tick",
			slot: "params",
			path: "by",
			value: 3
		}
	])
	const [config] = await db
		.insert(schema.pipelineConfigs)
		.values({ specId: storyRespondId, name: "Mine" })
		.returning()
	configId = config!.id
	await db.insert(schema.pipelineConfigValues).values([
		{
			configId: config!.id,
			nodeKey: "tick",
			slot: "params",
			path: "by",
			value: 3
		},
		{
			configId: config!.id,
			nodeKey: otherNode,
			slot: "params",
			path: "x",
			value: 1
		}
	])
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

describe("dropReplyTickSettings", () => {
	let afterFirst: Awaited<ReturnType<typeof seeded>>

	it("removes the two keys everywhere and nothing else", async () => {
		expect(REGISTRATION_KEY_JOIN).toBeTruthy()
		const report = await dropReplyTickSettings(db)
		expect(report).toEqual({
			registrations: 3,
			instanceValues: 1,
			overrides: 1,
			configValues: 1
		})
		afterFirst = await seeded()
		const by = (scopeKind: string, key: string) =>
			afterFirst.find((r) => r.scopeKind === scopeKind && r.key === key)!
		for (const [kind, key] of [
			["session", KEY],
			["preset", KEY]
		] as const) {
			expect(by(kind, key).values).toEqual({ [otherNode]: KEPT })
			for (const k of REPLY_TICK_NODE_KEYS)
				expect(by(kind, key).values).not.toHaveProperty(k)
		}
		// Nothing left: null, never an empty object.
		expect(by("genre", genreChangeKey(KEY)).values).toBeNull()
		// Another pipeline's `tick` stays.
		expect(by("session", OTHER_KEY).values).toEqual({ tick: PARAMS })
		expect(await specRows()).toEqual({ [otherNode]: KEPT })
		expect(await overrideKeys(storyRespondId)).toEqual([otherNode])
		expect(await overrideKeys(otherSpecId)).toEqual(["tick"])
		const [other] = await db
			.select({ iv: schema.pipelineSpecs.instanceValues })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.id, otherSpecId))
		expect(other!.iv).toEqual({ tick: PARAMS })
		const configRows = await db
			.select({ nodeKey: schema.pipelineConfigValues.nodeKey })
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, configId))
		expect(configRows.map((r) => r.nodeKey)).toEqual([otherNode])
	})

	it("a second run changes nothing", async () => {
		expect(await dropReplyTickSettings(db)).toEqual({
			registrations: 0,
			instanceValues: 0,
			overrides: 0,
			configValues: 0
		})
		expect(await seeded()).toEqual(afterFirst)
	})

	it("a second boot leaves those rows as the first pass left them", async () => {
		const report = await bootstrap()
		expect(report.replyTickDropped).toEqual({
			registrations: 0,
			instanceValues: 0,
			overrides: 0,
			configValues: 0
		})
		expect(await seeded()).toEqual(afterFirst)
		expect(await overrideKeys(storyRespondId)).toEqual([otherNode])
	})
})
