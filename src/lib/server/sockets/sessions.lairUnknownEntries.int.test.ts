/**
 * 🚧 The Lair's delver voice and the knowledge filter, over the real reply
 * road (Pick who speaks on a delver → `core:spec/lair-reply`, real handlers,
 * real DB); only the model is faked and each voice's assembled prompt is kept.
 *
 * A delver's own turn leaves out an entry marked not common knowledge unless
 * the delver has an active tie to it; the Castellan's own turn reads
 * everything. Story's half is `unknownEntries.reply.int.test.ts`.
 */
import { appendFileSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { createHash } from "crypto"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"
import { JSON_INSTRUCTION } from "$lib/server/connections/structuredOutput"
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

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "lair-unknown-entries-test-secret" }
})

const PLAN = {
	beats: ["The torch gutters."],
	speakers: [{ name: "Brannoc", intent: "check the door" }],
	unknownExit: "",
	knockQuestion: "",
	worldHints: { location: "" },
	values: [],
	inventory: []
}
/** Every prose prompt, by whose voice it was written in. */
const proseCalls: Array<{ who: string; prompt: string }> = []

const voiceOf = (prompt: string) =>
	/You are (Brannoc|Vell),/.exec(prompt)?.[1] ??
	(prompt.includes("You are the Castellan, steward") ? "castellan" : null)

class FakeAdapter implements FakeTextAdapter {
	injected: any
	promptBuilder: any = {}
	responseFormat: any
	responseSchema: any
	constructor(_p: any) {}
	stops: any
	withStops(s: any) {
		this.stops = s
		return this
	}
	withStreaming() {
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	abort() {}
	async generateText() {
		const prompt = JSON.stringify(this.injected ?? "")
		const json =
			this.responseFormat === "json" ||
			prompt.includes(JSON.stringify(JSON_INSTRUCTION).slice(1, 40))
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				if (json) {
					onContent(JSON.stringify(PLAN))
					return
				}
				const who = voiceOf(prompt)
				// Without `meta`, which carries a clock and row ids.
				const { prompt: text, messages } = this.injected ?? {}
				proseCalls.push({
					who: who ?? "unknown",
					prompt: JSON.stringify({ prompt: text, messages })
				})
				onContent(
					who && who !== "castellan"
						? `${who} speaks.`
						: "The torch goes out."
				)
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))
vi.mock("$lib/server/utils/resolveTaskConfig", () => ({
	resolveTaskConfig: async () => ({
		connection: { id: 1, type: "koboldcpp", promptFormat: "vicuna" },
		sampling: { id: 1 }
	})
}))
vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
	const real =
		await importOriginal<
			typeof import("$lib/server/connections/capabilityTarget")
		>()
	return {
		...real,
		resolveCapabilityTarget: async (
			db: any,
			req: Parameters<typeof real.resolveCapabilityTarget>[1]
		) => {
			const target = await real.resolveCapabilityTarget(db, req)
			if (target.ok) return target
			return {
				ok: true,
				capability: req.capability,
				connection: {
					id: 1,
					type: "koboldcpp",
					promptFormat: "vicuna"
				},
				sampling: { id: 1 },
				connectionVia: "pipelineConfig",
				samplingVia: "pipelineConfig"
			}
		}
	}
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

const SECRET = "The ashguard keep a vault beneath the third bell tower."
const AT = new Date("2026-01-01T00:00:00.000Z")

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-lair-unknown-entries-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
})

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0

/** A Lair session: Brannoc seated with a cast member, the master's line waiting, and an entry it keys to. */
async function world() {
	const schema = await import("$lib/server/db/schema")
	const { insertLegacy } = await import("$lib/server/messages/store")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `lair-unknown-entries-${++n}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: "The lair" })
		.returning()
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: "Session",
			genreId: "core:genre/lair",
			lorebookId: lorebook!.id,
			genreFields: {}
		})
		.returning()
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId: owner.id, name: "Brannoc", description: "A delver." })
		.returning()
	const member = (
		await insertCastMember(testDb as any, {
			lorebookId: lorebook!.id,
			binding: "{{char:Brannoc}}",
			characterId: card!.id,
			name: "Brannoc"
		})
	).member!.id
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: row!.id,
		characterId: card!.id,
		castMemberId: member,
		isActive: true,
		position: 0
	})
	await insertLegacy(testDb as any, {
		sessionId: row!.id,
		role: "user",
		content: "I open the door and ask about the ashguard.",
		userId: owner.id,
		createdAt: AT,
		updatedAt: AT
	})
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({
				typeId: WORLD_LORE_TYPE_ID,
				lorebookId: lorebook!.id,
				position: 1,
				name: "The Ashguard",
				keys: "ashguard",
				content: SECRET
			})
		)
		.returning()
	return {
		owner,
		session: row!,
		lorebookId: lorebook!.id,
		brannoc: card!.id,
		member,
		entryId: entry!.id
	}
}
type World = Awaited<ReturnType<typeof world>>

const mark = (w: World) =>
	setEntryCommonKnowledge(testDb as any, {
		userId: w.owner.id,
		entryId: w.entryId,
		notCommonKnowledge: true
	})

function recordingIo(userId: number, sessionId: number) {
	const socketId = `socket-${userId}`
	const sockets = new Map([
		[
			socketId,
			{
				id: socketId,
				user: { id: userId, isAdmin: false },
				interest: new Set([
					`sessionMessage#${sessionId}`,
					`sessionMessageDelta#${sessionId}`,
					`sessions:runStatus#${sessionId}`,
					`sessions:actions#${sessionId}`,
					`state:changed#${sessionId}`
				])
			}
		]
	])
	return {
		sockets: {
			adapter: {
				rooms: {
					get: (room: string) =>
						room === `user_${userId}`
							? new Set([socketId])
							: undefined
				}
			},
			sockets: {
				get: (id: string) => sockets.get(id),
				values: () => sockets.values()
			}
		},
		to: () => ({ emit: () => {} })
	} as any
}

/** Fire one turn; the voice's prompt and the statements the whole turn cost. */
async function fire(w: World, entry: Record<string, unknown>, voice: string) {
	const { sessionsFireTurnHandler } = await import("./sessions")
	const client = (
		testDb as unknown as {
			$client: { query: (...a: unknown[]) => unknown }
		}
	).$client
	const original = client.query.bind(client)
	let statements = 0
	client.query = (...args: unknown[]) => {
		statements++
		return original(...args)
	}
	proseCalls.length = 0
	try {
		const res = await sessionsFireTurnHandler.handler(
			{
				user: { id: w.owner.id, isAdmin: false },
				io: recordingIo(w.owner.id, w.session.id)
			} as any,
			{ sessionId: w.session.id, entry } as any,
			() => {}
		)
		expect((res as any)?.error).toBeUndefined()
		await (
			await import("$lib/server/pipelines/runtime/sessionEvents")
		).settleSessionEvents()
	} finally {
		client.query = original
	}
	const mine = proseCalls.filter((c) => c.who === voice)
	expect(
		mine.length,
		`no ${voice} prose call among ${proseCalls.map((c) => c.who)}`
	).toBe(1)
	return { prompt: mine[0]!.prompt, statements }
}

const pickBrannoc = (w: World) =>
	fire(w, { ref: `character:${w.brannoc}`, via: "pick" }, "Brannoc")

/** The notes of each lore-lane node (world lore, character lore, history) on the newest `lair-reply` run. */
async function loreLaneNotes(w: World) {
	const schema = await import("$lib/server/db/schema")
	const runs = await testDb
		.select({
			receipt: schema.pipelineRuns.receipt,
			specSlug: schema.pipelineRuns.specSlug
		})
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, w.session.id))
		.orderBy(asc(schema.pipelineRuns.id))
	const run = runs
		.filter((r) => r.specSlug === "core:spec/lair-reply")
		.at(-1)!
	return ((run.receipt as { nodes: any[] }).nodes ?? [])
		.filter((x) =>
			/\.(worldLore|characterLore|historyEntries)\.read$/.test(String(x.nodeKey))
		)
		.map((x) => (x.notes as string[] | undefined) ?? [])
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex")
/** kn-2 lane evidence: with `KN2_SHA_LOG` set, each prompt's sha line is also appended there. */
const kn2Note = (line: string) => {
	console.info(line)
	if (process.env.KN2_SHA_LOG) appendFileSync(process.env.KN2_SHA_LOG, line + "\n")
}

/** Where two prompts first part, with the words around it. */
const firstDifference = (a: string, b: string) => {
	if (a === b) return "identical"
	let i = 0
	while (a[i] === b[i]) i++
	return `at ${i}: ${JSON.stringify(a.slice(i - 60, i + 80))} vs ${JSON.stringify(b.slice(i - 60, i + 80))}`
}

describe("The Lair's delver turn and the knowledge filter", () => {
	test("a: nothing marked, the delver's prompt holds the entry; two fresh worlds give one prompt", async () => {
		const first = await world()
		const a = await pickBrannoc(first)
		expect(a.prompt).toContain(SECRET)
		const second = await world()
		const b = await pickBrannoc(second)
		expect(b.prompt).toContain(SECRET)
		kn2Note(
			`[unknown-entries lair baseline] sha256=${sha(a.prompt)} statements=${a.statements} (second world ${sha(b.prompt)}, ${b.statements})`
		)
		expect(firstDifference(a.prompt, b.prompt)).toBe("identical")
	})

	test("b: each lore-lane node's receipt holds the nothing-marked sentence", async () => {
		const w = await world()
		await pickBrannoc(w)
		const lanes = await loreLaneNotes(w)
		expect(lanes.length, "no lore-lane node on the run's receipt").toBeGreaterThan(0)
		for (const notes of lanes)
			expect(notes.join(" ")).toContain(NOTHING_MARKED_RECEIPT)
	})

	test("c: marked and untied, the delver's own turn lacks the entry", async () => {
		const w = await world()
		await mark(w)
		const { prompt, statements } = await pickBrannoc(w)
		kn2Note(`[kn-2 lair c] sha256=${sha(prompt)} statements=${statements}`)
		expect(prompt).not.toContain(SECRET)
	})

	test("d: marked and untied, the Castellan's own turn still reads it", async () => {
		const w = await world()
		await mark(w)
		const { prompt, statements } = await fire(w, { ref: null }, "castellan")
		kn2Note(`[kn-2 lair d] sha256=${sha(prompt)} statements=${statements}`)
		expect(prompt).toContain(SECRET)
	})

	test("e: marked and tied with 'knows', the delver's own turn holds the entry again", async () => {
		const w = await world()
		await mark(w)
		await writeKnowledgeTie(testDb as any, {
			userId: w.owner.id,
			lorebookId: w.lorebookId,
			castMemberId: w.member,
			entryId: w.entryId,
			kind: "knows"
		})
		const { prompt, statements } = await pickBrannoc(w)
		kn2Note(`[kn-2 lair e] sha256=${sha(prompt)} statements=${statements}`)
		expect(prompt).toContain(SECRET)
	})
})
