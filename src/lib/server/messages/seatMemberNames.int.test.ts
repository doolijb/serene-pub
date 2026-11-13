/**
 * 🚧 Names read the seated member (plan §27 S2, lane s27-S2-turns): "may act
 * on this line" through the seat, an outcome's `by` named by the member, a
 * status line's `{speaker}`, a live scene's cast proposal, the scene cast
 * list, and a conversation's session card. A seat's member is read wherever
 * it lives, including a session whose lorebook is its own book; a seat with
 * no member reads the card.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertLegacy } from "./store"
import { canActOnMessage } from "./permissions"
import { outcomeWordsOf } from "./diceWords"
import { insertCastMember } from "$lib/server/characters/versions"
import { insertDatedCardVersion } from "$lib/server/pipelines/testing/fixtures"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-s27turns-names-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `names-${++n}`)
}

async function card(
	userId: number,
	name: string,
	over: Partial<typeof schema.characters.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: `${name}.`, ...over })
		.returning()
	return row!
}

async function book(userId: number) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${++n}` } as any)
		.returning()
	return row!
}

async function ownBookOfSession(sessionId: number, userId: number) {
	const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
	return insertOwnBook(db(), {
		sessionId,
		userId,
		name: null,
		overlayOf: null,
		primaryRuleset: "core:ruleset/freeform@1",
		rulesetVersion: null
	})
}

async function member(
	lorebookId: number,
	characterId: number | null,
	over: Partial<typeof schema.lorebookBindings.$inferInsert> = {}
) {
	const row = (
		await insertCastMember(testDb, {
			lorebookId,
			characterId,
			binding: `{{char:${++n}}}`,
			name: "member",
			...over
		} as any)
	).member
	return row!
}

async function session(
	userId: number,
	lorebookId: number | null,
	over: Record<string, unknown> = {}
) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `Run ${++n}`,
			lorebookId,
			...over
		} as any)
		.returning()
	return row!
}

async function characterSeat(
	sessionId: number,
	characterId: number,
	castMemberId: number | null,
	over: Partial<typeof schema.sessionCharacters.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId, castMemberId, ...over } as any)
		.returning()
	return row!
}

async function playerSeat(
	sessionId: number,
	userId: number,
	personaId: number | null,
	castMemberId: number | null
) {
	const [row] = await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId, userId, personaId, castMemberId } as any)
		.returning()
	return row!
}

describe("may act on this line, through the seat", () => {
	test("the owner of the seat's card, a guest's own persona line, and a card no seat holds", async () => {
		const owner = await user()
		const guest = await user()
		const stranger = await user()
		const npc = await card(owner.id, "Verity")
		const persona = await card(guest.id, "Guest Persona")
		const gone = await card(guest.id, "Left The Room")
		const b = await book(owner.id)
		const mNpc = await member(b.id, npc.id, { ownName: "Vee" })
		const mPersona = await member(b.id, persona.id)
		const s = await session(owner.id, b.id)
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: s.id, userId: guest.id } as any)
		await characterSeat(s.id, npc.id, mNpc.id)
		await playerSeat(s.id, guest.id, persona.id, mPersona.id)

		const npcLine = await insertLegacy(db(), {
			sessionId: s.id,
			role: "assistant",
			content: "I speak.",
			characterId: npc.id
		})
		const personaLine = await insertLegacy(db(), {
			sessionId: s.id,
			role: "user",
			content: "I answer.",
			userId: guest.id,
			personaId: persona.id
		})
		// A persona the session no longer seats: judged by the card's owner, as before.
		const goneLine = await insertLegacy(db(), {
			sessionId: s.id,
			role: "user",
			content: "I left.",
			userId: guest.id,
			personaId: gone.id
		})

		expect(await canActOnMessage(db(), npcLine.id, owner.id)).toBe(true)
		expect(await canActOnMessage(db(), npcLine.id, guest.id)).toBe(false)
		expect(await canActOnMessage(db(), npcLine.id, stranger.id)).toBe(false)
		expect(await canActOnMessage(db(), personaLine.id, guest.id)).toBe(true)
		expect(await canActOnMessage(db(), personaLine.id, owner.id)).toBe(
			false
		)
		expect(await canActOnMessage(db(), goneLine.id, guest.id)).toBe(true)
		expect(await canActOnMessage(db(), goneLine.id, owner.id)).toBe(false)
	})
})

// Owner ruling 2026-11-05: "Everything in session is cast -> active card."
// "Own" is the owner of the seat member's active card on the session's reading.
describe("may act on this line: the owner of the member's active card", () => {
	/** A member linked to card A (owned by aOwner), drawn by card B (bOwner) from year 20; a seat holds A. */
	async function dated(clockYear: number) {
		const owner = await user()
		const aOwner = await user()
		const bOwner = await user()
		const a = await card(aOwner.id, "Aurelia")
		const bCard = await card(bOwner.id, "Beatrix")
		const b = await book(owner.id)
		const m = await member(b.id, a.id)
		await insertDatedCardVersion(testDb, m.id, bCard.id, 20)
		const s = await session(owner.id, b.id, { storyClockYear: clockYear })
		await testDb.insert(schema.sessionGuests).values([
			{ sessionId: s.id, userId: aOwner.id },
			{ sessionId: s.id, userId: bOwner.id }
		] as any)
		await characterSeat(s.id, a.id, m.id)
		const line = await insertLegacy(db(), {
			sessionId: s.id,
			role: "assistant",
			content: "I speak.",
			characterId: a.id
		})
		return { aOwner, bOwner, owner, line }
	}

	test("once the clock draws the dated card, its owner can act on the seat's line and the seat card's owner cannot", async () => {
		const w = await dated(30)
		expect(await canActOnMessage(db(), w.line.id, w.bOwner.id)).toBe(true)
		expect(await canActOnMessage(db(), w.line.id, w.aOwner.id)).toBe(false)
		expect(await canActOnMessage(db(), w.line.id, w.owner.id)).toBe(true)
	})

	test("before the dated card, the linked card's owner can act on it", async () => {
		const w = await dated(10)
		expect(await canActOnMessage(db(), w.line.id, w.aOwner.id)).toBe(true)
		expect(await canActOnMessage(db(), w.line.id, w.bOwner.id)).toBe(false)
	})

	test("a seat with no member is judged by its card", async () => {
		const owner = await user()
		const aOwner = await user()
		const other = await user()
		const a = await card(aOwner.id, "Alone")
		const b = await book(owner.id)
		const s = await session(owner.id, b.id)
		await testDb.insert(schema.sessionGuests).values([
			{ sessionId: s.id, userId: aOwner.id },
			{ sessionId: s.id, userId: other.id }
		] as any)
		await characterSeat(s.id, a.id, null)
		const line = await insertLegacy(db(), {
			sessionId: s.id,
			role: "assistant",
			content: "I speak.",
			characterId: a.id
		})
		expect(await canActOnMessage(db(), line.id, aOwner.id)).toBe(true)
		expect(await canActOnMessage(db(), line.id, other.id)).toBe(false)
	})

	test("a member the reading draws with no card falls back to the seat's card", async () => {
		const owner = await user()
		const aOwner = await user()
		const other = await user()
		const a = await card(aOwner.id, "Wren")
		const b = await book(owner.id)
		const m = await member(b.id, null)
		const s = await session(owner.id, b.id)
		await testDb.insert(schema.sessionGuests).values([
			{ sessionId: s.id, userId: aOwner.id },
			{ sessionId: s.id, userId: other.id }
		] as any)
		await characterSeat(s.id, a.id, m.id)
		const line = await insertLegacy(db(), {
			sessionId: s.id,
			role: "assistant",
			content: "I speak.",
			characterId: a.id
		})
		expect(await canActOnMessage(db(), line.id, aOwner.id)).toBe(true)
		expect(await canActOnMessage(db(), line.id, other.id)).toBe(false)
	})
})

describe("outcomeWordsOf", () => {
	const blocks = (by: string) => [
		{ kind: "dice", by, stat: "Stealth", outcome: "Failure" }
	]

	test("a character and a seated-member ref are named by the member; without a session, by the card", async () => {
		const u = await user()
		const c = await card(u.id, "Verity")
		const b = await book(u.id)
		const m = await member(b.id, c.id, { ownName: "Vee" })
		const s = await session(u.id, b.id)
		await characterSeat(s.id, c.id, m.id)

		expect(
			await outcomeWordsOf(db(), blocks(`character:${c.id}`), s.id)
		).toBe("Vee — Stealth: Failure.")
		expect(
			await outcomeWordsOf(db(), blocks(`seated-member:${m.id}`), s.id)
		).toBe("Vee — Stealth: Failure.")
		expect(await outcomeWordsOf(db(), blocks(`character:${c.id}`))).toBe(
			"Verity — Stealth: Failure."
		)
		// An unknown member names nobody, as an unknown ref does.
		expect(
			await outcomeWordsOf(db(), blocks("seated-member:999999"), s.id)
		).toBe("Stealth: Failure.")
	})

	test("a seat with no member reads the card; a member of the session's own book is read", async () => {
		const u = await user()
		const bare = await card(u.id, "Bare")
		const own = await card(u.id, "Wren")
		const s = await session(u.id, null)
		const ownBook = await ownBookOfSession(s.id, u.id)
		const m = await member(ownBook.id, own.id, {
			ownName: "Wren of the Notes"
		})
		await characterSeat(s.id, bare.id, null, { position: 0 })
		await characterSeat(s.id, own.id, m.id, { position: 1 })

		expect(
			await outcomeWordsOf(db(), blocks(`character:${bare.id}`), s.id)
		).toBe("Bare — Stealth: Failure.")
		expect(
			await outcomeWordsOf(db(), blocks(`character:${own.id}`), s.id)
		).toBe("Wren of the Notes — Stealth: Failure.")
	})
})

describe("a status line's {speaker}", () => {
	test("a character or seated-member ref reads the member's shown name; none seated reads the card", async () => {
		const { speakerDisplayName } = await import(
			"$lib/server/pipelines/runtime/runStatus"
		)
		const u = await user()
		const c = await card(u.id, "Verity", { nickname: "V" })
		const bare = await card(u.id, "Bare")
		const b = await book(u.id)
		const m = await member(b.id, c.id, {
			ownName: "Vee",
			ownNickname: "Vee-Vee"
		})
		const s = await session(u.id, b.id)
		await characterSeat(s.id, c.id, m.id, { position: 0 })
		await characterSeat(s.id, bare.id, null, { position: 1 })

		const name = (speaker: any) =>
			speakerDisplayName(db(), { sessionId: s.id, speaker })
		expect(await name(`character:${c.id}`)).toBe("Vee-Vee")
		expect(await name(`seated-member:${m.id}`)).toBe("Vee-Vee")
		expect(await name(`character:${bare.id}`)).toBe("Bare")
		expect(await name("seated-member:999999")).toBeUndefined()
	})

	test("a member of the session's own book is read", async () => {
		const { speakerDisplayName } = await import(
			"$lib/server/pipelines/runtime/runStatus"
		)
		const u = await user()
		const c = await card(u.id, "Dove")
		const s = await session(u.id, null)
		const ownBook = await ownBookOfSession(s.id, u.id)
		const m = await member(ownBook.id, c.id, {
			ownName: "Dove of the Notes"
		})
		await characterSeat(s.id, c.id, m.id)
		expect(
			await speakerDisplayName(db(), {
				sessionId: s.id,
				speaker: `character:${c.id}` as any
			})
		).toBe("Dove of the Notes")
	})
})

describe("a live scene's cast proposal", () => {
	test("senders and roster are named as their seats read them", async () => {
		const { readCastProposal } = await import(
			"$lib/server/scenes/liveScenes"
		)
		const u = await user()
		const c = await card(u.id, "Verity")
		const bare = await card(u.id, "Bare")
		const s = await session(u.id, null)
		const ownBook = await ownBookOfSession(s.id, u.id)
		const m = await member(ownBook.id, c.id, { ownName: "Vee" })
		await characterSeat(s.id, c.id, m.id, { position: 0 })
		await characterSeat(s.id, bare.id, null, { position: 1 })
		const first = await insertLegacy(db(), {
			sessionId: s.id,
			role: "assistant",
			content: "One.",
			characterId: c.id
		})
		await insertLegacy(db(), {
			sessionId: s.id,
			role: "assistant",
			content: "Two.",
			characterId: bare.id
		})
		const proposal = await readCastProposal(db(), {
			sessionId: s.id,
			lorebookId: ownBook.id,
			channel: "main",
			openedAtMessageId: first.id,
			closedAtMessageId: null
		} as any)
		const names = Object.fromEntries(
			proposal!.participants.map((p) => [p.key, p.name])
		)
		// A seat with a live card is keyed by its card in both modes (the
		// vocabulary's key); only a soft-deleted card's seat is `cast_member:`.
		expect(names[`character:${c.id}`]).toBe("Vee")
		expect(names[`character:${bare.id}`]).toBe("Bare")
	})
})

describe("the scene cast list", () => {
	test("a character seat is listed by its member's name", async () => {
		const { buildSceneCastList } = await import(
			"$lib/server/utils/summarizer/availableSceneCast"
		)
		const u = await user()
		const c = await card(u.id, "Wren")
		const attached = await book(u.id)
		const s = await session(u.id, attached.id)
		const ownBook = await ownBookOfSession(s.id, u.id)
		const m = await member(ownBook.id, c.id, {
			ownName: "Wren of the Notes"
		})
		await characterSeat(s.id, c.id, m.id)
		const cast = await buildSceneCastList(null, attached.id, s.id, db())
		const entry = cast.find((e) => e.name === "Wren of the Notes")
		expect(entry).toBeTruthy()
		// The card's bare name is not listed as a second person.
		expect(cast.filter((e) => e.name === "Wren")).toHaveLength(0)
	})
})

describe("a conversation's session card", () => {
	test("faces read the seated member: own name, own face while retold, else the card's avatar", async () => {
		const { attachmentCardFor } = await import(
			"$lib/server/conversations/gate"
		)
		const u = await user()
		const [avatar] = await testDb
			.insert(schema.files)
			.values({
				userId: u.id,
				kind: "image",
				hash: `avatar-${++n}`
			} as any)
			.returning()
		const [face] = await testDb
			.insert(schema.files)
			.values({ userId: u.id, kind: "image", hash: `face-${++n}` } as any)
			.returning()
		const retold = await card(u.id, "Retold", { avatarMediaId: avatar.id })
		const plain = await card(u.id, "Plain", { avatarMediaId: avatar.id })
		const bare = await card(u.id, "Bare", { nickname: "Bee" })
		const b = await book(u.id)
		const mRetold = await member(b.id, retold.id, {
			ownName: "Vee",
			faceMediaId: face.id,
			retold: { face: true }
		})
		const mPlain = await member(b.id, plain.id, { ownName: "Pip" })
		const s = await session(u.id, b.id, { name: "" })
		await characterSeat(s.id, retold.id, mRetold.id, { position: 0 })
		await characterSeat(s.id, plain.id, mPlain.id, { position: 1 })
		await characterSeat(s.id, bare.id, null, { position: 2 })

		const out: any = await attachmentCardFor("session", s.id, u.id, db())
		expect(out.faces.map((f: any) => f.name)).toEqual(["Vee", "Pip", "Bee"])
		expect(out.title).toBe("Vee, Pip, Bee")
		expect(out.faces[0].src).toContain(face.uuid)
		expect(out.faces[1].src).toContain(avatar.uuid)
		expect(out.faces[2].src).toBeNull()
	})
})
