/**
 * 🚧 The graph build's transcript names a character as its seat reads them
 * (plan §27 S2, lane s27-S2-turns): the `fetchSceneMessages` the build hands
 * the builder — captured here, no model involved — names a line's speaker by
 * the seated member's own name (a member of the session's own book too), the
 * card's name when the seat has no member.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertLegacy } from "./store"
import { insertCastMember } from "$lib/server/characters/versions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

let fetchScene:
	| ((
			sessionId: number,
			ids: number[]
	  ) => Promise<Array<{ senderName: string; content: string }>>)
	| null = null

vi.mock("$lib/server/utils/graphBuilder", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/utils/graphBuilder")>()
	return {
		...actual,
		buildGraphFromScenes: async (opts: { fetchSceneMessages?: any }) => {
			fetchScene = opts.fetchSceneMessages
			return {
				proposal: { nodes: [], relationships: [] },
				resolvedSceneCast: [],
				sceneLabels: [],
				seedTempIdMap: {},
				seedNodeNames: {}
			}
		}
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-s27turns-graph-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const [connection] = await testDb
		.insert(schema.connections)
		.values({ name: "Graph default", type: "ollama" })
		.returning()
	const [sampling] = await testDb
		.insert(schema.samplingConfigs)
		.values({ name: "Graph sampling", isImmutable: false })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const model = await ensureConnectionModel(
		testDb as any,
		connection.id,
		"graph-7b"
	)
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(testDb as any, "text->text", {
		connectionId: connection.id,
		connectionModelId: model!.id,
		samplingConfigId: sampling.id
	})
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db

describe("the graph build's transcript names", () => {
	test("a speaker is named by the seated member, a member of the session's own book included; no member reads the card", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const u = await createTestUser(testDb, "graph-names")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Graph book", userId: u.id })
			.returning()
		const [historyEntry] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				historyValues([
					{ lorebookId: lorebook.id, year: 1, content: "" }
				])
			)
			.returning()
		await testDb.insert(schema.scenes).values({
			lorebookId: lorebook.id,
			name: "The meeting",
			summary: "They met.",
			historyEntryId: historyEntry.id
		})
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: u.id,
				isGroup: false,
				lorebookId: lorebook.id
			} as any)
			.returning()
		const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
		const ownBook = await insertOwnBook(db(), {
			sessionId: session.id,
			userId: u.id,
			name: null,
			overlayOf: null,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
		const [wren] = await testDb
			.insert(schema.characters)
			.values({ userId: u.id, name: "Wren", description: "d" })
			.returning()
		const [bare] = await testDb
			.insert(schema.characters)
			.values({ userId: u.id, name: "Bare", description: "d" })
			.returning()
		const m = (
			await insertCastMember(testDb, {
				lorebookId: ownBook.id,
				characterId: wren.id,
				binding: "{{char:graph-wren}}",
				name: "member",
				ownName: "Wren of the Notes"
			} as any)
		).member
		await testDb.insert(schema.sessionCharacters).values([
			{
				sessionId: session.id,
				characterId: wren.id,
				castMemberId: m.id,
				position: 0
			},
			{
				sessionId: session.id,
				characterId: bare.id,
				castMemberId: null,
				position: 1
			}
		] as any)
		const a = await insertLegacy(db(), {
			sessionId: session.id,
			role: "assistant",
			content: "One.",
			characterId: wren.id
		})
		const b = await insertLegacy(db(), {
			sessionId: session.id,
			role: "assistant",
			content: "Two.",
			characterId: bare.id
		})

		const { narrativeGraphBuildHandler } = await import(
			"$lib/server/sockets/narrativeGraph"
		)
		await narrativeGraphBuildHandler.handler(
			{ user: { id: u.id } } as any,
			{ lorebookId: lorebook.id, mode: "replace" } as any,
			(() => {}) as any
		)
		expect(fetchScene).toBeTruthy()
		const lines = await fetchScene!(session.id, [a.id, b.id])
		expect(lines.map((l) => l.senderName)).toEqual([
			"Wren of the Notes",
			"Bare"
		])
	})
})
