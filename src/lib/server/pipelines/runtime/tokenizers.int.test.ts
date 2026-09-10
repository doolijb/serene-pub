/**
 * `connections.token_counter`, all the way to the number in the receipt.
 *
 * ⚠ This exists because the column did nothing. It is offered on every
 * connection form, stored on every connection row, and honoured by the legacy
 * generation path — `generateResponse` builds a `TokenCounters` from it, with a
 * comment beside it about the last time this same setting was silently
 * short-circuited. The pipeline path never passed anything, so
 * `RunOptions.countTokens` fell through to `roughTokens` and a person who chose
 * GPT-4o got a flat four-characters-per-token estimate for every budget, every
 * allocation decision, and every figure on the receipt.
 *
 * Nothing failed. The numbers were plausible, the prompt was built, the reply
 * came back. That is why the assertion below is a NUMBER rather than a
 * behaviour: it compares a candidate's recorded token count against what
 * GPT-4o's tokenizer actually says, and against what the estimate would have
 * said, so the two cannot be confused. Wire the id back to `roughTokens`
 * anywhere along the chain and the second expectation fails.
 *
 * The chain it covers, end to end:
 *
 *   connections.token_counter
 *     → tokenizerFor()            (which connection, by the same tiers dispatch uses)
 *     → RunOptions.tokenizer      (an id, not a function)
 *     → the SDK's registry        (loaded once, asynchronously)
 *     → ctx.countTokens           (synchronous, in every binding)
 *     → candidate.tokens          (what the ranker spends and Assemble allocates)
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { run } from "@serene-pub/sdk"
import { loadTokenizer } from "@serene-pub/sdk/tokenizers"
import { respondSpec } from "$lib/server/pipelines/specs/respond"
import { setCapabilityDefault } from "$lib/server/connections/capabilityDefaults"
import { TEXT_CAPABILITY } from "$lib/server/connections/capabilityTarget"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { tokenizerFor } from "$lib/server/pipelines/runtime/tokenizers"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import { eq } from "drizzle-orm"

// No embedding model, so the keyword mechanism runs — it is the mechanism that counts a
// candidate through `ctx.countTokens`.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null
}))

let db: TestDb
let sessionId: number
let userId: number
let gpt4oConnectionId: number
let llamaConnectionId: number

/**
 * Long enough, and mixed enough, that no two tokenizers can agree by accident.
 * A short ASCII string is one token per word in every vocabulary there is.
 */
const LORE = "An order of oathbound riders — 誓いの騎士団 — sworn twice: 🜁🜂."

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "tokenizer", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Tokenizer", userId })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	await db.insert(schema.lorebookEntries).values(
		worldLoreValues([
			{
				lorebookId: lorebook.id,
				name: "The Ashguard",
				keys: "ashguard",
				content: LORE
			}
		])
	)

	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "tell me about the ashguard"
	} as any)

	// `capabilities: {}` is UNDETERMINED — a row nobody has probed — which the
	// capability guard judges by modality and lets through. The same fixture
	// shape `capabilityTarget.test.ts` uses, and for the same reason: a row that
	// failed the guard would prove nothing about the tokenizer.
	const [gpt4o] = await db
		.insert(schema.connections)
		.values({
			name: "GPT-4o",
			type: "openai_chat",
			tokenCounter: TokenCounterOptions.OPENAI_GPT4O,
			capabilities: {}
		} as any)
		.returning()
	gpt4oConnectionId = gpt4o.id

	const [llama] = await db
		.insert(schema.connections)
		.values({
			name: "Local Llama",
			type: "ollama",
			tokenCounter: TokenCounterOptions.LLAMA,
			capabilities: {}
		} as any)
		.returning()
	llamaConnectionId = llama.id

	await setCapabilityDefault(db, TEXT_CAPABILITY, {
		connectionId: gpt4oConnectionId
	})
}, 60_000)

describe("tokenizerFor — which connection's setting a run budgets with", () => {
	it("reads the column off the registered text->text default", async () => {
		expect(await tokenizerFor(db, sessionId)).toBe(
			TokenCounterOptions.OPENAI_GPT4O
		)
	})

	it("lets a session's own connection override it", async () => {
		await db
			.update(schema.sessions)
			.set({ connectionId: llamaConnectionId })
			.where(eq(schema.sessions.id, sessionId))

		expect(await tokenizerFor(db, sessionId)).toBe(
			TokenCounterOptions.LLAMA
		)

		await db
			.update(schema.sessions)
			.set({ connectionId: null })
			.where(eq(schema.sessions.id, sessionId))
	})

	it("says nothing rather than guessing when no default is registered", async () => {
		// Cleared, not deleted — the state a deleted connection leaves behind.
		await setCapabilityDefault(db, TEXT_CAPABILITY, {
			connectionId: null
		})
		expect(await tokenizerFor(db, sessionId)).toBeUndefined()
		await setCapabilityDefault(db, TEXT_CAPABILITY, {
			connectionId: gpt4oConnectionId
		})
	})
})

describe("the id reaches the number", () => {
	/** The reply pipeline, stopped before the provider, with a given tokenizer. */
	const candidateTokens = async (tokenizer?: string) => {
		const receipt = await run(respondSpec(), {
			input: {
				text: "tell me about the ashguard",
				sessionId,
				characterId: null,
				sessionScope: { sessionId, currentCharacterId: null }
			},
			seed: "seed:tokenizer",
			bindings: coreBindings(),
			host: createHost(db, { sessionId, userId }),
			preview: true,
			tokenizer
		} as any)

		const rank = receipt.nodes.find((n: any) => n.nodeKey === "rank")
		expect(rank, "the reply pipeline has no ranking step").toBeTruthy()
		const hit = ((rank!.output as any)?.candidates ?? []).find(
			(c: any) => c.source === "worldLore"
		)
		expect(
			hit,
			"the world lore entry never reached the ranker"
		).toBeTruthy()
		return { tokens: hit.tokens as number, notes: receipt.notes }
	}

	it("counts a candidate with the connection's tokenizer, not the estimate", async () => {
		const id = await tokenizerFor(db, sessionId)
		expect(id).toBe(TokenCounterOptions.OPENAI_GPT4O)

		const gpt4o = await loadTokenizer(id)
		const estimate = await loadTokenizer(TokenCounterOptions.ESTIMATE)
		// The premise of the whole test. If these ever coincided for this
		// string, the assertion below would pass while proving nothing.
		expect(gpt4o.count(LORE)).not.toBe(estimate.count(LORE))

		const actual = await candidateTokens(id)
		expect(
			actual.tokens,
			`the world lore candidate was counted as ${actual.tokens} tokens; ` +
				`GPT-4o says ${gpt4o.count(LORE)} and the flat estimate says ` +
				`${estimate.count(LORE)}. If it matches the estimate, the id is ` +
				`being dropped somewhere between tokenizerFor and ctx.countTokens.`
		).toBe(gpt4o.count(LORE))
		expect(actual.notes ?? []).toEqual([])
	}, 60_000)

	it("falls back to the rough estimate when no tokenizer is named", async () => {
		// The same run with no id — the behaviour every pipeline run had before
		// the column was wired, kept as the documented floor rather than left to
		// be rediscovered.
		const actual = await candidateTokens(undefined)
		const rough = Math.ceil(LORE.length / 4)
		expect(actual.tokens).toBe(rough)
	}, 60_000)

	it("degrades and says so when the named tokenizer cannot be loaded", async () => {
		const actual = await candidateTokens("not-a-real-tokenizer")
		expect(actual.tokens).toBe(Math.ceil(LORE.length / 4))
		expect(
			actual.notes?.some((n) => /not-a-real-tokenizer/.test(n)),
			"a run that silently budgeted with an estimate is the failure this " +
				"whole chain exists to end — the receipt has to say it happened"
		).toBe(true)
	}, 60_000)
})
