/**
 * The cast Query and the context Task, against real rows.
 *
 * `promptFields.test.ts` pins the rules and `templateContext.test.ts` pins the
 * rendering; both run on literals. This one exists for the seam between them
 * and the database — the join that carries visibility, and the scope check that
 * decides whether a spec may read this chat's cast at all.
 *
 * The split into two nodes was not a design preference; it was F11 enforced by
 * the executor. The first version of the Task read the cast itself and died on
 * `ctx.read is not a function`, which is the ledger doing its job: a Task is
 * handed no services, so the read belongs in a Query. The tests below are
 * arranged the same way — the Query is checked against rows, the Task against
 * what the Query hands it.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost, HostScopeError } from "./host"
import { coreBindings } from "./bindings"
import * as schema from "$lib/server/db/schema"
import { ChatCharacterVisibility as V } from "$lib/shared/constants/ChatCharacterVisibility"

let db: TestDb
let chatId: number
let userId: number
let aliceId: number
let caraId: number

beforeAll(async () => {
	db = await createTestDb()
	const [user] = await db
		.insert(schema.users)
		.values({ username: "cast-test", isAdmin: false })
		.returning()
	userId = user.id

	const [alice] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Alice",
			description: "A knight sworn to {{user}}.",
			personality: "Steady.",
			scenario: "In the keep.",
			exampleDialogues: ["one", "two", "three"]
		})
		.returning()
	aliceId = alice.id

	const [cara] = await db
		.insert(schema.characters)
		.values({ userId, name: "Cara", description: "A scout." })
		.returning()
	caraId = cara.id

	const [bob] = await db
		.insert(schema.personas)
		.values({
			userId,
			name: "Bob",
			description: "A traveller.",
			isDefault: false
		})
		.returning()

	const [chat] = await db
		.insert(schema.chats)
		.values({ userId, isGroup: false })
		.returning()
	chatId = chat.id

	await db.insert(schema.chatCharacters).values([
		{ chatId, characterId: aliceId, isActive: true, visibility: V.VISIBLE },
		{ chatId, characterId: caraId, isActive: false, visibility: V.VISIBLE }
	])
	await db.insert(schema.chatPersonas).values({ chatId, personaId: bob.id })
}, 60_000)

const bindings = coreBindings()

const queryCtx = (scopeChatId = chatId) => ({
	read: (table: string, q: unknown) =>
		createHost(db as any, { chatId: scopeChatId, userId }).read!(table, q, {
			key: "cast",
			typeId: "core:query/chat-cast",
			typeVersion: 1,
			kind: "query"
		}),
	signal: new AbortController().signal,
	progress: () => {},
	log: () => {}
})

/** Read the cast the way a run would. */
const readCast = (scopeChatId = chatId, requested = chatId) =>
	bindings["core:query/chat-cast@1"]!(
		{ scope: { chatId: requested } },
		queryCtx(scopeChatId) as any
	) as any

/** A Task context: no `read`, matching what the executor actually supplies. */
const taskCtx = (random?: () => number) => ({
	random,
	signal: new AbortController().signal,
	progress: () => {},
	log: () => {}
})

const buildFrom = (cast: unknown, input: any = {}, random?: () => number) =>
	bindings["core:task/build-template-context@1"]!(
		{
			cast,
			promptConfig: { systemPrompt: "Be brief." },
			currentCharacterId: aliceId,
			...input
		},
		taskCtx(random) as any
	) as any

describe("the cast query", () => {
	it("returns the chat's characters and personas", async () => {
		const r = await readCast()
		expect(r.kind).toBe("ok")
		expect(r.value.cast.chatCharacters).toHaveLength(2)
		expect(r.value.cast.chatPersonas[0].persona.name).toBe("Bob")
	})

	it("carries visibility and activity through the join", async () => {
		// A plain character read would lose both, and they are what decide
		// whether a character appears in the prompt and whether they are named.
		const r = await readCast()
		const cara = r.value.cast.chatCharacters.find(
			(cc: any) => cc.character.id === caraId
		)
		expect(cara.isActive).toBe(false)
		expect(cara.visibility).toBe(V.VISIBLE)
	})

	it("refuses another chat's cast rather than returning an empty one", async () => {
		// An empty cast renders a prompt with no characters in it, which reads
		// as a broken character card rather than as a scope violation.
		await expect(readCast(chatId, chatId + 999)).rejects.toThrow(
			HostScopeError
		)
	})

	it("halts, rather than erroring, when the chat is gone", async () => {
		const r = await readCast(chatId + 999, chatId + 999)
		expect(r.kind).toBe("halt")
		expect(r.reason).toMatch(/no longer exists/)
	})
})

describe("the context task", () => {
	it("builds a context from what the query handed it", async () => {
		const cast = (await readCast()).value.cast
		const r = await buildFrom(cast)
		expect(r.kind).toBe("ok")
		expect(r.value.templateContext.instructions).toContain("Be brief.")
		expect(r.value.templateContext.char).toBe("Alice")
		expect(r.value.templateContext.persona).toBe("Bob")
	})

	it("names the active character and still shows the inactive one's card", async () => {
		const cast = (await readCast()).value.cast
		const r = await buildFrom(cast)
		// The cast arrives through its layout, so the JSON sits inside the
		// heading and fence 0.5 wrote in the template. Parsing what is between
		// the fences keeps this test about the cards rather than about them.
		const cards = JSON.parse(
			r.value.templateContext.characters
				.split("```json\n")[1]!
				.split("\n```")[0]!
		)
		expect(cards.map((c: any) => c.name).sort()).toEqual(["Alice", "Cara"])
		expect(r.value.templateContext.characterNames).toBe("Alice")
	})

	it("interpolates the cards against the resolved names", async () => {
		const cast = (await readCast()).value.cast
		const r = await buildFrom(cast)
		expect(r.value.templateContext.characters).toContain(
			"A knight sworn to Bob."
		)
	})

	it("takes the speaking character's scenario when the chat has none", async () => {
		const cast = (await readCast()).value.cast
		const r = await buildFrom(cast)
		expect(r.value.templateContext.scenario).toContain("In the keep.")
	})

	it("halts when handed no cast rather than rendering an empty prompt", async () => {
		const r = await buildFrom(undefined)
		expect(r.kind).toBe("halt")
		expect(r.reason).toMatch(/no cast/)
	})

	describe("the example dialogue", () => {
		const seeded = (value: number) => () => value

		it("comes from the run's RNG, so a replay reproduces it", async () => {
			// The property the legacy `Math.random()` cannot have. Without it a
			// parity comparison between the two paths is not well-defined.
			const cast = (await readCast()).value.cast
			const a = await buildFrom(cast, {}, seeded(0.9))
			const b = await buildFrom(cast, {}, seeded(0.9))
			expect(a.value.exampleDialogueIndex).toBe(2)
			expect(b.value.exampleDialogueIndex).toBe(2)
			expect(a.value.templateContext.postHistory.exampleDialogue).toBe(
				b.value.templateContext.postHistory.exampleDialogue
			)
		})

		it("varies with the seed, so the variety survives determinism", async () => {
			const cast = (await readCast()).value.cast
			const picks = new Set<number>()
			for (const v of [0.1, 0.5, 0.9])
				picks.add(
					(await buildFrom(cast, {}, seeded(v))).value
						.exampleDialogueIndex
				)
			expect(picks.size).toBe(3)
		})

		it("takes the first when the type did not declare randomness", async () => {
			// `ctx.random` is absent unless the descriptor asks for it (F11). The
			// fallback has to be deterministic, not a quiet `Math.random()`.
			const cast = (await readCast()).value.cast
			const r = await buildFrom(cast)
			expect(r.value.exampleDialogueIndex).toBe(0)
		})
	})
})
