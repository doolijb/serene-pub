/**
 * 🚧 The host half of `cast-member@1` / `update-cast-member@1` over a real
 * database: how a member is named, how it reads, what a story write may change.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import {
	insertCard,
	insertCastMember,
	newCardVersion
} from "$lib/server/characters/versions"
import {
	CastMemberRefusal,
	readCastMember,
	resolveCastMember,
	writeCastMember
} from "./castMember"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

const GENRE = "test:genre/cast-member"
const REFERENCE_GENRE = "chariot.desk:inlet/reference@1"
let n = 0
const db = () => testDb as unknown as Db

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-castmember-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
	await testDb.insert(schema.pipelineDefinitionRegistry).values({
		definitionId: "chariot.desk:inlet/reference",
		version: 1,
		kind: "inlet",
		status: "live",
		i18n: { name: { en: "Reference Desk" } },
		ports: {},
		sessionShape: {
			composer: "text",
			lorebook: "optional",
			writes: { lore: false, scenes: false }
		}
	} as any)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function world(o: { card?: boolean; genreId?: string } = {}) {
	_clearAttributeSlots()
	genreKeeping(GENRE, {
		name: { en: "Cast member" },
		family: "test",
		slots: [],
		events: {}
	})
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `cm-${suffix}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${suffix}` })
		.returning()
	const [elsewhere] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Elsewhere ${suffix}` })
		.returning()
	const { card } = await insertCard(db(), {
		userId: user.id,
		name: `Card ${suffix}`,
		description: "The card's description."
	})
	const hasCard = o.card !== false
	const { member } = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: `{{char:${suffix}}}`,
		characterId: hasCard ? card.id : null,
		name: `Ada ${suffix}`,
		description: hasCard ? null : "Her own description."
	})
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			genreId: o.genreId ?? GENRE,
			lorebookId: book!.id
		})
		.returning()
	return {
		user,
		book: book!,
		elsewhere: elsewhere!,
		card,
		member,
		session: session!,
		suffix
	}
}
type World = Awaited<ReturnType<typeof world>>

const message = async (sessionId: number) =>
	(
		await testDb
			.insert(schema.messages)
			.values({ sessionId, role: "assistant", content: "…" } as any)
			.returning({ id: schema.messages.id })
	)[0]!.id

const write = (
	w: World,
	changes: unknown,
	extra: { member?: unknown; messageId?: number } = {}
) =>
	writeCastMember(db(), {
		sessionId: w.session.id,
		member: extra.member ?? w.member.id,
		changes,
		runId: w.session.id,
		messageId: extra.messageId
	})

const refusal = async (p: Promise<unknown>, text: string | RegExp) => {
	const err = await p.then(
		() => null,
		(e) => e
	)
	expect(err).toBeInstanceOf(CastMemberRefusal)
	expect((err as Error).message).toMatch(text)
}

const asRead = async (w: World) => {
	const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
	return (
		await membersAsRead(db(), [w.member.id], { sessionId: w.session.id })
	).get(w.member.id)!
}

describe("resolve", () => {
	test("a seat ref, an id in the session's book; refusals", async () => {
		const w = await world()
		const [seat] = await testDb
			.insert(schema.sessionCharacters)
			.values({
				sessionId: w.session.id,
				characterId: w.card.id,
				castMemberId: w.member.id,
				position: 0
			})
			.returning()
		const [pSeat, bare] = await testDb
			.insert(schema.sessionPersonas)
			.values([
				{
					sessionId: w.session.id,
					personaId: w.card.id,
					castMemberId: w.member.id,
					position: 1
				},
				{
					sessionId: w.session.id,
					personaId: null,
					seatName: "Nameless",
					position: 2
				}
			])
			.returning()
		expect(seat!.id).toBeGreaterThan(0)
		const id = (m: unknown) => resolveCastMember(db(), w.session.id, m)
		expect(await id(` seated-member:${w.member.id} `)).toBe(w.member.id)
		expect(await id(`player-seat:${pSeat!.id}`)).toBe(w.member.id)
		expect(await id(w.member.id)).toBe(w.member.id)

		const { member: other } = await insertCastMember(db(), {
			lorebookId: w.elsewhere.id,
			binding: `{{char:other-${w.suffix}}}`,
			name: "Elsewhere"
		})
		await refusal(id(other.id), /not in this session's lorebook/)
		const { member: overlay } = await insertCastMember(db(), {
			lorebookId: w.book.id,
			binding: `{{char:overlay-${w.suffix}}}`,
			name: "Overlay",
			overlayOf: w.member.id
		} as any)
		await refusal(
			id(overlay.id),
			new RegExp(`notes on cast member ${w.member.id}`)
		)
		await refusal(id("character:5"), /seated member/)
		await refusal(id(String(w.member.id)), /seated member/)
		await refusal(id(null), /seated member/)
		await refusal(id(`player-seat:${bare!.id}`), /voices no cast member/)
		await refusal(id("player-seat:99999999"), /not seated/)
		await refusal(id(99999999), /does not exist/)
	})
})

describe("read", () => {
	test("a card-followed member, then behind its card", async () => {
		const w = await world()
		const first = await readCastMember(db(), w.session.id, w.member.id)
		expect(first.castMemberId).toBe(w.member.id)
		expect(first.cardId).toBe(w.card.id)
		expect(first.cardVersion).not.toBeNull()
		expect(first.follows).toContain("description")
		expect(first.profile.description).toBe("The card's description.")
		expect(first.behindCard).toBe(false)

		await testDb.transaction((tx) =>
			newCardVersion(tx as unknown as Db, w.card.id, {
				...first.profile,
				description: "A newer description."
			})
		)
		const later = await readCastMember(db(), w.session.id, w.member.id)
		expect(later.behindCard).toBe(true)
		expect(later.profile.description).toBe("The card's description.")
	})

	test("a card-less member", async () => {
		const w = await world({ card: false })
		const read = await readCastMember(db(), w.session.id, w.member.id)
		expect(read).toMatchObject({
			cardless: true,
			cardId: null,
			follows: [],
			cardVersion: null
		})
		expect(read.profile.description).toBe("Her own description.")
	})
})

describe("write", () => {
	test("refusals", async () => {
		const w = await world()
		await refusal(write(w, {}), /nothing to change/)
		await refusal(
			write(w, { nodeState: "dead" }),
			/'dead' is not a cast state/
		)
		await refusal(
			write(w, { nodeVisibility: "public" }),
			/not a cast visibility/
		)
		await refusal(
			write(w, { nodeState: { follow: true } }),
			/no card value to follow/
		)
		await refusal(write(w, { first_mes: "Hi" }), /'first_mes'/)
		await refusal(write(w, { greetings: "hi" }), /'greetings'/)
		await refusal(write(w, { name: "" }), /non-empty/)
		await refusal(write(w, { faceMediaId: 424242 }), /A face/)
		await refusal(write(w, { timbre: { voice: "af_bella" } }), /A voice/)
		await refusal(
			write(w, { likeness: { imageMediaId: 7 } }),
			/A likeness image/
		)
	})

	test("a node visibility lands with the turn", async () => {
		const w = await world()
		const messageId = await message(w.session.id)
		await write(w, { nodeVisibility: "legendary" }, { messageId })
		expect((await asRead(w)).nodeVisibility).toBe("legendary")
	})

	test("a genre that keeps its lorebook as reference refuses", async () => {
		const w = await world({ genreId: REFERENCE_GENRE })
		const { loreWriteRefusal } = await import("$lib/server/messages/writes")
		const sentence = await loreWriteRefusal(db(), w.session.id)
		expect(sentence).toBeTruthy()
		await refusal(write(w, { description: "x" }), sentence!)
	})

	test("a story write lands, a second in the same turn coalesces", async () => {
		const w = await world()
		const messageId = await message(w.session.id)
		const first = await write(
			w,
			{ description: "A new description." },
			{ messageId }
		)
		expect((await asRead(w)).description).toBe("A new description.")
		const [row] = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.id, first.castVersionId))
		expect(row!.castMemberId).toBe(first.castMemberId)
		expect(first.castMemberId).toBe(w.member.id)

		const second = await write(w, { personality: "Wry." }, { messageId })
		expect(second.coalesced).toBe(true)
		expect(second.castVersionId).toBe(first.castVersionId)
		const read = await asRead(w)
		expect(read.description).toBe("A new description.")
		expect(read.personality).toBe("Wry.")
	})

	test("greetings: `groupOnly: false` is absence; an extra key is refused", async () => {
		const w = await world()
		const messageId = await message(w.session.id)
		await refusal(
			write(
				w,
				{ greetings: [{ text: "Hi.", mood: "warm" }] },
				{ messageId }
			),
			/'greetings'/
		)
		await write(
			w,
			{
				greetings: [
					{ text: "Hello.", groupOnly: false },
					{ text: "All of you!", groupOnly: true }
				]
			},
			{ messageId }
		)
		expect((await asRead(w)).greetings).toEqual([
			{ text: "Hello." },
			{ text: "All of you!", groupOnly: true }
		])
	})

	test("an unchanged face passes; a follow on a card-less member is refused by the writer", async () => {
		const w = await world({ card: false })
		const messageId = await message(w.session.id)
		await write(w, { faceMediaId: null }, { messageId })
		await expect(
			write(w, { description: { follow: true } }, { messageId })
		).rejects.toThrow()
	})
})
