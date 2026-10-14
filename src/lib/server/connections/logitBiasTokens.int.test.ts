/**
 * Logit bias entries → token ids (plan logit-bias L4–L6): the syntax per
 * entry, the tokenizer per connection type, and the `logit_bias_tokens` cache
 * — hit, miss, write-back, prune and cascade — against real PGlite.
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	logitBiasObject,
	logitBiasPairs,
	logitBiasTokenizerFor,
	pruneLogitBiasTokens,
	resolveLogitBias,
	type LogitBiasConnection,
	type LogitBiasTokenizer
} from "./logitBiasTokens"

const T = 60_000

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
}, T)

async function makeConnection(
	over: Partial<typeof schema.connections.$inferInsert> = {}
): Promise<LogitBiasConnection> {
	const [row] = await db
		.insert(schema.connections)
		.values({
			name: `endpoint ${Math.random()}`,
			type: CONNECTION_TYPE.OPENAI,
			baseUrl: "https://api.example.com/v1",
			...over
		})
		.returning()
	return { ...row, model: "some-model" }
}

/** A tokenizer that spells each character's code as its id, and counts calls. */
function charTokenizer(fingerprint = "test:chars") {
	const calls: string[][] = []
	const tokenizer: LogitBiasTokenizer = {
		fingerprint,
		tokenize: vi.fn(async (texts: string[]) => {
			calls.push(texts)
			return texts.map((t) => [...t].map((c) => c.codePointAt(0)!))
		})
	}
	return { tokenizer, calls }
}

const cached = (connectionId: number) =>
	db
		.select()
		.from(schema.logitBiasTokens)
		.where(eq(schema.logitBiasTokens.connectionId, connectionId))

describe("resolving entries", () => {
	it(
		"a word gets one leading space, {exact} is verbatim, [ids] skip the tokenizer; every token gets the bias",
		async () => {
			const connection = await makeConnection()
			const { tokenizer, calls } = charTokenizer()
			const r = await resolveLogitBias(
				connection,
				[
					{ text: "hi", value: -2 },
					{ text: "{Yo}", value: 3 },
					{ text: "[500, 501]", value: 7 }
				],
				{ db: db as unknown as Db, tokenizer }
			)
			expect(calls).toEqual([[" hi", "Yo"]])
			expect([...r.biases]).toEqual([
				[32, -2],
				[104, -2],
				[105, -2],
				[89, 3],
				[111, 3],
				[500, 7],
				[501, 7]
			])
			expect(r.skipped).toEqual([])
			expect(r.ignored).toBe(false)
		},
		T
	)

	it(
		"a later row wins an id two rows share",
		async () => {
			const connection = await makeConnection()
			const r = await resolveLogitBias(
				connection,
				[
					{ text: "[9]", value: -5 },
					{ text: "[9, 10]", value: 4 }
				],
				{ db: db as unknown as Db, tokenizer: null }
			)
			expect(r.biases.get(9)).toBe(4)
			expect(r.biases.get(10)).toBe(4)
		},
		T
	)

	it(
		"empty rows are ignored, invalid rows are skipped with their reason",
		async () => {
			const connection = await makeConnection()
			const r = await resolveLogitBias(
				connection,
				[
					{ text: "   ", value: 1 },
					{ text: "[]", value: 1 },
					{ text: "{}", value: 1 },
					{ text: "[3]", value: 1 }
				],
				{ db: db as unknown as Db, tokenizer: null }
			)
			expect([...r.biases]).toEqual([[3, 1]])
			expect(r.skipped.map((s) => s.text)).toEqual(["[]", "{}"])
			expect(r.ignored).toBe(false)
		},
		T
	)

	it(
		"the legacy { id: bias } object still sends its ids, with no tokenizer",
		async () => {
			const connection = await makeConnection()
			const r = await resolveLogitBias(
				connection,
				{ "15": -100, "16": 2 },
				{ db: db as unknown as Db, tokenizer: null }
			)
			expect(logitBiasObject(r.biases)).toEqual({ "15": -100, "16": 2 })
			expect(logitBiasPairs(r.biases)).toEqual([
				[15, -100],
				[16, 2]
			])
		},
		T
	)

	it(
		"no tokenizer: words are left out, and a list of only words is ignored",
		async () => {
			const connection = await makeConnection()
			const r = await resolveLogitBias(
				connection,
				[
					{ text: "hmm", value: -2 },
					{ text: "wait", value: -2 }
				],
				{ db: db as unknown as Db, tokenizer: null }
			)
			expect(r.biases.size).toBe(0)
			expect(r.skipped).toHaveLength(2)
			expect(r.ignored).toBe(true)
		},
		T
	)

	it(
		"an unreadable value is ignored; an empty list asks for nothing",
		async () => {
			const connection = await makeConnection()
			const bad = await resolveLogitBias(connection, "not json {", {
				db: db as unknown as Db,
				tokenizer: null
			})
			expect(bad.ignored).toBe(true)
			const none = await resolveLogitBias(connection, [], {
				db: db as unknown as Db,
				tokenizer: null
			})
			expect(none.ignored).toBe(false)
			expect(none.biases.size).toBe(0)
		},
		T
	)

	it(
		"a text the tokenizer cannot answer is skipped; the rest still go",
		async () => {
			const connection = await makeConnection()
			const tokenizer: LogitBiasTokenizer = {
				fingerprint: "test:partial",
				tokenize: async (texts) =>
					texts.map((t) => (t === " bad" ? null : [1]))
			}
			const r = await resolveLogitBias(
				connection,
				[
					{ text: "bad", value: -1 },
					{ text: "good", value: -1 }
				],
				{ db: db as unknown as Db, tokenizer }
			)
			expect([...r.biases]).toEqual([[1, -1]])
			expect(r.skipped.map((s) => s.text)).toEqual(["bad"])
			expect(r.ignored).toBe(false)
		},
		T
	)
})

describe("the token cache", () => {
	it(
		"a miss is tokenized and written; the next request reads it without asking",
		async () => {
			const connection = await makeConnection()
			const { tokenizer, calls } = charTokenizer()
			const deps = { db: db as unknown as Db, tokenizer }
			await resolveLogitBias(connection, [{ text: "ab", value: 1 }], deps)
			const rows = await cached(connection.id)
			expect(
				rows.map((r) => ({
					model: r.model,
					fingerprint: r.tokenizerFingerprint,
					text: r.tokenizedText,
					ids: r.tokenIds
				}))
			).toEqual([
				{
					model: "some-model",
					fingerprint: "test:chars",
					text: " ab",
					ids: [32, 97, 98]
				}
			])

			// The second list shares one text: only the new one is asked for.
			const r = await resolveLogitBias(
				connection,
				[
					{ text: "ab", value: 2 },
					{ text: "c", value: 2 }
				],
				deps
			)
			expect(calls).toEqual([[" ab"], [" c"]])
			expect(r.biases.get(97)).toBe(2)
			expect(r.biases.get(99)).toBe(2)
			expect(await cached(connection.id)).toHaveLength(2)
		},
		T
	)

	it(
		"another model or tokenizer misses rather than reading these ids",
		async () => {
			const connection = await makeConnection()
			const first = charTokenizer("test:one")
			await resolveLogitBias(connection, [{ text: "x", value: 1 }], {
				db: db as unknown as Db,
				tokenizer: first.tokenizer
			})
			const second = charTokenizer("test:two")
			await resolveLogitBias(connection, [{ text: "x", value: 1 }], {
				db: db as unknown as Db,
				tokenizer: second.tokenizer
			})
			await resolveLogitBias(
				{ ...connection, model: "other-model" },
				[{ text: "x", value: 1 }],
				{ db: db as unknown as Db, tokenizer: second.tokenizer }
			)
			expect(second.calls).toEqual([[" x"], [" x"]])
			expect(await cached(connection.id)).toHaveLength(3)
		},
		T
	)

	it(
		"pruning forgets one connection's rows; deleting a connection cascades",
		async () => {
			const kept = await makeConnection()
			const pruned = await makeConnection()
			for (const c of [kept, pruned])
				await resolveLogitBias(c, [{ text: "p", value: 1 }], {
					db: db as unknown as Db,
					tokenizer: charTokenizer().tokenizer
				})
			await pruneLogitBiasTokens(db as unknown as Db, pruned.id)
			expect(await cached(pruned.id)).toHaveLength(0)
			expect(await cached(kept.id)).toHaveLength(1)

			await db
				.delete(schema.connections)
				.where(eq(schema.connections.id, kept.id))
			expect(await cached(kept.id)).toHaveLength(0)
		},
		T
	)
})

describe("which tokenizer", () => {
	const json = (body: unknown) => ({ ok: true, json: async () => body })

	it("KoboldCPP: the server's ids with no BOS, fingerprinted by the model it says is loaded", async () => {
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			if (url.endsWith("/api/v1/model"))
				return json({ result: "koboldcpp/Mistral-Nemo" })
			const { prompt } = JSON.parse(String(init?.body))
			return json({ value: 2, ids: prompt === " hmm" ? [1, 2] : [3] })
		})
		const tokenizer = await logitBiasTokenizerFor(
			{
				id: 1,
				type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
				baseUrl: "http://localhost:5001/",
				model: "Mistral-Nemo.gguf"
			},
			fetchMock as unknown as typeof fetch
		)
		expect(tokenizer?.fingerprint).toBe(
			`${CONNECTION_TYPE.KOBOLDCPP_MANAGED}:koboldcpp/Mistral-Nemo`
		)
		expect(await tokenizer!.tokenize([" hmm", "Yo"])).toEqual([[1, 2], [3]])
		const posted = fetchMock.mock.calls.filter((c) =>
			c[0].endsWith("/api/extra/tokencount")
		)
		expect(JSON.parse(String(posted[0][1]?.body))).toEqual({
			prompt: " hmm",
			special: false
		})
	})

	it("llama.cpp: /tokenize without special tokens; an unreachable server answers null for the rest without asking again", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			if (url.endsWith("/props"))
				return json({ model_path: "/m/qwen.gguf" })
			throw new Error("ECONNREFUSED")
		})
		const tokenizer = await logitBiasTokenizerFor(
			{ id: 1, type: CONNECTION_TYPE.LLAMACPP, baseUrl: "", model: null },
			fetchMock as unknown as typeof fetch
		)
		expect(tokenizer?.fingerprint).toBe(
			`${CONNECTION_TYPE.LLAMACPP}:/m/qwen.gguf`
		)
		expect(await tokenizer!.tokenize([" a", " b", " c"])).toEqual([
			null,
			null,
			null
		])
		const posts = fetchMock.mock.calls.filter((c) =>
			c[0].endsWith("/tokenize")
		)
		// The documented default address, since this row has none.
		expect(posts.map((c) => c[0])).toEqual([
			"http://localhost:8080/tokenize"
		])
	})

	it("a server that will not name its model falls back to the pair's model", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: false,
			json: async () => ({})
		}))
		const tokenizer = await logitBiasTokenizerFor(
			{
				id: 1,
				type: CONNECTION_TYPE.KOBOLDCPP,
				baseUrl: "http://h:5001",
				model: "chosen"
			},
			fetchMock as unknown as typeof fetch
		)
		expect(tokenizer?.fingerprint).toBe(
			`${CONNECTION_TYPE.KOBOLDCPP}:chosen`
		)
	})

	it(
		"an OpenAI-compatible connection uses its local encoder; a ratio tokenizer has none",
		async () => {
			const gpt4o = await logitBiasTokenizerFor({
				id: 1,
				type: CONNECTION_TYPE.OPENAI,
				tokenCounter: "openai-gpt4o"
			})
			expect(gpt4o?.fingerprint).toBe("local:openai-gpt4o")
			// o200k_base: " hmm" is one token.
			expect(await gpt4o!.tokenize([" hmm"])).toEqual([[186402]])

			for (const ratio of [
				"estimate",
				"anthropic-claude",
				"gemini",
				"gemma",
				null
			])
				expect(
					await logitBiasTokenizerFor({
						id: 1,
						type: CONNECTION_TYPE.OPENAI,
						tokenCounter: ratio
					})
				).toBeNull()
		},
		T
	)
})
