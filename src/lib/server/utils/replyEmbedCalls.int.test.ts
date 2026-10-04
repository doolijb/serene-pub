/**
 * What one Chat turn asks of its models, with an embedding model ready: one
 * generation, plus the one probe embed Search by meaning makes when it
 * searches (plan C3, genre uplift 2026-09-29; corrected 2026-09-30).
 *
 * ## The defect this pins shut
 *
 * The semantic mechanism's switch used to be `vector-search.maxEntries = 0`,
 * which sits on the **last** node of the `semantic.arm` chain. So on every
 * shipped Chat turn, lorebook or not, `query-windows` cut its probes and
 * `embed-text` embedded them before `vector-search` threw the vectors away.
 * In API embedding mode that was a provider call per turn that bought
 * nothing. `replyRoad.int.test.ts` could never see it: it mocks
 * `isModelReady: () => false`, and a model that is not ready makes no call.
 *
 * The switch is now `query-windows.searchByMeaning`, on the chain's **first**
 * node — the entity-vector mechanism's shape (`mention-spans.maxMentions`).
 * Off, the queries step asks nothing, `embed-text` is handed no texts and
 * makes no call, and `vector-search` returns before its reads.
 *
 * ## Automatic, the shipped setting (owner, corrected 2026-09-30)
 *
 * The switch is `auto | on | off`, shipping `auto`, and `auto` searches
 * whenever an embedding model is **set up** — a local ONNX model, an Ollama, a
 * KoboldCPP, an embedding service billed per request: any of them. It skips
 * only when there is none (R5: an optional mechanism that is unavailable is
 * skipped). `on` and `off` override it both ways.
 *
 * ⚠ For one day (2026-09-29, read into ruling F1) `auto` searched only when
 * the embedding model ran **on this machine**, and an embedding service —
 * the thing a person sets one up FOR — was never asked. The owner, 09-30:
 * *"I never said to skip paid services for retrieval, that's what they are
 * there for. Don't do that."* So the service cases below search, on the same
 * terms as the local ones, and nothing here asks where a model runs.
 *
 * "Set up" is the embedding **connection**, read off the capability default
 * for `text->embedding` — the star — which is what the embed step's
 * connection slot resolves to. The model's readiness is the mocked module's,
 * as before: a star with no model loaded still costs no embed.
 *
 * ## What is asserted, and on what
 *
 * On spies, never on receipt node counts: the embed oracle executes either
 * way, so "how many nodes ran" cannot tell a model call from a no-op.
 *
 *  - `embed` / `batchEmbed` — every in-run embedding call, whatever asked.
 *  - `dispatchGeneration` — every text-model call the run makes.
 *  - `ensureSessionMessageEmbedded` — the reply's own index embed after it
 *    lands. Counted separately and on purpose: it is the indexing lane a
 *    person opts into by starring an embedding model, not a retrieval call,
 *    and whether it counts against "one call" is an owner question (C3 (d)).
 *
 * Driven through `runReply` against the SHIPPED `core:spec/respond` on the
 * chat-default preset's configuration — the road the socket handlers take.
 *
 * ## The other embed: descriptions to follow up (R5, 2026-10-02)
 *
 * Retrieval is on by default (lorebooks A23(b)), so `mention-spans` ships at
 * 8 and the name arm embeds the turn's descriptions (*"the gate"*) — one call,
 * batched — and `entity-link` embeds each entry name it compares them with
 * once, for its index. That is the descriptive-mentions mechanism's cost, not
 * Search by meaning's, and it happens only where there is a lorebook to link
 * to (no book: the mechanism is unavailable and skipped). So the switch's
 * cases below count the SEARCH's probe embed (`searchEmbeds`, the call
 * carrying the probe text); the mechanism's own cost is pinned in its own
 * describe at the end.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import {
	WORLD_LORE_TYPE_ID,
	entryInsert
} from "$lib/server/utils/lorebookEntries"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

/** Flipped per case: whether an embedding model is loaded and validated. */
let modelReady = false
/** Every in-run embedding call, as the texts it was handed. */
const embedCalls: string[][] = []
/** The search's probe — the latest message, which `query-windows` cuts. */
const PROBE = "Have you seen the ashguard at the gate?"
/** The calls Search by meaning made: the ones carrying its probe. */
const searchEmbeds = () =>
	embedCalls.filter((call) => call.some((t) => t.includes(PROBE)))
/** A toy two-axis vector, so a search that does run has something to rank. */
const toyVector = (text: string) => [
	text.toLowerCase().includes("ashguard") ? 1 : 0,
	1
]
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => modelReady,
	getLoadedModelId: () => (modelReady ? "test-embed-model" : null),
	embed: async (text: string) => {
		embedCalls.push([text])
		return toyVector(text)
	},
	batchEmbed: async (texts: string[]) => {
		embedCalls.push([...texts])
		return texts.map(toyVector)
	}
}))

/** The reply's own index embed — the indexing lane, counted apart. */
const indexedMessages: number[] = []
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async (messageId: number) => {
		indexedMessages.push(messageId)
	},
	autoEnqueueSession: async () => {},
	promoteScopedVectors: async () => ({ promoted: 0 })
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	broadcastToSessionUsers: async () => {}
}))

/** Every generation the run dispatched, as the request dispatch was handed. */
const dispatched: Array<{ compiledPrompt: unknown }> = []
vi.mock("$lib/server/pipelines/runtime/dispatch", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/pipelines/runtime/dispatch")
		>()
	return {
		...actual,
		dispatchGeneration: async (
			request: Parameters<typeof actual.dispatchGeneration>[0]
		) => {
			dispatched.push({ compiledPrompt: request.compiledPrompt })
			return actual.dispatchGeneration(request)
		}
	}
})

class FakeAdapter {
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withCompiledPrompt() {
		return this
	}
	withStreaming() {
		return this
	}
	async generateText() {
		return {
			compiledPrompt: { prompt: "p", messages: undefined, meta: {} as any },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent("The gate was sealed.")
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let userId: number
let characterId: number
let respondSpecId: number

const fakeSocket = (uid: number) => ({ user: { id: uid }, io: {} }) as any

const chatPresetId = async () =>
	(
		await db
			.select({ id: schema.sessionPresets.id })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, "core-chat-default"))
			.limit(1)
	)[0]?.id ?? null

/**
 * A chat-default session with one character and one line from the person —
 * with a lorebook holding one keyed world entry, or with none.
 */
async function makeSession(opts: { lorebook: boolean }) {
	let lorebookId: number | null = null
	if (opts.lorebook) {
		const [lorebook] = await db
			.insert(schema.lorebooks)
			.values({ name: "Gate lore", userId })
			.returning()
		lorebookId = lorebook.id
		await db.insert(schema.lorebookEntries).values(
			entryInsert({
				typeId: WORLD_LORE_TYPE_ID,
				lorebookId: lorebook.id,
				position: 1,
				name: "The Ashguard",
				keys: "ashguard",
				content: "Riders who patrol the ash wastes."
			})
		)
	}
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			presetId: await chatPresetId(),
			...(lorebookId !== null ? { lorebookId } : {})
		})
		.returning()
	await db.insert(schema.sessionCharacters).values({
		sessionId: session.id,
		characterId,
		isActive: true
	})
	await db.insert(schema.sessionMessages).values({
		sessionId: session.id,
		userId,
		role: "user",
		content: "Have you seen the ashguard at the gate?"
	} as any)
	return session.id
}

/** A session-scope value on the reply spec — the panel's write, by hand. */
async function sessionOverride(
	sessionId: number,
	nodeKey: string,
	path: string,
	value: unknown
) {
	await db.insert(schema.pipelineNodeOverrides).values({
		specId: respondSpecId,
		scopeKind: "session",
		scopeId: sessionId,
		nodeKey,
		slot: "params",
		path,
		value: value as any
	})
}

/** The switch, per session — `searchByMeaning` on the queries step. */
const searchByMeaning = (sessionId: number, value: "auto" | "on" | "off") =>
	sessionOverride(sessionId, "semantic.arm.queries", "searchByMeaning", value)

/** The descriptive-mentions mechanism's one switch (on by default since R5). */
const descriptionsToFollowUp = (sessionId: number, value: number) =>
	sessionOverride(sessionId, "names.arm.mentions", "maxMentions", value)

/**
 * Which embedding connection is starred for `text->embedding`, and so what
 * the embed step's connection slot resolves to: an in-process ONNX model, a
 * KoboldCPP, an embedding **service** billed per request (an
 * OpenAI-compatible API), or none at all. Instance-wide, so every case sets
 * it. The three kinds are here to prove Automatic treats them alike.
 */
async function starEmbedding(
	where: "local" | "service" | "koboldcpp" | null
): Promise<number | null> {
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	if (where === null) {
		await setCapabilityDefault(db, "text->embedding", {
			connectionId: null,
			connectionModelId: null
		})
		return null
	}
	const [conn] = await db
		.insert(schema.connections)
		.values(
			(where === "local"
				? {
						name: "Embeddings on this machine",
						type: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
						modality: "embeddings"
					}
				: where === "koboldcpp"
					? {
							// A KoboldCPP you run yourself, serving an embedding
							// model: its type's category is local.
							name: "KoboldCPP embeddings",
							type: CONNECTION_TYPE.KOBOLDCPP,
							baseUrl: "http://localhost:5001"
						}
					: {
							name: "Embeddings service",
							type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
							baseUrl: "http://embeddings.example",
							modality: "embeddings"
						}) as any
		)
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const model = (await ensureConnectionModel(
		db,
		conn.id,
		where === "local" ? "Xenova/all-MiniLM-L6-v2" : "text-embedding-3-small"
	))!
	await setCapabilityDefault(db, "text->embedding", {
		connectionId: conn.id,
		connectionModelId: model.id
	})
	return conn.id
}

/** A pick on the embed step's own connection slot — the panel's write, by hand. */
async function pickEmbedConnection(sessionId: number, connectionId: number) {
	await db.insert(schema.pipelineNodeOverrides).values({
		specId: respondSpecId,
		scopeKind: "session",
		scopeId: sessionId,
		nodeKey: "semantic.arm.embed",
		slot: "connection",
		path: "",
		value: { id: connectionId, modelId: null } as any
	})
}

/** The retrieval explanation's vector-search lines, off a real receipt. */
async function vectorLines(outcome: any) {
	const { explainRetrieval } = await import("$lib/server/sockets/pipelines")
	const { notes } = explainRetrieval(outcome.receipt, new Map())
	return notes.filter((n) => n.startsWith("Vector search:"))
}

/** One turn, with every spy emptied first so it reads that turn alone. */
async function turn(sessionId: number) {
	embedCalls.length = 0
	dispatched.length = 0
	indexedMessages.length = 0
	const { runReply } = await import("$lib/server/utils/runReply")
	const outcome = await runReply({
		socket: fakeSocket(userId),
		emitToUser: () => {},
		sessionId,
		userId,
		turn: { kind: "respond", characterId }
	})
	expect(outcome.error, outcome.error).toBeUndefined()
	expect(outcome.ok).toBe(true)
	return outcome
}

const node = (outcome: any, key: string) =>
	(outcome.receipt?.nodes ?? []).find((n: any) => n.nodeKey === key)

/** Remove what a turn wrote, so the next turn reads the same history. */
async function dropReplies(sessionId: number) {
	await db
		.delete(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.role, "assistant")
			)
		)
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-reply-embed-calls-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb

	const { bootstrapPipelines, RESPOND_SPEC_ID } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const [spec] = await db
		.select({ id: schema.pipelineSpecs.id })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
	respondSpecId = spec!.id

	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "reply-embed-calls")).id
	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Alice", description: "A knight." })
		.returning()
	characterId = character.id

	const [conn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const model = (await ensureConnectionModel(db, conn.id, "default-7b"))!
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Reply embed calls",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200 },
			enabled: ["contextTokens", "responseTokens"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: conn.id,
		connectionModelId: model.id,
		samplingConfigId: sampling.id
	})
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** The queries step's own account of the switch, off the receipt. */
const queriesDiagnostics = (outcome: any) =>
	(node(outcome, "semantic.arm.queries")?.output as any)?.diagnostics

/**
 * Automatic searches with ANY embedding model that is set up — where it runs
 * is not a question it asks (owner, 2026-09-30: *"I never said to skip paid
 * services for retrieval, that's what they are there for"*). One embed — the
 * current window's probe — and one generation, for a local model, a KoboldCPP
 * you run yourself and an embedding service alike.
 */
describe("Automatic, with an embedding model ready: the search runs, wherever the model runs", () => {
	const KINDS = [
		["a local ONNX model", "local"],
		["a KoboldCPP you run yourself", "koboldcpp"],
		["an embedding SERVICE (billed per request)", "service"]
	] as const
	for (const [label, where] of KINDS)
		for (const lorebook of [true, false])
			it(`${label}, ${lorebook ? "with" : "without"} a lorebook: one embed and one generation`, async () => {
				modelReady = true
				await starEmbedding(where)
				const sessionId = await makeSession({ lorebook })
				const outcome = await turn(sessionId)

				expect(dispatched.length).toBe(1)
				expect(
					searchEmbeds().length,
					`Automatic did not search with ${label} set up`
				).toBe(1)
				expect(searchEmbeds()[0]!.join("\n")).toContain(
					"Have you seen the ashguard at the gate?"
				)
				expect(queriesDiagnostics(outcome)).toMatchObject({
					searchByMeaning: "auto",
					searchedByMeaning: true,
					reason: "on — Search by meaning is Automatic and an embedding model is set up"
				})
				// The search ran on that probe (exactly — /available/ also
				// matches "unavailable"), one ranked list for the one query
				// vector — history as well as lore, so a session with no
				// lorebook searches too.
				const search = node(outcome, "semantic.arm.search")
				const diagnostics = (search!.output as any)?.diagnostics
				expect(diagnostics?.vectorSearch).toBe("available (test-embed-model)")
				expect(diagnostics?.queries).toBe(1)
				// No sentence from the switch on a turn that searched.
				expect((await vectorLines(outcome)).join(" ")).not.toContain(
					"Search by meaning"
				)
				// And the reply still reaches the index, through the queue's lane.
				expect(indexedMessages.length).toBe(1)
			})
})

describe("Automatic, with no embedding model set up", () => {
	it("makes no search embed, even with a model reported ready", async () => {
		modelReady = true
		await starEmbedding(null)
		const sessionId = await makeSession({ lorebook: true })
		const outcome = await turn(sessionId)
		expect(dispatched.length).toBe(1)
		expect(searchEmbeds()).toEqual([])
		expect(queriesDiagnostics(outcome)).toMatchObject({
			searchByMeaning: "auto",
			searchedByMeaning: false,
			reason: "off — Search by meaning is Automatic and no embedding model is set up, so the search makes no embedding request"
		})
	})

	/**
	 * The switch's reason wins over the model's. No model is the commonest
	 * install, and on that turn `vector-search` still reads
	 * `embedding_status` and the lore lanes name the model's state — so the
	 * panel said "no embedding model is loaded" where the switch was the
	 * reason. On a real receipt, so the `query-windows` diagnostics the
	 * projection reads are the ones a run actually records.
	 */
	it("says why in the retrieval explanation, not that the model is missing", async () => {
		modelReady = false
		await starEmbedding(null)
		const sessionId = await makeSession({ lorebook: true })
		const outcome = await turn(sessionId)
		expect(await vectorLines(outcome)).toEqual([
			"Vector search: off — Search by meaning is Automatic and no embedding model is set up, so the search makes no embedding request."
		])
	})
})

/**
 * Set up but not READY — starred, not loaded. The switch still searches (it
 * cannot see the model's state: a pure Task handed a connection), and the
 * mechanism is skipped where it is unavailable (R5): `embed-text` makes no
 * call, and `vector-search` names the model, which is the thing to fix. Alike
 * for a local model and a service.
 */
describe("Automatic, with an embedding model set up but not ready", () => {
	for (const where of ["local", "service"] as const)
		it(`${where}: makes no embed, and names the model rather than the switch`, async () => {
			modelReady = false
			await starEmbedding(where)
			const sessionId = await makeSession({ lorebook: true })
			const outcome = await turn(sessionId)
			expect(dispatched.length).toBe(1)
			expect(searchEmbeds()).toEqual([])
			expect(queriesDiagnostics(outcome)).toMatchObject({
				searchByMeaning: "auto",
				searchedByMeaning: true
			})
			expect(await vectorLines(outcome)).toEqual([
				"Vector search: no embedding model is loaded and validated."
			])
		})
})

describe("the prompt does not depend on a model while the search is off", () => {
	/**
	 * Off is the same prompt as no model at all, whatever model is set up —
	 * a service as much as a local one: the switch is the whole of the
	 * difference, never where the model runs.
	 */
	for (const where of ["local", "service"] as const)
		it(`is byte-identical switched Off with a ${where} model as with no model at all`, async () => {
			// One session for both turns: the prompt carries entry ids, so two
			// sessions with two lorebooks could never be byte-identical.
			const sessionId = await makeSession({ lorebook: true })
			// The name arm is the other model-dependent mechanism, and on by
			// default (R5): held off for both turns, so the search switch is
			// the only difference under test.
			await descriptionsToFollowUp(sessionId, 0)

			await starEmbedding(null)
			modelReady = false
			await turn(sessionId)
			expect(dispatched.length).toBe(1)
			const without = JSON.stringify(dispatched[0]!.compiledPrompt)
			expect(without).toContain("Have you seen the ashguard at the gate?")

			await dropReplies(sessionId)
			await starEmbedding(where)
			modelReady = true
			await searchByMeaning(sessionId, "off")
			await turn(sessionId)
			expect(dispatched.length).toBe(1)
			// ⚠ And identical because nothing was asked, not because what was
			// asked was thrown away: the old last-node switch discarded the
			// vectors after paying for them, so without this the case passes
			// on the defect it exists to catch.
			expect(
				searchEmbeds(),
				"the Off turn embedded probes it did not search with"
			).toEqual([])
			expect(JSON.stringify(dispatched[0]!.compiledPrompt)).toBe(without)
		})

	it("is byte-identical on Automatic with a service starred but not ready as with no model at all", async () => {
		const sessionId = await makeSession({ lorebook: true })

		await starEmbedding(null)
		modelReady = false
		await turn(sessionId)
		const without = JSON.stringify(dispatched[0]!.compiledPrompt)

		await dropReplies(sessionId)
		await starEmbedding("service")
		await turn(sessionId)
		expect(dispatched.length).toBe(1)
		expect(searchEmbeds()).toEqual([])
		expect(JSON.stringify(dispatched[0]!.compiledPrompt)).toBe(without)
	})
})

describe("On and Off override Automatic, both ways", () => {
	it("On searches with an embedding service: one embed, one generation", async () => {
		modelReady = true
		await starEmbedding("service")
		const sessionId = await makeSession({ lorebook: true })
		await searchByMeaning(sessionId, "on")
		const outcome = await turn(sessionId)

		expect(dispatched.length).toBe(1)
		// The current window's probe — the person's line — and nothing else.
		expect(searchEmbeds().length).toBe(1)
		expect(searchEmbeds()[0]!.join("\n")).toContain(
			"Have you seen the ashguard at the gate?"
		)
		expect(queriesDiagnostics(outcome)).toMatchObject({
			searchByMeaning: "on",
			searchedByMeaning: true
		})
		const search = node(outcome, "semantic.arm.search")
		const diagnostics = (search!.output as any)?.diagnostics
		expect(diagnostics?.vectorSearch).toBe("available (test-embed-model)")
		expect(diagnostics?.queries).toBe(1)
	})

	for (const where of ["local", "service"] as const)
		it(`Off makes no search embed, even with a ${where} embedding model ready`, async () => {
			modelReady = true
			await starEmbedding(where)
			const sessionId = await makeSession({ lorebook: true })
			await searchByMeaning(sessionId, "off")
			const outcome = await turn(sessionId)

			expect(dispatched.length).toBe(1)
			expect(searchEmbeds()).toEqual([])
			expect(queriesDiagnostics(outcome)).toMatchObject({
				searchByMeaning: "off",
				searchedByMeaning: false
			})
			expect(await vectorLines(outcome)).toEqual([
				"Vector search: off — Search by meaning is off, so the search makes no embedding request."
			])
		})

	it("On costs no embed when a model is not ready", async () => {
		modelReady = false
		await starEmbedding("service")
		const sessionId = await makeSession({ lorebook: true })
		await searchByMeaning(sessionId, "on")
		await turn(sessionId)
		expect(dispatched.length).toBe(1)
		expect(searchEmbeds()).toEqual([])
	})
})

/**
 * Whether a model is set up is decided on the STAR, whatever the embed step's
 * slot names (review 2026-09-29). The host embeds through the star —
 * `embed-text`'s `connection` slot is read by nothing — so a pick there would
 * make *Automatic* decide about a connection the embed never uses. The slot is
 * held at the star (`isUnreadSlot`): the run drops a stored pick.
 */
describe("Automatic decides on the star, not on a pick the embed never uses", () => {
	it("a pick with no star makes no search embed", async () => {
		modelReady = true
		const [picked] = await db
			.insert(schema.connections)
			.values({
				name: "A pick the embed never uses",
				type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
				baseUrl: "http://embeddings.example",
				modality: "embeddings"
			} as any)
			.returning()
		await starEmbedding(null)
		const sessionId = await makeSession({ lorebook: true })
		await pickEmbedConnection(sessionId, picked.id)
		const outcome = await turn(sessionId)

		expect(dispatched.length).toBe(1)
		expect(
			searchEmbeds(),
			"Automatic searched on a pick while no embedding model was starred"
		).toEqual([])
		expect(queriesDiagnostics(outcome)).toMatchObject({
			searchByMeaning: "auto",
			searchedByMeaning: false,
			reason:
				"off — Search by meaning is Automatic and no embedding model is set up, so the search makes no embedding request"
		})
	})

	it("a stale pick naming no row does not hide a service star", async () => {
		modelReady = true
		await starEmbedding("service")
		const sessionId = await makeSession({ lorebook: true })
		await pickEmbedConnection(sessionId, 987_654)
		const outcome = await turn(sessionId)

		expect(searchEmbeds().length).toBe(1)
		expect(queriesDiagnostics(outcome)).toMatchObject({
			searchByMeaning: "auto",
			searchedByMeaning: true
		})
	})
})

describe("Descriptions to follow up: on by default, and only where there is a book (R5)", () => {
	it("with a lorebook: one embed of the turn's descriptions, beside the search's", async () => {
		modelReady = true
		await starEmbedding("local")
		const sessionId = await makeSession({ lorebook: true })
		await turn(sessionId)

		expect(dispatched.length).toBe(1)
		expect(searchEmbeds().length).toBe(1)
		const others = embedCalls.filter((call) => !searchEmbeds().includes(call))
		// The descriptions, in one call; and the names they are compared
		// with, embedded for the link index.
		expect(others).toContainEqual(["the gate"])
		expect(others.flat()).toContain("The Ashguard")
	})

	it("without a lorebook: no embed beyond the search — nothing to link a description to", async () => {
		modelReady = true
		await starEmbedding("local")
		const sessionId = await makeSession({ lorebook: false })
		await turn(sessionId)

		expect(dispatched.length).toBe(1)
		expect(embedCalls).toEqual(searchEmbeds())
		expect(searchEmbeds().length).toBe(1)
	})
})
