/**
 * 🚧 The scene's cast, as core's compiler lists it (owner rulings D57
 * 2026-11-16 and B1 2026-11-17): each cast member that **sent at least one
 * line** in the scene's range and whose **place does not rule it out**. The
 * roster and the names found in lines make no stored participant; benching
 * plays no part. Every case goes through the real writers (`openScene`,
 * `closeScene`, `moveSceneBoundary`, `mergeScene`, `refreshOpenSceneCast`) and
 * reads `scene_characters`.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertLegacy } from "$lib/server/messages/store"
import { insertCastMember } from "$lib/server/characters/versions"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import { genreKeeping } from "$lib/server/utils/testGenre"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string
let seq = 0

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return testDbModule(await createTestDb())
})

/** A genre that declares a place key (`location`) and the cast refresh. */
const PLACED = "test:genre/castrule-placed"
/** A genre that declares no place key. */
const PLAIN = "test:genre/castrule-plain"
const LOCATION = "core:slot/location@1"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-castrule-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { sessionEvents } = await import("@serene-pub/sdk")
	const { locationSlot } = await import("@serene-pub/core-catalog")
	// The host keeps the place slot as the placed genre's tool state, so its sessions track a world place.
	genreKeeping(PLACED, {
		name: { en: "Placed" },
		family: "test",
		shape: {
			channels: ["main"],
			scenes: { place: { stateKey: "location" } }
		},
		slots: [locationSlot],
		events: {}
	})
	/** One published version of a slug, as the registry holds it. */
	const publish = async (slug: string, version: Record<string, unknown>) => {
		const [spec] = await testDb
			.insert(schema.pipelineSpecs)
			.values({ slug, name: slug })
			.returning()
		const [row] = await testDb
			.insert(schema.pipelineSpecVersions)
			.values({
				specId: spec.id,
				semver: "1.0.0",
				status: "published",
				canonicalHash: `test-${slug}`,
				...version
			} as any)
			.returning()
		await testDb
			.update(schema.pipelineSpecs)
			.set({ activeVersionId: row.id })
			.where(eq(schema.pipelineSpecs.id, spec.id))
	}
	await publish("test:spec/castrule-placed-create", {
		inputGenre: PLACED,
		inputEvent: sessionEvents.sessionCreated,
		genre: {
			name: { en: "Placed" },
			family: "test",
			shape: {
				channels: ["main"],
				scenes: { place: { stateKey: "location" }, castRefresh: true }
			}
		}
	})
	await publish("test:spec/castrule-plain-create", {
		inputGenre: PLAIN,
		inputEvent: sessionEvents.sessionCreated,
		genre: {
			name: { en: "Plain" },
			family: "test",
			shape: { channels: ["main"], scenes: { castRefresh: true } }
		}
	})
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db

type Seat = {
	card: { id: number; name: string }
	member: { id: number }
	seatId: number
	player: boolean
}
type World = Awaited<ReturnType<typeof world>>

/** A person, a book with a timeline, and a session of the genre reading it. */
async function world(genreId: string = PLACED) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const label = `castrule-${++seq}`
	const user = await createTestUser(testDb, label)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: label, userId: user.id })
		.returning()
	await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([{ lorebookId: book.id, year: 5, month: 1, day: 2 }])
		)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: label,
			lorebookId: book.id,
			genreId,
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 2,
			storyClockHour: 9,
			storyClockMinute: 30
		} as any)
		.returning()
	return { user, book, session }
}

/** A character seat: a card, its member in the book, the seat row. */
async function seatCharacter(w: World, name: string): Promise<Seat> {
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId: w.user.id, name, description: `${name}.` })
		.returning()
	const { member } = await insertCastMember(db(), {
		lorebookId: w.book.id,
		characterId: card.id,
		binding: `{{char:${name.toLowerCase()}}}`,
		name
	} as any)
	const [seat] = await testDb
		.insert(schema.sessionCharacters)
		.values({
			sessionId: w.session.id,
			characterId: card.id,
			castMemberId: member.id,
			seatedByUserId: w.user.id
		} as any)
		.returning()
	return { card, member, seatId: seat.id, player: false }
}

/** A player seat: a persona card, its member, the seat row. */
async function seatPlayer(w: World, name: string): Promise<Seat> {
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId: w.user.id, name, description: `${name}.` })
		.returning()
	const { member } = await insertCastMember(db(), {
		lorebookId: w.book.id,
		characterId: card.id,
		binding: `{{char:${name.toLowerCase()}}}`,
		name
	} as any)
	const [seat] = await testDb
		.insert(schema.sessionPersonas)
		.values({
			sessionId: w.session.id,
			userId: w.user.id,
			personaId: card.id,
			castMemberId: member.id
		} as any)
		.returning()
	return { card, member, seatId: seat.id, player: true }
}

/** A line sent by a seat (or narration, with none). */
async function say(w: World, who: Seat | null, content: string) {
	const m = await insertLegacy(db(), {
		sessionId: w.session.id,
		role: who?.player ? "user" : "assistant",
		content,
		...(who
			? who.player
				? { personaId: who.card.id }
				: { characterId: who.card.id }
			: {})
	} as any)
	return m.id
}

/** Wait a few ms so a ledger write is later than the line before it (`created_at` ties read as "by then"). */
const tick = () => new Promise((r) => setTimeout(r, 8))

/** One value written to a seat's own place, as a keeper's apply appends it. */
async function setOwnPlace(w: World, who: Seat, v: unknown) {
	await tick()
	await testDb.insert(schema.attributeValues).values({
		ownerKind: who.player ? "player_seat" : "seated_member",
		ownerId: who.player ? who.seatId : who.member.id,
		slotId: LOCATION,
		value: { v },
		sessionId: w.session.id,
		updatedBy: "run:test"
	} as any)
	await tick()
}

/** The world's place, as a keeper's apply appends it. */
async function setWorldPlace(w: World, v: unknown) {
	await tick()
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "session",
		ownerId: w.session.id,
		slotId: LOCATION,
		value: { v },
		sessionId: w.session.id,
		updatedBy: "run:test"
	} as any)
	await tick()
}

async function open(w: World, atMessageId: number, closeAt?: number) {
	const { openScene } = await import("$lib/server/scenes/liveScenes")
	return (
		await openScene(db(), {
			sessionId: w.session.id,
			userId: w.user.id,
			channel: "main",
			atMessageId,
			...(closeAt != null ? { closeAt } : {})
		})
	).scene
}

/** The members the scene stores as participants. */
async function participantsOf(sceneId: number): Promise<number[]> {
	const rows = await testDb
		.select({
			bindingId: schema.sceneCharacters.bindingId,
			ordinal: schema.sceneCharacters.ordinal
		})
		.from(schema.sceneCharacters)
		.where(
			and(
				eq(schema.sceneCharacters.sceneId, sceneId),
				eq(schema.sceneCharacters.role, "participant")
			)
		)
	return rows.sort((a, b) => a.ordinal - b.ordinal).map((r) => r.bindingId)
}

const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b)
const membersOf = (...seats: Seat[]) => sorted(seats.map((s) => s.member.id))

async function refresh(w: World, messageId: number) {
	const { refreshOpenSceneCast } = await import(
		"$lib/server/scenes/liveScenes"
	)
	return refreshOpenSceneCast(db(), {
		sessionId: w.session.id,
		channel: "main",
		messageId
	})
}

/** The most statements a refresh may cost (measured, pinned): before the lane a refresh cost 41 whoever spoke. */
const LISTED_CEILING = 5
/** A new speaker adds the Edit history row's insert and the select that keeps the newest 50. */
const NEWCOMER_CEILING = 53

/** Statements one refresh costs: `refreshOpenSceneCast` for the line, counted at the database client. */
async function statementsOf(w: World, messageId: number, placeKey?: string | null) {
	const client = (
		testDb as unknown as {
			$client: { query: (...a: unknown[]) => unknown }
		}
	).$client
	const original = client.query.bind(client)
	let n = 0
	client.query = (...args: unknown[]) => {
		n++
		return original(...args)
	}
	try {
		const { refreshOpenSceneCast } = await import(
			"$lib/server/scenes/liveScenes"
		)
		await refreshOpenSceneCast(db(), {
			sessionId: w.session.id,
			channel: "main",
			messageId,
			...(placeKey !== undefined ? { placeKey } : {})
		})
	} finally {
		client.query = original
	}
	return n
}

/** A scene with `earlier` lines by two speakers in the scene's place, then one refresh by each kind of speaker. */
async function refreshCosts(earlier: number, placeKey?: string | null, held = 0) {
	const w = await world(PLACED)
	const mira = await seatCharacter(w, "Mira")
	const tomas = await seatPlayer(w, "Tomas")
	const grust = await seatCharacter(w, "Grust")
	await setWorldPlace(w, "the Tavern")
	await setOwnPlace(w, mira, "the Tavern")
	await setOwnPlace(w, tomas, "the Tavern")
	await setOwnPlace(w, grust, "the Tavern")
	const first = await say(w, mira, "Mira looks up.")
	for (let i = 0; i < earlier; i++)
		await say(w, i % 2 ? tomas : mira, `Line ${i}.`)
	const scene = await open(w, first)
	// Edit history rows the scene already holds (`held`), as a run left them.
	if (held)
		await testDb.insert(schema.loreRedlines).values(
			Array.from({ length: held }, () => ({
				sceneId: scene.id,
				changes: {
					participantCharacters: { before: { v: [] }, after: { v: [1] } }
				},
				cause: "scene-compiler",
				sessionId: w.session.id
			}))
		)
	const listed = await statementsOf(w, await say(w, mira, "Mira sets the cup down."), placeKey)
	const newcomer = await statementsOf(w, await say(w, grust, "Grust comes in."), placeKey)
	expect(sorted(await participantsOf(scene.id))).toEqual(
		membersOf(mira, tomas, grust)
	)
	return { listed, newcomer }
}

describe("what one refresh costs", () => {
	test("a line by a listed speaker and a line by a new one cost a fixed number of statements, however many lines came before", async () => {
		const few = await refreshCosts(5)
		const many = await refreshCosts(40)
		expect(many).toEqual(few)
		// A listed speaker costs the scene, the line, the card's member and the stored cast; below the 41 a refresh cost before.
		expect(few.listed).toBeLessThan(41)
		expect(few.listed).toBeLessThanOrEqual(LISTED_CEILING)
		expect(few.newcomer).toBeLessThanOrEqual(NEWCOMER_CEILING)
	})

	test("a scene already holding 50 Edit history rows costs a new speaker one more statement, the delete of the oldest", async () => {
		const light = await refreshCosts(5)
		const full = await refreshCosts(5, undefined, 50)
		expect(full.listed).toBe(light.listed)
		expect(full.newcomer).toBe(light.newcomer + 1)
	})

	test("the caller's place key spares the genre read", async () => {
		const read = await refreshCosts(5)
		const held = await refreshCosts(5, "location")
		expect(held.listed).toBe(read.listed)
		expect(held.newcomer).toBeLessThan(read.newcomer)
	})
})

/** The lorebook's member rows, as a count: nothing is minted for a person only named. */
async function memberCount(lorebookId: number) {
	return (
		await testDb
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
	).length
}

async function bench(who: Seat) {
	await testDb
		.update(who.player ? schema.sessionPersonas : schema.sessionCharacters)
		.set({ isActive: false })
		.where(
			eq(
				who.player
					? schema.sessionPersonas.id
					: schema.sessionCharacters.id,
				who.seatId
			)
		)
}

describe("who sent a line", () => {
	test("a speaker is listed; a seated, active, silent seat and a silent player seat are not", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const tomas = await seatPlayer(w, "Tomas")
		await seatCharacter(w, "Pell")
		await seatPlayer(w, "Ysolde")
		const first = await say(w, mira, "Mira looks up.")
		await say(w, tomas, "I sit down.")
		await say(w, null, "Rain.")
		const scene = await open(w, first)
		expect(sorted(await participantsOf(scene.id))).toEqual(
			membersOf(mira, tomas)
		)
	})

	test("a name only spoken to or mentioned is not listed, and no member is minted for it", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		await seatCharacter(w, "Pell")
		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: w.book.id,
			characterId: null,
			binding: "{{char:grust}}",
			name: "Grust"
		})
		const first = await say(
			w,
			mira,
			'"Pell, come here," Mira said. "And Grust, you too."'
		)
		await say(w, null, 'Torvald nodded while Grust waited. "Two it is."')
		const before = await memberCount(w.book.id)
		const scene = await open(w, first)
		expect(await participantsOf(scene.id)).toEqual([mira.member.id])
		expect(await memberCount(w.book.id)).toBe(before)
	})
})

/** A failed reply: an error on the row and no words. */
async function failedLine(w: World, who: Seat) {
	const id = await say(w, who, "")
	await testDb
		.update(schema.sessionMessages)
		.set({ error: { message: "No model is set for Reply." } })
		.where(eq(schema.sessionMessages.id, id))
	return id
}

describe("a failed reply is nobody's line", () => {
	test("a member with only failed rows is not listed; a real line after them lists the member", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const tomas = await seatPlayer(w, "Tomas")
		const first = await say(w, tomas, "I sit down.")
		await failedLine(w, mira)
		await failedLine(w, mira)
		const scene = await open(w, first)
		expect(await participantsOf(scene.id)).toEqual([tomas.member.id])
		await say(w, mira, "Mira looks up.")
		const { readCastProposal } = await import("$lib/server/scenes/liveScenes")
		const [row] = await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, scene.id))
		const keys = (await readCastProposal(db(), row))!.participants.map((p) => p.key)
		expect(keys).toHaveLength(2)
	})

	test("the open-scene refresh adds no speaker for a failed row", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const tomas = await seatPlayer(w, "Tomas")
		const first = await say(w, tomas, "I sit down.")
		const scene = await open(w, first)
		expect(await refresh(w, await failedLine(w, mira))).toBe(false)
		expect(await participantsOf(scene.id)).toEqual([tomas.member.id])
		expect(await refresh(w, await say(w, mira, "Mira looks up."))).toBe(true)
		expect(sorted(await participantsOf(scene.id))).toEqual(membersOf(mira, tomas))
	})

	test("the review seed's speakers leave a failed row out", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const tomas = await seatPlayer(w, "Tomas")
		const a = await say(w, tomas, "I sit down.")
		const b = await failedLine(w, mira)
		const { sceneCastSpeakers, storyLinesInRange } = await import(
			"$lib/server/scenes/liveScenes"
		)
		const lines = await storyLinesInRange(db(), w.session.id, "main", a, null)
		expect(lines.map((l) => l.id)).not.toContain(b)
		const speakers = await sceneCastSpeakers(
			db(),
			{ sessionId: w.session.id, lorebookId: w.book.id },
			lines
		)
		expect([...speakers]).toEqual([`card:${tomas.card.id}`])
	})
})

describe("the proposal lists a speaker once", () => {
	test("a person with card lines and side-character lines is one key, the card's", async () => {
		const w = await world(PLAIN)
		const bram = await seatCharacter(w, "Bram")
		const first = await say(w, bram, "Bram looks up.")
		await line(
			w,
			{ metadata: { speaker: `character:${bram.card.id}`, sideCharacter: { name: "Bram", characterId: bram.card.id } } },
			"Bram clears his throat."
		)
		const scene = await open(w, first)
		const { readCastProposal } = await import("$lib/server/scenes/liveScenes")
		const [row] = await testDb.select().from(schema.scenes).where(eq(schema.scenes.id, scene.id))
		expect((await readCastProposal(db(), row))!.participants.map((p) => p.key)).toEqual([
			`character:${bram.card.id}`
		])
	})
})

/** A member of the book with no card of its own. */
async function cardlessMember(w: World, name: string) {
	const [member] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: w.book.id,
			characterId: null,
			binding: `{{char:${name.toLowerCase()}-${++seq}}}`,
			name
		})
		.returning()
	return member
}

/** A line stored with the given speaker columns and metadata, and no card unless one is given. */
async function line(
	w: World,
	values: {
		role?: string
		castMemberId?: number
		characterId?: number
		metadata?: Record<string, unknown>
	},
	content = "A line."
) {
	const m = await insertLegacy(db(), {
		sessionId: w.session.id,
		role: values.role ?? "assistant",
		content,
		...values
	} as any)
	return m.id
}

describe("who spoke a line is what the line stores", () => {
	test("a card-less character seat (the line's member) is listed", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const grust = await cardlessMember(w, "Grust")
		await testDb
			.insert(schema.sessionCharacters)
			.values({
				sessionId: w.session.id,
				castMemberId: grust.id,
				seatedByUserId: w.user.id
			} as any)
		const first = await say(w, mira, "Mira looks up.")
		await line(w, { castMemberId: grust.id }, "Grust grunts.")
		const scene = await open(w, first)
		expect(sorted(await participantsOf(scene.id))).toEqual(
			sorted([mira.member.id, grust.id])
		)
	})

	test("a card-less player seat (stamped player-seat:<id>) is listed as that seat's member", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const ilsa = await cardlessMember(w, "Ilsa")
		const [seat] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: w.session.id,
				userId: w.user.id,
				castMemberId: ilsa.id
			} as any)
			.returning()
		const first = await say(w, mira, "Mira looks up.")
		await line(
			w,
			{ role: "user", metadata: { speaker: `player-seat:${seat.id}` } },
			"I step forward."
		)
		const scene = await open(w, first)
		expect(sorted(await participantsOf(scene.id))).toEqual(
			sorted([mira.member.id, ilsa.id])
		)
	})

	test("a side-character turn (character_id null, stamped character:<id>) is listed as that card's member", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		const first = await say(w, mira, "Mira looks up.")
		await line(
			w,
			{
				metadata: {
					speaker: `character:${bram.card.id}`,
					sideCharacter: { name: "Bram", characterId: bram.card.id }
				}
			},
			"Bram clears his throat."
		)
		const scene = await open(w, first)
		expect(sorted(await participantsOf(scene.id))).toEqual(
			membersOf(mira, bram)
		)
	})

	test("a side-character turn that names its card only in sideCharacter is listed too", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		const first = await say(w, mira, "Mira looks up.")
		await line(
			w,
			{ metadata: { sideCharacter: { name: "Bram", characterId: bram.card.id } } },
			"Bram nods."
		)
		const scene = await open(w, first)
		expect(sorted(await participantsOf(scene.id))).toEqual(
			membersOf(mira, bram)
		)
	})

	test("a line whose member is gone lists nobody", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const grust = await cardlessMember(w, "Grust")
		const first = await say(w, mira, "Mira looks up.")
		const spoken = await line(w, { castMemberId: grust.id }, "Grust grunts.")
		await testDb
			.delete(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, grust.id))
		const scene = await open(w, first)
		expect(await participantsOf(scene.id)).toEqual([mira.member.id])
		expect(await refresh(w, spoken)).toBe(false)
	})

	test("a plain narrator line lists nobody its text only names", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const first = await say(w, mira, "Mira looks up.")
		await line(
			w,
			{ metadata: { speaker: "envoy:narrator" } },
			'Mira said, "Rain." Bram nodded.'
		)
		await say(w, null, 'Pell said, "Two it is."')
		const scene = await open(w, first)
		expect(await participantsOf(scene.id)).toEqual([mira.member.id])
		expect(await refresh(w, await say(w, null, "More rain."))).toBe(false)
	})

	test("a card-less member whose own place differs from the scene's is not listed", async () => {
		const w = await world(PLACED)
		const mira = await seatCharacter(w, "Mira")
		const grust = await cardlessMember(w, "Grust")
		await setWorldPlace(w, "the Tavern")
		await setOwnPlace(w, mira, "the Tavern")
		await tick()
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "seated_member",
			ownerId: grust.id,
			slotId: LOCATION,
			value: { v: "the Cellar" },
			sessionId: w.session.id,
			updatedBy: "run:test"
		} as any)
		await tick()
		const first = await say(w, mira, "Mira looks up.")
		const spoken = await line(w, { castMemberId: grust.id }, "Grust grunts.")
		const scene = await open(w, first)
		expect(await participantsOf(scene.id)).toEqual([mira.member.id])
		expect(await refresh(w, spoken)).toBe(false)
	})
})

describe("benching plays no part", () => {
	test("benched after speaking is listed; benched and silent is not", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		const pell = await seatCharacter(w, "Pell")
		const first = await say(w, mira, "Mira looks up.")
		await say(w, bram, "Bram looks up.")
		await bench(bram)
		await bench(pell)
		const scene = await open(w, first)
		expect(sorted(await participantsOf(scene.id))).toEqual(
			membersOf(mira, bram)
		)
	})
})

describe("the place rule", () => {
	test("a member whose own place at its line differs from the scene's place is not listed; the same place is", async () => {
		const w = await world(PLACED)
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		const tomas = await seatPlayer(w, "Tomas")
		await setWorldPlace(w, "the Tavern")
		await setOwnPlace(w, mira, "the Cellar")
		await setOwnPlace(w, bram, "the Tavern")
		await setOwnPlace(w, tomas, "the Roof")
		const first = await say(w, mira, "Mira calls up the stairs.")
		await say(w, bram, "Bram pours.")
		await say(w, tomas, "I shout down.")
		const scene = await open(w, first)
		expect(await participantsOf(scene.id)).toEqual([bram.member.id])
	})

	test("a member with no own place is listed; a place is compared as words", async () => {
		const w = await world(PLACED)
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		await setWorldPlace(w, "the Tavern")
		await setOwnPlace(w, bram, "  The  tavern ")
		const first = await say(w, mira, "Mira looks up.")
		await say(w, bram, "Bram pours.")
		const scene = await open(w, first)
		expect(sorted(await participantsOf(scene.id))).toEqual(
			membersOf(mira, bram)
		)
	})

	test("a genre that declares no place key lists a member whose place differs", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		await setWorldPlace(w, "the Tavern")
		await setOwnPlace(w, mira, "the Cellar")
		const first = await say(w, mira, "Mira looks up.")
		const scene = await open(w, first)
		expect(await participantsOf(scene.id)).toEqual([mira.member.id])
	})

	test("a member who spoke once elsewhere and once in the scene's place is listed", async () => {
		const w = await world(PLACED)
		const mira = await seatCharacter(w, "Mira")
		await setWorldPlace(w, "the Tavern")
		await setOwnPlace(w, mira, "the Cellar")
		const first = await say(w, mira, "Mira calls from below.")
		await setOwnPlace(w, mira, "the Tavern")
		await say(w, mira, "Mira comes up.")
		const scene = await open(w, first)
		expect(await participantsOf(scene.id)).toEqual([mira.member.id])
	})

	test("the scene's place is read as of each line, not as it stands now", async () => {
		const w = await world(PLACED)
		const mira = await seatCharacter(w, "Mira")
		await setOwnPlace(w, mira, "the Cellar")
		await setWorldPlace(w, "the Tavern")
		const first = await say(w, mira, "Mira calls from below.")
		await setWorldPlace(w, "the Cellar")
		const scene = await open(w, first)
		expect(await participantsOf(scene.id)).toEqual([])
		await setWorldPlace(w, "the Roof")
		const { readCastProposal } = await import(
			"$lib/server/scenes/liveScenes"
		)
		expect((await readCastProposal(db(), scene))!.participants).toEqual([])
	})
})

describe("each live write", () => {
	test("refresh adds a new speaker, never a silent seat, and a line by one already in writes nothing", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		await seatCharacter(w, "Pell")
		const first = await say(w, mira, "Mira looks up.")
		const scene = await open(w, first)
		expect(await participantsOf(scene.id)).toEqual([mira.member.id])
		expect(await refresh(w, await say(w, mira, "Mira again."))).toBe(false)
		expect(await refresh(w, await say(w, bram, "Bram arrives."))).toBe(true)
		expect(sorted(await participantsOf(scene.id))).toEqual(
			membersOf(mira, bram)
		)
		expect(await refresh(w, await say(w, bram, "Bram sits."))).toBe(false)
	})

	test("close lists the speakers of the range it closes at", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		const first = await say(w, mira, "Mira looks up.")
		const second = await say(w, mira, "Mira stands.")
		await say(w, bram, "Bram arrives.")
		const scene = await open(w, first)
		expect(sorted(await participantsOf(scene.id))).toEqual(
			membersOf(mira, bram)
		)
		const { closeScene } = await import("$lib/server/scenes/liveScenes")
		await closeScene(db(), {
			sceneId: scene.id,
			userId: w.user.id,
			atMessageId: second
		})
		expect(await participantsOf(scene.id)).toEqual([mira.member.id])
	})

	test("move: a speaker moved out of the range leaves the cast", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		const first = await say(w, mira, "Mira looks up.")
		const second = await say(w, mira, "Mira stands.")
		const third = await say(w, bram, "Bram arrives.")
		const scene = await open(w, first, third)
		expect(sorted(await participantsOf(scene.id))).toEqual(
			membersOf(mira, bram)
		)
		const { moveSceneBoundary } = await import(
			"$lib/server/scenes/liveScenes"
		)
		await moveSceneBoundary(db(), {
			sceneId: scene.id,
			userId: w.user.id,
			closedAt: second
		})
		expect(await participantsOf(scene.id)).toEqual([mira.member.id])
	})

	test("merge: the joined scene lists the speakers of both", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		await seatCharacter(w, "Pell")
		const a1 = await say(w, mira, "Mira looks up.")
		const a2 = await say(w, mira, "Mira stands.")
		const b1 = await say(w, bram, "Bram arrives.")
		const b2 = await say(w, bram, "Bram sits.")
		const earlier = await open(w, a1, a2)
		const later = await open(w, b1, b2)
		expect(await participantsOf(earlier.id)).toEqual([mira.member.id])
		expect(await participantsOf(later.id)).toEqual([bram.member.id])
		const { mergeScene } = await import("$lib/server/scenes/liveScenes")
		await mergeScene(db(), { sceneId: later.id, userId: w.user.id })
		expect(sorted(await participantsOf(earlier.id))).toEqual(
			membersOf(mira, bram)
		)
	})
})

describe("the latest write of a scene's cast stands", () => {
	test("a hand-written cast on an open scene stands: a listed speaker's line writes nothing, a new speaker is added to it", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		const pell = await seatCharacter(w, "Pell")
		const { writeSceneCast } = await import("$lib/server/utils/sceneCast")
		const first = await say(w, mira, "Mira looks up.")
		const scene = await open(w, first)
		await writeSceneCast(
			scene.id,
			{ participantCharacters: [mira.member.id, pell.member.id] },
			db()
		)
		expect(await refresh(w, await say(w, mira, "Mira again."))).toBe(false)
		expect(await participantsOf(scene.id)).toEqual([mira.member.id, pell.member.id])
		expect(await refresh(w, await say(w, bram, "Bram arrives."))).toBe(true)
		expect(sorted(await participantsOf(scene.id))).toEqual(
			membersOf(mira, bram, pell)
		)
	})

	test("a closed scene's stored cast is untouched by later lines and a later scene's open and refresh", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		const pell = await seatCharacter(w, "Pell")
		const { writeSceneCast } = await import("$lib/server/utils/sceneCast")
		const a1 = await say(w, mira, "Mira looks up.")
		const closed = await open(w, a1, a1)
		await writeSceneCast(
			closed.id,
			{ participantCharacters: [pell.member.id] },
			db()
		)
		const b1 = await say(w, bram, "Bram arrives.")
		const later = await open(w, b1)
		expect(await refresh(w, await say(w, mira, "Mira follows."))).toBe(true)
		expect(sorted(await participantsOf(later.id))).toEqual(
			membersOf(mira, bram)
		)
		expect(await participantsOf(closed.id)).toEqual([pell.member.id])
	})
})

describe("the window", () => {
	test("open and close hold the story clock at their lines", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const first = await say(w, mira, "Mira looks up.")
		const scene = await open(w, first)
		await testDb
			.update(schema.sessions)
			.set({
				storyClockYear: 5,
				storyClockMonth: 2,
				storyClockDay: 3,
				storyClockHour: 11,
				storyClockMinute: 45
			} as any)
			.where(eq(schema.sessions.id, w.session.id))
		const last = await say(w, mira, "Mira leaves.")
		const { closeScene } = await import("$lib/server/scenes/liveScenes")
		await closeScene(db(), {
			sceneId: scene.id,
			userId: w.user.id,
			atMessageId: last
		})
		const [row] = await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, scene.id))
		expect([
			row.openedStoryClockYear,
			row.openedStoryClockMonth,
			row.openedStoryClockDay,
			row.openedStoryClockHour,
			row.openedStoryClockMinute
		]).toEqual([5, 1, 2, 9, 30])
		expect([
			row.closedStoryClockYear,
			row.closedStoryClockMonth,
			row.closedStoryClockDay,
			row.closedStoryClockHour,
			row.closedStoryClockMinute
		]).toEqual([5, 2, 3, 11, 45])
	})
})

/** A narrator line that tags a name: `<name> said, "…"`. */
const tagged = (name: string) => `${name} said, "Quiet now."`

describe("a speech tag in a narrator line counts as having spoken (SC2)", () => {
	test("a member the narrator tags is listed, once, with nothing minted; a name with no member is not", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const bram = await cardlessMember(w, "Bram")
		const first = await say(w, mira, "Mira looks up.")
		await say(w, null, `${tagged("Bram")} ${tagged("Pell")}`)
		await say(w, null, tagged("Bram"))
		const members = await memberCount(w.book.id)
		const scene = await open(w, first)
		expect(sorted(await participantsOf(scene.id))).toEqual(
			sorted([mira.member.id, bram.id])
		)
		expect(await memberCount(w.book.id)).toBe(members)
	})

	test("a name only spoken to, mentioned or quoted lists nobody", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		await cardlessMember(w, "Bram")
		await cardlessMember(w, "Pell")
		await cardlessMember(w, "Grust")
		const first = await say(w, mira, "Mira looks up.")
		await say(w, null, '"Bram, come here," the room seemed to say. Pell nodded slowly.')
		await say(w, null, 'The room hushed. "Grust said nothing of it," came the whisper.')
		const scene = await open(w, first)
		expect(await participantsOf(scene.id)).toEqual([mira.member.id])
	})

	test("a tag in a person's line or a character's own line lists nobody; a hidden narrator line is not read", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const tomas = await seatPlayer(w, "Tomas")
		await cardlessMember(w, "Bram")
		await cardlessMember(w, "Pell")
		await cardlessMember(w, "Grust")
		const first = await say(w, mira, tagged("Bram"))
		await say(w, tomas, tagged("Pell"))
		const hidden = await say(w, null, tagged("Grust"))
		await testDb
			.update(schema.sessionMessages)
			.set({ isHidden: true })
			.where(eq(schema.sessionMessages.id, hidden))
		const scene = await open(w, first)
		expect(sorted(await participantsOf(scene.id))).toEqual(membersOf(mira, tomas))
	})

	test("an untagged assistant line with a stored person speaker is not a narrator line", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		await cardlessMember(w, "Bram")
		const first = await say(w, mira, "Mira looks up.")
		await line(
			w,
			{ metadata: { speaker: "seated-member:999999" } },
			tagged("Bram")
		)
		const scene = await open(w, first)
		expect(await participantsOf(scene.id)).toEqual([mira.member.id])
	})

	test("the place rule keeps a tagged member their place rules out, and spares one with no place", async () => {
		const w = await world(PLACED)
		const mira = await seatCharacter(w, "Mira")
		const bram = await cardlessMember(w, "Bram")
		const pell = await cardlessMember(w, "Pell")
		await setWorldPlace(w, "the Tavern")
		await setOwnPlace(w, mira, "the Tavern")
		await tick()
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "seated_member",
			ownerId: bram.id,
			slotId: LOCATION,
			value: { v: "the Cellar" },
			sessionId: w.session.id,
			updatedBy: "run:test"
		} as any)
		await tick()
		const first = await say(w, mira, "Mira looks up.")
		await say(w, null, `${tagged("Bram")} ${tagged("Pell")}`)
		const scene = await open(w, first)
		expect(sorted(await participantsOf(scene.id))).toEqual(
			sorted([mira.member.id, pell.id])
		)
		expect(bram.id).toBeGreaterThan(0)
	})

	test("a tagged card's player seat owns its place", async () => {
		const w = await world(PLACED)
		const mira = await seatCharacter(w, "Mira")
		const tomas = await seatPlayer(w, "Tomas")
		await setWorldPlace(w, "the Tavern")
		await setOwnPlace(w, mira, "the Tavern")
		await setOwnPlace(w, tomas, "the Cellar")
		const first = await say(w, mira, "Mira looks up.")
		await say(w, null, tagged("Tomas"))
		const scene = await open(w, first)
		expect(await participantsOf(scene.id)).toEqual([mira.member.id])
	})

	test("the proposal keys a tagged member by member, once, also when their own lines list them", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const bram = await cardlessMember(w, "Bram")
		const first = await say(w, mira, "Mira looks up.")
		await say(w, null, `${tagged("Bram")} ${tagged("Mira")}`)
		const scene = await open(w, first)
		const { readCastProposal } = await import("$lib/server/scenes/liveScenes")
		const [row] = await testDb.select().from(schema.scenes).where(eq(schema.scenes.id, scene.id))
		const proposal = (await readCastProposal(db(), row))!
		expect(proposal.participants.map((p) => p.key)).toEqual([
			`character:${mira.card.id}`,
			`cast_member:${bram.id}`
		])
		expect(proposal.participants[1]!.evidenceLabel).toBe("speech-tag@2")
	})

	test("refresh: a narrator line adds a member its tag names once, and writes nothing for a tag already listed", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const bram = await cardlessMember(w, "Bram")
		const first = await say(w, mira, "Mira looks up.")
		const scene = await open(w, first)
		expect(await refresh(w, await say(w, null, "Rain falls."))).toBe(false)
		expect(await refresh(w, await say(w, null, tagged("Bram")))).toBe(true)
		expect(sorted(await participantsOf(scene.id))).toEqual(
			sorted([mira.member.id, bram.id])
		)
		expect(await refresh(w, await say(w, null, tagged("Bram")))).toBe(false)
		expect(await refresh(w, await say(w, null, tagged("Mira")))).toBe(false)
	})

	test("the review seed's rule lists a tagged member", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const bram = await cardlessMember(w, "Bram")
		const first = await say(w, mira, "Mira looks up.")
		await say(w, null, tagged("Bram"))
		const { sceneCastSpeakers, storyLinesInRange } = await import(
			"$lib/server/scenes/liveScenes"
		)
		const lines = await storyLinesInRange(db(), w.session.id, "main", first, null)
		expect(
			[...(await sceneCastSpeakers(
				db(),
				{ sessionId: w.session.id, lorebookId: w.book.id },
				lines
			))].sort()
		).toEqual([`card:${mira.card.id}`, `member:${bram.id}`].sort())
	})

	test("a member the narrator tagged in a closed scene is in that scene for the judgement that follows their later lines", async () => {
		const w = await world(PLAIN)
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		const first = await say(w, mira, "Mira looks up.")
		const last = await say(w, null, tagged("Bram"))
		const scene = await open(w, first)
		const { closeScene } = await import("$lib/server/scenes/liveScenes")
		await closeScene(db(), { sceneId: scene.id, userId: w.user.id, atMessageId: last })
		await say(w, bram, "Bram speaks up.")
		const { loadSessionSceneCasts, speakerInCastViewOf, keptScenesInCast } =
			await import("$lib/server/sessions/speakerInCast")
		const casts = await loadSessionSceneCasts(db(), w.session.id)
		const inCast = [...casts.participants].filter(([, m]) => m.has(bram.member.id)).map(([id]) => id)
		expect(inCast).toEqual([scene.id])
		const view = speakerInCastViewOf({
			memberId: bram.member.id,
			name: "Bram",
			scenes: casts.scenes,
			inCastSceneIds: inCast
		})
		expect(keptScenesInCast(view, [scene.id])).toEqual({ keptIds: [scene.id], leftOut: 0 })
		const other = speakerInCastViewOf({
			memberId: 999999,
			name: "Nobody",
			scenes: casts.scenes,
			inCastSceneIds: []
		})
		expect(keptScenesInCast(other, [scene.id]).leftOut).toBe(1)
	})
})

describe("what a narrator line costs a refresh", () => {
	test("statements per refresh, by kind of line", async () => {
		const w = await world(PLACED)
		const mira = await seatCharacter(w, "Mira")
		const tomas = await seatPlayer(w, "Tomas")
		const grust = await seatCharacter(w, "Grust")
		await setWorldPlace(w, "the Tavern")
		for (const s of [mira, tomas, grust]) await setOwnPlace(w, s, "the Tavern")
		const first = await say(w, mira, "Mira looks up.")
		await open(w, first)
		const person = await statementsOf(w, await say(w, mira, "Mira again."), "location")
		const plain = await statementsOf(w, await say(w, null, "Rain falls on the roof."), "location")
		const noTag = await statementsOf(w, await say(w, null, 'The room hushed. "Quiet."'), "location")
		const listedTag = await statementsOf(w, await say(w, null, tagged("Mira")), "location")
		const newTag = await statementsOf(w, await say(w, null, tagged("Grust")), "location")
		// A person's or a character's line: the scene, the line, the card's member, the stored cast.
		expect(person).toBeLessThanOrEqual(LISTED_CEILING)
		// A narrator line with no quotation reads nothing more.
		expect(plain).toBeLessThanOrEqual(2)
		// With a quotation the name list is read (the one line, no other); no stored cast until a tag names a member.
		expect(noTag).toBeLessThanOrEqual(9)
		expect(listedTag).toBeLessThanOrEqual(11)
		// A new member also pays the place rule a new speaker pays (47 with the caller's place key), and the Edit history row's insert and keep-newest select.
		expect(newTag).toBeLessThanOrEqual(55)
		expect(newTag).toBeGreaterThan(listedTag)
	})
})
