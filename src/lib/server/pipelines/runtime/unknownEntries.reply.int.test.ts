/**
 * 🚧 Story's own-turn knowledge filter, over the real reply road
 * (`runReply` → shipped `story-respond`, real handlers, real DB); only the
 * model is faked and every assembled prompt is kept.
 *
 * A cast member's own turn leaves out an entry marked not common knowledge
 * unless the member has an active tie to it; a narrator turn reads everything.
 * The Lair's half is `sessions.lairUnknownEntries.int.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { createHash } from "crypto"
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
import {
	NOTHING_MARKED_RECEIPT,
	setEntryCommonKnowledge,
	writeKnowledgeTie
} from "$lib/server/lorebooks/entryKnowledge"

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

/** The notes of the `unknown-entries` node on the newest reply run. */
async function unknownEntriesNotes(w: World) {
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
	const node = ((run.receipt as { nodes: any[] }).nodes ?? []).find((x) =>
		/unknownEntries/.test(String(x.nodeKey))
	)
	return node ? ((node.notes as string[] | undefined) ?? []) : null
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex")

/** Where two prompts first part, with the words around it. */
const firstDifference = (a: string, b: string) => {
	if (a === b) return "identical"
	let i = 0
	while (a[i] === b[i]) i++
	return `at ${i}: ${JSON.stringify(a.slice(i - 60, i + 80))} vs ${JSON.stringify(b.slice(i - 60, i + 80))}`
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-unknown-entries-reply-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "unknown-entries-reply")).id

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

describe("Story's own turn and the knowledge filter", () => {
	it("a: nothing marked, the speaker's prompt holds the entry; two fresh worlds give one prompt", async () => {
		const first = await world()
		const a = await reply(first, asMira(first))
		expect(a.prompt).toContain(SECRET)
		const second = await world()
		const b = await reply(second, asMira(second))
		expect(b.prompt).toContain(SECRET)
		console.info(
			`[unknown-entries story baseline] sha256=${sha(a.prompt)} statements=${a.statements} (second world ${sha(b.prompt)}, ${b.statements})`
		)
		expect(firstDifference(a.prompt, b.prompt)).toBe("identical")
	})

	it("b: the node's receipt holds the nothing-marked sentence", async () => {
		const w = await world()
		await reply(w, asMira(w))
		const notes = await unknownEntriesNotes(w)
		expect(
			notes,
			"no unknown-entries node on the run's receipt"
		).not.toBeNull()
		expect(notes!.join(" ")).toContain(NOTHING_MARKED_RECEIPT)
	})

	it("c: marked and untied, her own turn lacks the entry", async () => {
		const w = await world()
		await setEntryCommonKnowledge(db as never, {
			userId,
			entryId: w.entryId,
			notCommonKnowledge: true
		})
		const { prompt } = await reply(w, asMira(w))
		expect(prompt).not.toContain(SECRET)
	})

	it("d: marked and untied, the narrator's turn still reads it", async () => {
		const w = await world()
		await setEntryCommonKnowledge(db as never, {
			userId,
			entryId: w.entryId,
			notCommonKnowledge: true
		})
		const { prompt } = await reply(w, { kind: "respond" })
		expect(prompt).toContain(SECRET)
	})

	it("e: marked and tied with 'knows', her own turn holds the entry again", async () => {
		const w = await world()
		await setEntryCommonKnowledge(db as never, {
			userId,
			entryId: w.entryId,
			notCommonKnowledge: true
		})
		await writeKnowledgeTie(db as never, {
			userId,
			lorebookId: w.lorebookId,
			castMemberId: w.member,
			entryId: w.entryId,
			kind: "knows"
		})
		const { prompt } = await reply(w, asMira(w))
		expect(prompt).toContain(SECRET)
	})
})
