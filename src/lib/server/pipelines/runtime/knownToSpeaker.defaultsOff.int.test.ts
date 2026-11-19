/**
 * 🚧 A `false` set as a pipeline's declared default (`.defaults((d) =>
 * d.params(node, { knownToSpeaker: false }))`, stored in the spec's default
 * preset) reaches the world-lore read of Story's reply: Mira's own turn then
 * holds an entry marked not common knowledge. Same harness as
 * `unknownEntries.reply.int.test.ts` (real `runReply`, only the model faked).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	WORLD_LORE_TYPE_ID,
	entryInsert
} from "$lib/server/utils/lorebookEntries"
import { insertCastMember } from "$lib/server/characters/versions"
import { setEntryCommonKnowledge } from "$lib/server/lorebooks/entryKnowledge"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

/** Every prompt the fake model was sent, whole. */
const prompts: string[] = []

class FakeAdapter {
	injected: unknown
	constructor(_p: unknown) {}
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withCompiledPrompt(p: unknown) {
		this.injected = p
		return this
	}
	withStreaming() {
		return this
	}
	async generateText() {
		// The text the model reads; `meta` carries a clock and row ids.
		const { prompt, messages } = (this.injected ?? {}) as {
			prompt?: unknown
			messages?: unknown
		}
		prompts.push(JSON.stringify({ prompt, messages }))
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent("A voice answers.")
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

const SECRET = "The ashguard keep a vault beneath the third bell tower."
const LINE = "Have you seen the ashguard?"
const AT = new Date("2026-01-01T00:00:00.000Z")

let userId: number
let n = 0

/** One world: Mira (carded, seated) and a world-lore entry her line keys to. */
async function world() {
	const tag = ++n
	const [minimal] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-story-minimal"))
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId, name: "Book" } as never)
		.returning()
	const [card] = await db
		.insert(schema.characters)
		.values({ userId, name: "Mira", description: "A scout." } as never)
		.returning()
	const member = (
		await insertCastMember(db, {
			lorebookId: book!.id,
			binding: "{{char:Mira}}",
			characterId: card!.id,
			name: "Mira"
		})
	).member!.id
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: "Session",
			presetId: minimal!.id,
			lorebookId: book!.id
		} as never)
		.returning()
	const sessionId = session!.id
	await db.insert(schema.sessionCharacters).values({
		sessionId,
		characterId: card!.id,
		castMemberId: member,
		position: 0,
		isActive: true
	} as never)
	await db.insert(schema.sessionMessages).values({
		sessionId,
		userId,
		role: "user",
		content: LINE,
		createdAt: AT,
		updatedAt: AT
	} as never)
	const [entry] = await db
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({
				typeId: WORLD_LORE_TYPE_ID,
				lorebookId: book!.id,
				position: 1,
				name: "The Ashguard",
				keys: "ashguard",
				content: SECRET
			})
		)
		.returning()
	return {
		tag,
		sessionId,
		lorebookId: book!.id,
		cardId: card!.id,
		member,
		entryId: entry!.id
	}
}
type World = Awaited<ReturnType<typeof world>>

const fakeSocket = (uid: number) => ({ user: { id: uid }, io: {} }) as never

/** One reply, its assembled prompt and the statements it cost. */
async function reply(w: World, turn: Record<string, unknown>) {
	const { runReply } = await import("$lib/server/utils/runReply")
	const client = (
		db as unknown as {
			$client: { query: (...a: unknown[]) => unknown }
		}
	).$client
	const original = client.query.bind(client)
	let statements = 0
	client.query = (...args: unknown[]) => {
		statements++
		return original(...args)
	}
	prompts.length = 0
	let out
	try {
		out = await runReply({
			socket: fakeSocket(userId),
			emitToUser: () => {},
			sessionId: w.sessionId,
			userId,
			turn: turn as never
		})
	} finally {
		client.query = original
	}
	expect(out.ok, out.error).toBe(true)
	expect(prompts.length).toBe(1)
	return { prompt: prompts[0]!, statements }
}

const asMira = (w: World) => ({ kind: "respond", characterId: w.cardId })

/** The notes of each lore-lane node (world lore, character lore, history) on the newest reply run. */
async function loreLaneNotes(w: World, only: RegExp = /\.(worldLore|characterLore|historyEntries)\.read$/) {
	const runs = await db
		.select({
			receipt: schema.pipelineRuns.receipt,
			specSlug: schema.pipelineRuns.specSlug
		})
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, w.sessionId))
		.orderBy(schema.pipelineRuns.id)
	const run = runs
		.filter((r) => r.specSlug === "core:spec/story-respond")
		.at(-1)!
	return ((run.receipt as { nodes: any[] }).nodes ?? [])
		.filter((x) =>
			only.test(String(x.nodeKey))
		)
		.map((x) => (x.notes as string[] | undefined) ?? [])
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-known-to-speaker-defaults-off-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "known-to-speaker-defaults-off")).id

	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const modelId = (await ensureConnectionModel(
		db,
		textConn!.id,
		"default-7b"
	))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "default",
			isImmutable: false,
			values: {
				contextTokens: 8192,
				responseTokens: 200,
				temperature: 0.1
			},
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as never)
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn!.id,
		connectionModelId: modelId,
		samplingConfigId: sampling!.id
	})
})

afterAll(async () => {
	await releaseDataDir(dataDir)
})

/** Write `knownToSpeaker: false` into Story respond's default preset for its world-lore read, merging into any params row. */
async function declareOff() {
	const { and, eq: same } = await import("drizzle-orm")
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(same(schema.pipelineSpecs.slug, "core:spec/story-respond"))
	const [version] = await db
		.select()
		.from(schema.pipelineSpecVersions)
		.where(same(schema.pipelineSpecVersions.id, spec!.activeVersionId!))
	const nodes = (await db
		.select()
		.from(schema.pipelineNodes)
		.where(same(schema.pipelineNodes.specVersionId, version!.id))) as any[]
	const node = nodes.find(
		(x) => /^core:query\/world-lore(@\d+)?$/.test(x.definitionId) && /worldLore\.read$/.test(x.nodeKey)
	)
	expect(node, "no world-lore read node on the active version").toBeTruthy()
	const [preset] = await db
		.select()
		.from(schema.pipelinePresets)
		.where(
			and(
				same(schema.pipelinePresets.specVersionId, version!.id),
				same(schema.pipelinePresets.isDefault, true)
			)
		)
	expect(preset, "story-respond has no default preset").toBeTruthy()
	const where = and(
		same(schema.pipelinePresetValues.presetId, preset!.id),
		same(schema.pipelinePresetValues.nodeKey, node.nodeKey),
		same(schema.pipelinePresetValues.slot, "params")
	)
	const [existing] = await db.select().from(schema.pipelinePresetValues).where(where)
	if (existing)
		await db
			.update(schema.pipelinePresetValues)
			.set({ value: { ...(existing.value as object), knownToSpeaker: false } })
			.where(where)
	else
		await db.insert(schema.pipelinePresetValues).values({
			presetId: preset!.id,
			nodeKey: node.nodeKey,
			slot: "params",
			value: { knownToSpeaker: false }
		} as never)
}

describe("knownToSpeaker declared off in the pipeline's defaults", () => {
	it("control, then the declared false: Mira's own turn holds the unknown entry", async () => {
		const marked = async () => {
			const w = await world()
			await setEntryCommonKnowledge(db as never, {
				userId,
				entryId: w.entryId,
				notCommonKnowledge: true
			})
			return w
		}
		const before = await marked()
		expect((await reply(before, asMira(before))).prompt).not.toContain(SECRET)

		await declareOff()

		const w = await marked()
		const { prompt } = await reply(w, asMira(w))
		expect(prompt).toContain(SECRET)
		// Only the node the default reaches; the other lore lanes still judge.
		const lanes = await loreLaneNotes(w, /\.worldLore\.read$/)
		expect(lanes.length).toBeGreaterThan(0)
		expect(lanes.flat().join("\n")).not.toMatch(/left out/)
	})
})
