/**
 * The cast Query and the context Task, against real rows.
 *
 * `promptFields.test.ts` pins the rules and `templateContext.test.ts` pins the
 * rendering; both run on literals. This one exists for the seam between them
 * and the database — the join that carries `enabled`, and the scope check that
 * decides whether a spec may read this session's cast at all.
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
import { createHost, HostScopeError } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import * as schema from "$lib/server/db/schema"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"

let db: TestDb
let sessionId: number
let userId: number
let aliceId: number
let caraId: number

beforeAll(async () => {
	db = await createTestDb()
	// The genre registry: the cast read resolves `characterDetail` through it.
	await bootstrapPipelines(db)
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
		.insert(schema.characters)
		.values({
			userId,
			isPersona: true,
			name: "Bob",
			description: "A traveller."
		})
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	sessionId = session.id

	await db.insert(schema.sessionCharacters).values([
		{
			sessionId,
			characterId: aliceId,
			isActive: true
		},
		{
			sessionId,
			characterId: caraId,
			isActive: false
		}
	])
	await db
		.insert(schema.sessionPersonas)
		.values({ sessionId, personaId: bob.id })
}, 60_000)

const bindings = coreBindings()

const queryCtx = (scopeSessionId = sessionId) => ({
	read: (table: string, q: unknown) =>
		createHost(db, { sessionId: scopeSessionId, userId }).read!(
			table,
			q,
			{
				key: "cast",
				definitionId: "core:query/session-cast",
				definitionVersion: 1,
				kind: "query"
			}
		),
	signal: new AbortController().signal,
	progress: () => {},
	log: () => {}
})

/** Read the cast the way a run would. */
const readCast = (scopeSessionId = sessionId, requested = sessionId) =>
	bindings["core:query/session-cast@1"]!(
		{ scope: { sessionId: requested } },
		queryCtx(scopeSessionId) as any
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
			// The node's declared `prompts` slot, as `resolveInput` hands it
			// over. (`promptConfig` is the resolver's word one layer down; the
			// binding reads only the declared spelling — R-12.)
			prompts: { systemPrompt: "Be brief." },
			currentCharacterId: aliceId,
			...input
		},
		taskCtx(random) as any
	) as any

describe("the cast query", () => {
	it("returns the session's characters and personas", async () => {
		const r = await readCast()
		expect(r.kind).toBe("ok")
		expect(r.value.cast.sessionCharacters).toHaveLength(2)
		expect(r.value.cast.sessionPersonas[0].persona.name).toBe("Bob")
	})

	it("carries every seat, a switched-off one included, with enabled", async () => {
		// A plain character read would lose it, and it is what decides whether
		// a character is named and given a turn. The switched-off seat is IN
		// the read (2026-09-27): readers filter on `enabled` themselves.
		const r = await readCast()
		const byId = (id: number) =>
			r.value.cast.sessionCharacters.find(
				(cc: any) => cc.character.id === id
			)
		expect(byId(aliceId).enabled).toBe(true)
		expect(byId(caraId).enabled).toBe(false)
		// One name for it on the read — the table's `is_active` stays behind
		// the seam — and the retired per-seat visibility is not read at all.
		expect("isActive" in byId(caraId)).toBe(false)
		expect("visibility" in byId(caraId)).toBe(false)
		// A persona seat has no switch and says so.
		expect(r.value.cast.sessionPersonas[0].enabled).toBe(true)
	})

	it("carries the session's characterDetail, defaulted at read", async () => {
		// The chat genre declares the field (default `full`); the host
		// resolves it through `genreFieldsFor` and puts it on the cast.
		const r = await readCast()
		expect(r.value.cast.characterDetail).toBe("full")
	})

	it("refuses another session's cast rather than returning an empty one", async () => {
		// An empty cast renders a prompt with no characters in it, which reads
		// as a broken character card rather than as a scope violation.
		await expect(readCast(sessionId, sessionId + 999)).rejects.toThrow(
			HostScopeError
		)
	})

	it("halts, rather than erroring, when the session is gone", async () => {
		const r = await readCast(sessionId + 999, sessionId + 999)
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

	it("trims the cards to the characterDetail the cast read carries", async () => {
		const cast = (await readCast()).value.cast
		const cardsAt = async (characterDetail: string) => {
			const r = await buildFrom({ ...cast, characterDetail })
			return {
				cards: JSON.parse(
					r.value.templateContext.characters
						.split("```json\n")[1]!
						.split("\n```")[0]!
				) as Array<Record<string, unknown>>,
				names: r.value.templateContext.characterNames as string
			}
		}
		const full = await cardsAt("full")
		const baseline = await buildFrom(cast)
		// `full` is what the cast rendered at before the field existed.
		expect((await buildFrom({ ...cast, characterDetail: "full" })).value.templateContext).toEqual(
			baseline.value.templateContext
		)
		expect(full.cards.map((c) => c.name).sort()).toEqual(["Alice", "Cara"])

		const only = await cardsAt("speaker-only")
		expect(only.cards.map((c) => c.name)).toEqual(["Alice"])
		expect(only.names).toBe("")
	})

	it("interpolates the cards against the resolved names", async () => {
		const cast = (await readCast()).value.cast
		const r = await buildFrom(cast)
		expect(r.value.templateContext.characters).toContain(
			"A knight sworn to Bob."
		)
	})

	it("takes the speaking character's scenario when the session has none", async () => {
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
