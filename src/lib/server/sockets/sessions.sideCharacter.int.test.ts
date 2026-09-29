/**
 * A side character speaks, and the session's rotation does not notice.
 *
 * The ruling of 2026-09-07 split the narrator in two, and gave the second half
 * "a first class presence in the session, just like a primary character, **only
 * they aren't inserted into the round-robin**". Those two halves are easy to
 * state and easy to break in opposite directions, so both are pinned here
 * against the real handler and a real database:
 *
 *  1. a picked character speaks without their turn being consumed or granted;
 *  2. a typed name speaks at all, and joins nothing by doing so.
 *
 * ## Why the assertions are about rows and not about prose
 *
 * "Not in the round-robin" is not a rule anybody enforces at the trigger — it is
 * a property of the row the trigger writes. The rotation (`rotationTurns`) drops
 * every `isNarratorResponse` message *before* it matches a character id, so the flag
 * is what excludes the turn, and `characterId: null` is what keeps a
 * side-character row from meaning "they spoke" to the other readers of that
 * column. Asserting the rotation's answer before and after is the only check
 * that would survive somebody deciding to "fix" the null by filling it in.
 *
 * `runReply` is mocked: the pipeline owns its row since 09-B B4 — the
 * narrate-character spec's placeholder outlet writes it, which
 * `replyRoad.int.test.ts` pins — and running it needs a connection, a sampling
 * config and a model. The subject here is the trigger's first step: the speaker
 * fact it resolves and hands to the run, and what it refuses.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

// Same isolation as the trigger-lock suite: `resolveNarratorPromptConfig`
// reaches `getUserConfigurations`, which throws against a bare test database
// with no prompt/context/sampling fixtures. Irrelevant to the subject.
vi.mock("$lib/server/utils/resolveNarratorPromptConfig", () => ({
	resolveNarratorPromptConfig: async () => null
}))

const generated: any[] = []
vi.mock("../utils/runReply", () => ({
	runReply: async (args: any) => {
		generated.push(args)
		return { ok: true }
	}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-side-character-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) =>
	({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any
const noopEmit = () => {}

/**
 * A session with a two-character rotation that is mid-cycle: Alice has spoken
 * most recently, so Bram is due. A fixture where nobody is due, or where both
 * are, could not tell a rotation that moved from one that never could.
 */
async function makeSession(tag: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `side-char-${tag}`)

	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `${tag} lore`, userId: user.id })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: true, lorebookId: lorebook.id })
		.returning()

	const insertCharacter = async (name: string) => {
		const [c] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name, description: `${name} desc` })
			.returning()
		return c
	}
	const alice = await insertCharacter(`Alice ${tag}`)
	const bram = await insertCharacter(`Bram ${tag}`)
	// Never in the cast — the side character the dropdown offers.
	const vell = await insertCharacter(`Vell ${tag}`)

	const [persona] = await testDb
		.insert(schema.characters)
		.values({
			userId: user.id,
			name: `P ${tag}`,
			description: "p",
			isPersona: true
		})
		.returning()

	await testDb.insert(schema.sessionCharacters).values([
		{ sessionId: session.id, characterId: alice.id, position: 0 },
		{ sessionId: session.id, characterId: bram.id, position: 1 }
	])
	await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId: session.id, personaId: persona.id })

	/**
	 * A cycle where Bram is due and Alice is not.
	 *
	 * The rotation looks at the last `castSize - 1` messages (2 here: two
	 * characters and a persona) to decide who is owed a turn. Four messages
	 * ending persona → Alice land Bram outside that window and Alice inside
	 * it, with both having replied once — so exactly one character is due,
	 * which is a fixture that can tell a rotation that moved from one that
	 * never could.
	 */
	const line = (over: Record<string, unknown>) => ({
		sessionId: session.id,
		userId: user.id,
		...over
	})
	await testDb.insert(schema.sessionMessages).values([
		line({ role: "user", personaId: persona.id, content: "hello" }),
		line({
			role: "assistant",
			characterId: bram.id,
			content: "Bram speaks"
		}),
		line({ role: "user", personaId: persona.id, content: "and then?" }),
		line({
			role: "assistant",
			characterId: alice.id,
			content: "Alice speaks"
		})
	] as any)

	return { user, session, alice, bram, vell, persona, lorebook }
}

/** The rotation's answer, computed from the rows exactly as the run does. */
async function whoIsNext(sessionId: number) {
	const { rotationSeats, roundRobinSpeaker } = await import(
		"$lib/server/pipelines/runtime/speakerRotation"
	)
	const sessionMessages = await testDb
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(schema.sessionMessages.id)
	const sessionCharacters = await testDb.query.sessionCharacters.findMany({
		where: (c, { eq: e }) => e(c.sessionId, sessionId),
		with: { character: true }
	})
	return roundRobinSpeaker(
		// Translated as the host's cast read translates it: `is_active` is
		// `enabled` on every read a pipeline takes.
		rotationSeats({
			sessionCharacters: sessionCharacters.map((c) => ({
				...c,
				enabled: c.isActive
			})) as any
		}),
		sessionMessages
	)
}

const messagesOf = async (sessionId: number) =>
	await testDb
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))

const castOf = async (sessionId: number) =>
	await testDb
		.select()
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))

describe("a side-character turn is a participant, not a cast member", () => {
	test("a picked character speaks without entering the rotation", async () => {
		const { fireNarratorResponseHandler } = await import("./sessions")
		const f = await makeSession("picked")

		const dueBefore = await whoIsNext(f.session.id)
		expect(
			dueBefore,
			"the fixture must have somebody due, or a rotation that moved " +
				"would be indistinguishable from one that could not"
		).toBe(f.bram.id)
		const castBefore = await castOf(f.session.id)

		const res = await fireNarratorResponseHandler.handler(
			fakeSocket(f.user.id),
			{
				sessionId: f.session.id,
				speaker: { characterId: f.vell.id, name: null }
			} as any,
			noopEmit
		)
		expect(res.error).toBeUndefined()
		expect(res.success).toBe(true)

		// The trigger inserts nothing (R-17): the row is the pipeline's, and
		// what the trigger hands the run is the speaker fact.
		expect(
			(await messagesOf(f.session.id)).some((m: any) => m.isGenerating)
		).toBe(false)
		const turn = generated.at(-1)?.turn
		expect(generated.at(-1)?.sessionId).toBe(f.session.id)
		expect(turn?.kind).toBe("narrate-character")
		expect(turn?.speaker).toMatchObject({
			name: f.vell.name,
			characterId: f.vell.id
		})

		// The rotation is exactly where it was — Bram is still owed his turn.
		expect(
			await whoIsNext(f.session.id),
			"the side-character turn moved the rotation"
		).toBe(f.bram.id)
		expect(await castOf(f.session.id)).toHaveLength(castBefore.length)
	}, 60_000)

	test("a free-form name produces a turn without joining the cast", async () => {
		const { fireNarratorResponseHandler } = await import("./sessions")
		const f = await makeSession("freeform")

		const dueBefore = await whoIsNext(f.session.id)
		const castBefore = await castOf(f.session.id)
		const charactersBefore = await testDb
			.select()
			.from(schema.characters)
			.where(eq(schema.characters.userId, f.user.id))

		const res = await fireNarratorResponseHandler.handler(
			fakeSocket(f.user.id),
			{
				sessionId: f.session.id,
				speaker: { characterId: null, name: "  The innkeeper  " }
			} as any,
			noopEmit
		)
		expect(res.error).toBeUndefined()
		expect(res.success).toBe(true)

		expect(generated.at(-1)?.turn?.speaker).toMatchObject({
			name: "The innkeeper",
			characterId: null,
			// Nothing in this lorebook is called that — the new-name fact, and
			// the whole reason a script gets to see it.
			known: false
		})

		// Nothing joined: not the cast, and not the character table either. A
		// free-form speaker that quietly created a character row would be a
		// membership wearing a text field.
		expect(await castOf(f.session.id)).toHaveLength(castBefore.length)
		expect(
			await testDb
				.select()
				.from(schema.characters)
				.where(eq(schema.characters.userId, f.user.id))
		).toHaveLength(charactersBefore.length)
		expect(await whoIsNext(f.session.id)).toBe(dueBefore)
	}, 60_000)

	test("a name the lorebook already knows is not reported as new", async () => {
		// The other half of the fact. `known: false` is what a script acts on,
		// so a lorebook that DOES know the name must not produce it — otherwise
		// the suggestion fires on everybody.
		const { fireNarratorResponseHandler } = await import("./sessions")
		const f = await makeSession("known")
		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: f.lorebook.id,
			binding: "{{char:99}}",
			name: "The innkeeper",
			aliases: ["Old Marl"]
		} as any)

		await fireNarratorResponseHandler.handler(
			fakeSocket(f.user.id),
			{
				sessionId: f.session.id,
				speaker: { characterId: null, name: "old marl" }
			} as any,
			noopEmit
		)
		// Matched case-insensitively, and through `aliases` — which must be
		// unioned with `absorbedAliases`, since the binding sync REPLACES
		// `aliases` wholesale and an absorbed identity lives only in the other.
		expect(generated.at(-1)?.turn?.speaker?.known).toBe(true)
	}, 60_000)

	test("world narration is unchanged when no speaker is sent", async () => {
		// The regression guard for the half that already worked. A `speaker`
		// key absent means the narrator: the run is the narrate spec's, with no
		// speaker fact at all.
		const { fireNarratorResponseHandler } = await import("./sessions")
		const f = await makeSession("world")

		const res = await fireNarratorResponseHandler.handler(
			fakeSocket(f.user.id),
			{
				sessionId: f.session.id,
				instructions: "focus on the rain"
			} as any,
			noopEmit
		)
		expect(res.success).toBe(true)
		const turn = generated.at(-1)?.turn
		expect(turn?.kind).toBe("narrate")
		expect(turn?.speaker).toBeUndefined()
		expect(turn?.instructions).toBe("focus on the rain")
		expect(await whoIsNext(f.session.id)).toBe(f.bram.id)
	}, 60_000)
})

describe("the trigger's first step refuses what it cannot run", () => {
	test("a speaker with neither a pick nor a name", async () => {
		const { fireNarratorResponseHandler } = await import("./sessions")
		const f = await makeSession("empty")
		const res = await fireNarratorResponseHandler.handler(
			fakeSocket(f.user.id),
			{
				sessionId: f.session.id,
				speaker: { characterId: null, name: "   " }
			} as any,
			noopEmit
		)
		expect(res.error).toMatch(/Choose a character or type a name/)
		// Refused before anything ran — a refusal that still started a run
		// would leave a generating row and wedge the session's trigger lock.
		expect(generated.some((g) => g.sessionId === f.session.id)).toBe(false)
		expect(
			(await messagesOf(f.session.id)).some((m: any) => m.isGenerating)
		).toBe(false)
	}, 60_000)

	test("a name longer than the cap", async () => {
		const { fireNarratorResponseHandler } = await import("./sessions")
		const f = await makeSession("long")
		const res = await fireNarratorResponseHandler.handler(
			fakeSocket(f.user.id),
			{
				sessionId: f.session.id,
				speaker: { characterId: null, name: "x".repeat(121) }
			} as any,
			noopEmit
		)
		expect(res.error).toMatch(/too long/)
		expect(
			(await messagesOf(f.session.id)).some((m: any) => m.isGenerating)
		).toBe(false)
	}, 60_000)

	test("somebody else's character", async () => {
		// The picker is a control surface, and a forged id reaching a prompt as
		// another person's card would make it decoration — the same reasoning
		// `sessions:fireAction` applies to a menu trigger's subject.
		const { fireNarratorResponseHandler } = await import("./sessions")
		const mine = await makeSession("mine")
		const theirs = await makeSession("theirs")

		const res = await fireNarratorResponseHandler.handler(
			fakeSocket(mine.user.id),
			{
				sessionId: mine.session.id,
				speaker: { characterId: theirs.vell.id, name: null }
			} as any,
			noopEmit
		)
		expect(res.error).toMatch(/not available for this session/)
		expect(
			(await messagesOf(mine.session.id)).some((m: any) => m.isGenerating)
		).toBe(false)
	}, 60_000)

	test("their own presence in the session — a live persona is never seated as the speaker (U5b W6)", async () => {
		// The picker never offers a presence (`listSideCharacterOptions`),
		// so a request naming one did not come through the picker. Refused
		// with a sentence rather than seated as nobody: the reply road's
		// null seat stays as the belt, but a person should be told why.
		const { fireNarratorResponseHandler } = await import("./sessions")
		const f = await makeSession("presence-speaker")
		const res = await fireNarratorResponseHandler.handler(
			fakeSocket(f.user.id),
			{
				sessionId: f.session.id,
				speaker: { characterId: f.persona.id, name: null }
			} as any,
			noopEmit
		)
		expect(res.error).toMatch(/somebody's presence in this session/)
		expect(res.error).toMatch(/Pick another character, or type a name/)
		expect(generated.some((g) => g.sessionId === f.session.id)).toBe(false)
		expect(
			(await messagesOf(f.session.id)).some((m: any) => m.isGenerating)
		).toBe(false)

		// Detached, the same character is a departed voice and may speak.
		await testDb
			.update(schema.sessionPersonas)
			.set({ removedAt: new Date() })
			.where(eq(schema.sessionPersonas.personaId, f.persona.id))
		const after = await fireNarratorResponseHandler.handler(
			fakeSocket(f.user.id),
			{
				sessionId: f.session.id,
				speaker: { characterId: f.persona.id, name: null }
			} as any,
			noopEmit
		)
		expect(after.error).toBeUndefined()
		expect(generated.some((g) => g.sessionId === f.session.id)).toBe(true)
	}, 60_000)

	test("another member's (a guest's) presence is refused just the same", async () => {
		// livePresenceIds does not care whose live voice a character is — a
		// guest's own persona is exactly as much somebody's as the owner's.
		// The owner can never even resolve a guest's character by id (the
		// same ownership boundary "somebody else's character" above
		// exercises), so this is refused before the presence check runs at
		// all — the guard the presence rule backs up, holding on its own.
		const { fireNarratorResponseHandler } = await import("./sessions")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const f = await makeSession("guest-presence")
		const guest = await createTestUser(testDb, "guest-presence-guest")
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: f.session.id, userId: guest.id })
		const [guestPersona] = await testDb
			.insert(schema.characters)
			.values({
				userId: guest.id,
				name: "Guest persona",
				description: "g",
				isPersona: true
			})
			.returning()
		await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId: f.session.id, personaId: guestPersona.id })

		const res = await fireNarratorResponseHandler.handler(
			fakeSocket(f.user.id),
			{
				sessionId: f.session.id,
				speaker: { characterId: guestPersona.id, name: null }
			} as any,
			noopEmit
		)
		expect(res.error).toMatch(/not available for this session/)
		expect(generated.some((g) => g.sessionId === f.session.id)).toBe(false)
		expect(
			(await messagesOf(f.session.id)).some((m: any) => m.isGenerating)
		).toBe(false)
	}, 60_000)
})

describe("the dropdown offers the people it should", () => {
	test("this person's characters, minus the cast", async () => {
		const { sessionsSideCharacterOptionsHandler } = await import(
			"./sessions"
		)
		const f = await makeSession("options")
		const res = await sessionsSideCharacterOptionsHandler.handler(
			fakeSocket(f.user.id),
			{ sessionId: f.session.id },
			noopEmit
		)
		const ids = res.characters.map((c) => c.id)
		expect(ids).toContain(f.vell.id)
		// A cast member has a turn of their own; offering them here would be
		// two routes to one voice with different rotation consequences.
		expect(ids).not.toContain(f.alice.id)
		expect(ids).not.toContain(f.bram.id)
	}, 60_000)

	test("and minus their own presence in the session — a persona is never a side character (W3)", async () => {
		// Since the library merge a persona is one of "their own characters";
		// the live `session_personas` row is what says the model may not be
		// seated as it. Detached, it is offerable like a departed cast member.
		const { sessionsSideCharacterOptionsHandler } = await import(
			"./sessions"
		)
		const f = await makeSession("options-presence")
		const before = await sessionsSideCharacterOptionsHandler.handler(
			fakeSocket(f.user.id),
			{ sessionId: f.session.id },
			noopEmit
		)
		expect(before.characters.map((c) => c.id)).not.toContain(f.persona.id)
		expect(before.characters.map((c) => c.id)).toContain(f.vell.id)

		await testDb
			.update(schema.sessionPersonas)
			.set({ removedAt: new Date() })
			.where(eq(schema.sessionPersonas.personaId, f.persona.id))
		const after = await sessionsSideCharacterOptionsHandler.handler(
			fakeSocket(f.user.id),
			{ sessionId: f.session.id },
			noopEmit
		)
		expect(after.characters.map((c) => c.id)).toContain(f.persona.id)
	}, 60_000)

	test("somebody who left the party can come back for one scene", async () => {
		// `session_characters` is soft-deleted and the rotation already ignores
		// a removed row, so a departed member is exactly who a side-character
		// turn is for. Offering only never-members would make leaving
		// permanent, which is the opposite of the feature.
		const { sessionsSideCharacterOptionsHandler } = await import(
			"./sessions"
		)
		const f = await makeSession("departed")
		await testDb
			.update(schema.sessionCharacters)
			.set({ removedAt: new Date() })
			.where(eq(schema.sessionCharacters.characterId, f.alice.id))

		const res = await sessionsSideCharacterOptionsHandler.handler(
			fakeSocket(f.user.id),
			{ sessionId: f.session.id },
			noopEmit
		)
		const ids = res.characters.map((c) => c.id)
		expect(ids).toContain(f.alice.id)
		expect(ids).not.toContain(f.bram.id)
	}, 60_000)

	test("a stranger gets nothing", async () => {
		const { sessionsSideCharacterOptionsHandler } = await import(
			"./sessions"
		)
		const f = await makeSession("options-stranger")
		const other = await makeSession("options-other")
		const res = await sessionsSideCharacterOptionsHandler.handler(
			fakeSocket(other.user.id),
			{ sessionId: f.session.id },
			noopEmit
		)
		expect(res.error).toBe("Session not found.")
		expect(res.characters).toEqual([])
	}, 60_000)
})
