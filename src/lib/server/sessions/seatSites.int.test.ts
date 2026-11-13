/**
 * 🚧 The seat sites that moved onto the one seat writer (plan §27 v2, S1):
 * a branch, a SillyTavern import, and the envoy seatings. Behaviour is what
 * it was; each seat now also carries the cast member it is.
 *
 * Claims: a branch's character seats carry the attached book's member when
 * the session reads a book its owner owns, else the member made in the
 * branch's own book (owner ★B-5, 2026-11-08); a player seat's new id is
 * still the remap (its stat value comes across on it); an envoy seat comes
 * across with no member; an imported solo or group session that reads a world
 * book carries members, a persona included; `seatEnvoy` / `seatDefaultEnvoys` write
 * envoy seats with no member, revive a departed one, and leave a seat that is
 * there as it is.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, eq } from "drizzle-orm"
import encode from "png-chunks-encode"
import extract from "png-chunks-extract"
import text from "png-chunk-text"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { seatCast, seatPlayer } from "./seats"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})
vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	autoEnqueueLorebook: vi.fn(async () => {})
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn(() => {})
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-seat-sites-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb)
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const uniq = (label: string) => `${label}-${++n}`
const asDb = (tx: unknown) => tx as Db
const inTx = <T>(fn: (tx: Db) => Promise<T>) =>
	testDb.transaction(async (tx) => fn(asDb(tx)))

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, uniq("seat-sites"))
}

async function card(userId: number, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "" })
		.returning()
	return row!
}

async function session(
	userId: number,
	extra: Partial<typeof schema.sessions.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: uniq("Run"), ...extra })
		.returning()
	return row!
}

/** A line to fork at (a legacy row and its message row, as the real writer makes). */
async function message(sessionId: number) {
	const [legacy] = await testDb
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "assistant", content: "…" })
		.returning()
	await testDb.insert(schema.messages).values({
		id: legacy!.id,
		sessionId,
		role: "assistant"
	})
	return legacy!
}

const charSeats = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))
		.orderBy(asc(schema.sessionCharacters.position))

const playerSeats = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionPersonas)
		.where(eq(schema.sessionPersonas.sessionId, sessionId))
		.orderBy(asc(schema.sessionPersonas.position))

async function memberRow(id: number) {
	const [row] = await testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.id, id))
	return row!
}

async function branchOf(sessionId: number, fromMessageId: number) {
	const { branchSession } = await import("$lib/server/sessions/branch")
	return branchSession(asDb(testDb), { sessionId, fromMessageId })
}

describe("a branch seats through the one seat writer", () => {
	it("a session reading a book its owner owns: the branch's seats carry that book's members", async () => {
		const u = await user()
		const maren = await card(u.id, "Maren")
		const tess = await card(u.id, "Tess")
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: u.id, name: uniq("Book") })
			.returning()
		const s = await session(u.id, { lorebookId: book!.id })
		await inTx(async (tx) => {
			await seatCast(tx, {
				sessionId: s.id,
				cardId: maren.id,
				position: 0
			})
			await seatCast(tx, {
				sessionId: s.id,
				cardId: tess.id,
				position: 1
			})
		})
		const parent = await charSeats(s.id)
		expect(parent.every((r) => r.castMemberId != null)).toBe(true)
		const fork = await message(s.id)

		const branch = await branchOf(s.id, fork.id)
		const copied = await charSeats(branch.id)
		expect(copied.map((r) => r.characterId)).toEqual([maren.id, tess.id])
		expect(copied.map((r) => r.castMemberId)).toEqual(
			parent.map((r) => r.castMemberId)
		)
		for (const seat of copied)
			expect((await memberRow(seat.castMemberId!)).lorebookId).toBe(
				book!.id
			)
		expect(copied.every((r) => r.mergedInto == null)).toBe(true)
	})

	it("a session with no own book yet: the branch's seat gets its member made in the branch's own book", async () => {
		const u = await user()
		const maren = await card(u.id, "Maren")
		const s = await session(u.id)
		await inTx((tx) =>
			seatCast(tx, { sessionId: s.id, cardId: maren.id, position: 0 })
		)
		const [parentSeat] = await charSeats(s.id)
		expect(parentSeat!.characterId).toBe(maren.id)
		expect(parentSeat!.castMemberId).toBeNull()
		const fork = await message(s.id)

		const branch = await branchOf(s.id, fork.id)
		const [seat] = await charSeats(branch.id)
		expect(seat!.characterId).toBe(maren.id)
		expect(seat!.mergedInto).toBeNull()
		// The own book takes the member (owner ★B-5, 2026-11-08): one, in the branch's own book.
		const found = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.characterId, maren.id))
		expect(found).toHaveLength(1)
		expect(seat!.castMemberId).toBe(found[0]!.id)
		const [bookRow] = await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, found[0]!.lorebookId))
		expect(bookRow!.sessionId).toBe(branch.id)
	})

	it("an envoy seat comes across with no member; a removed seat does not", async () => {
		const u = await user()
		const maren = await card(u.id, "Maren")
		const gone = await card(u.id, "Gone")
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: u.id, name: uniq("Book") })
			.returning()
		const s = await session(u.id, { lorebookId: book!.id })
		await inTx(async (tx) => {
			await seatCast(tx, {
				sessionId: s.id,
				cardId: maren.id,
				position: 0
			})
			await seatCast(tx, {
				sessionId: s.id,
				envoySlug: "keeper",
				position: 1
			})
			await seatCast(tx, {
				sessionId: s.id,
				cardId: gone.id,
				position: 2
			})
		})
		await testDb
			.update(schema.sessionCharacters)
			.set({ removedAt: new Date(), isActive: false })
			.where(
				and(
					eq(schema.sessionCharacters.sessionId, s.id),
					eq(schema.sessionCharacters.characterId, gone.id)
				)
			)
		const fork = await message(s.id)

		const branch = await branchOf(s.id, fork.id)
		const copied = await charSeats(branch.id)
		expect(copied.map((r) => [r.characterId, r.envoySlug])).toEqual([
			[maren.id, null],
			[null, "keeper"]
		])
		expect(copied[0]!.castMemberId).not.toBeNull()
		expect((await memberRow(copied[0]!.castMemberId!)).lorebookId).toBe(
			book!.id
		)
		expect(copied[1]!.castMemberId).toBeNull()
		expect(copied.every((r) => r.removedAt == null)).toBe(true)
	})

	it("player seats: each new id is the remap (a player_seat stat lands on it), members carried, a retired seat stays retired", async () => {
		const u = await user()
		const wren = await card(u.id, "Wren")
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: u.id, name: uniq("Book") })
			.returning()
		const s = await session(u.id, { lorebookId: book!.id })
		const fork = await message(s.id)
		const seatA = await inTx((tx) =>
			seatPlayer(tx, {
				sessionId: s.id,
				personaId: wren.id,
				position: 0,
				userId: u.id
			})
		)
		const [seatB] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: s.id,
				personaId: null,
				userId: u.id,
				seatName: "Drifter",
				position: 1
			})
			.returning()
		const [seatC] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: s.id,
				personaId: null,
				seatName: "Old hand",
				position: 2,
				removedAt: new Date(),
				removedName: "Old hand"
			})
			.returning()
		const put = (ownerId: number, v: number) =>
			testDb.insert(schema.attributeValues).values({
				ownerKind: "player_seat",
				ownerId,
				slotId: "core:slot/hp@1",
				value: { v },
				sessionId: s.id,
				validFromMessageId: fork.id,
				updatedBy: "user"
			})
		await put(seatA.seatId, 7)
		await put(seatB!.id, 9)

		const branch = await branchOf(s.id, fork.id)
		const copied = await playerSeats(branch.id)
		expect(copied).toHaveLength(3)
		expect(copied.map((r) => r.seatName)).toEqual([
			null,
			"Drifter",
			"Old hand"
		])
		expect(copied[0]!.personaId).toBe(wren.id)
		expect(copied[0]!.castMemberId).not.toBeNull()
		expect((await memberRow(copied[0]!.castMemberId!)).lorebookId).toBe(
			book!.id
		)
		expect(copied[1]!.castMemberId).toBeNull()
		expect(copied[2]!.removedAt).not.toBeNull()
		expect(copied[2]!.removedName).toBe("Old hand")
		const ids = new Set([seatA.seatId, seatB!.id, seatC!.id])
		expect(copied.some((r) => ids.has(r.id))).toBe(false)

		const rows = await testDb
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.sessionId, branch.id),
					eq(schema.attributeValues.ownerKind, "player_seat")
				)
			)
		const byOwner = new Map(
			rows.map((r) => [r.ownerId, (r.value as any).v])
		)
		expect(byOwner.get(copied[0]!.id)).toBe(7)
		expect(byOwner.get(copied[1]!.id)).toBe(9)
		expect(rows).toHaveLength(2)
	})
})

// ── The SillyTavern import ─────────────────────────────────────────────────

function pngBytes(): Buffer {
	const png = new PNG({ width: 1, height: 1 })
	png.data.fill(255)
	return PNG.sync.write(png)
}

function cardPng(name: string, data: Record<string, unknown> = {}): Buffer {
	const chunks = extract(pngBytes())
	const body = {
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name,
			description: `${name}.`,
			personality: "",
			scenario: "",
			first_mes: "Hello.",
			mes_example: "",
			creator_notes: "",
			system_prompt: "",
			post_history_instructions: "",
			alternate_greetings: [],
			tags: [],
			creator: "",
			character_version: "",
			extensions: {},
			...data
		}
	}
	chunks.splice(
		chunks.findIndex((c) => c.name === "IEND"),
		0,
		text.encode(
			"chara",
			Buffer.from(JSON.stringify(body)).toString("base64")
		)
	)
	return Buffer.from(encode(chunks))
}

const jsonl = (lines: unknown[]) =>
	lines.map((l) => JSON.stringify(l)).join("\n") + "\n"
const ROOT = "data/default-user"
const noopEmit = () => {}

async function importTree(
	userId: number,
	files: Record<string, string | Buffer>
) {
	const {
		importStartSillyTavernSession,
		importStageSillyTavernFiles,
		importScanSillyTavern,
		importExecuteSillyTavern
	} = await import("$lib/server/sockets/import")
	const socket = { user: { id: userId, isAdmin: true } } as any
	const { importSessionId } = await importStartSillyTavernSession.handler(
		socket,
		{},
		noopEmit
	)
	const manifest: Array<{ relativePath: string; length: number }> = []
	const chunks: Buffer[] = []
	for (const [rel, contents] of Object.entries(files)) {
		const buf = Buffer.from(contents)
		manifest.push({ relativePath: `${ROOT}/${rel}`, length: buf.length })
		chunks.push(buf)
	}
	const staged = await importStageSillyTavernFiles.handler(
		socket,
		{
			importSessionId: importSessionId!,
			manifest,
			blob: Buffer.concat(chunks)
		},
		noopEmit
	)
	expect(staged.success).toBe(true)
	const scan = await importScanSillyTavern.handler(
		socket,
		{
			importSessionId: importSessionId!,
			deferredSessionPaths: Object.keys(files).filter((f) =>
				f.startsWith("chats/")
			)
		},
		noopEmit
	)
	expect(scan.success).toBe(true)
	return importExecuteSillyTavern.handler(
		socket,
		{ importSessionId: importSessionId!, selectedData: scan.data! },
		noopEmit
	)
}

const SETTINGS = JSON.stringify({
	power_user: {
		personas: { "user-default.png": "Jody" },
		persona_descriptions: {
			"user-default.png": { description: "The one asking.", position: 0 }
		}
	}
})

const sessionNamed = (userId: number, name: string) =>
	testDb.query.sessions.findFirst({
		where: (s, { and, eq }) => and(eq(s.userId, userId), eq(s.name, name))
	})

describe("an imported session seats through the one seat writer", () => {
	it("a solo chat that reads a world book: the character seat and the persona's seat carry members of it", async () => {
		const u = await user()
		const result = await importTree(u.id, {
			"settings.json": SETTINGS,
			"worlds/Seats World.json": JSON.stringify({ entries: {} }),
			"User Avatars/user-default.png": pngBytes(),
			"characters/Aria.png": cardPng("Aria"),
			"chats/Aria/Aria - seats.jsonl": jsonl([
				{
					user_name: "Jody",
					character_name: "Aria",
					chat_metadata: { world_info: "Seats World" }
				},
				{
					name: "Aria",
					is_user: false,
					send_date: 1704304800000,
					mes: "Hello."
				},
				{
					name: "Jody",
					is_user: true,
					send_date: 1704304860000,
					mes: "Hi."
				}
			])
		})
		expect(result.errors ?? []).toEqual([])
		const s = await sessionNamed(u.id, "Aria - seats")
		expect(s).toBeTruthy()
		const seats = await charSeats(s!.id)
		expect(seats).toHaveLength(1)
		expect(s!.lorebookId).not.toBeNull()
		expect(seats[0]!.castMemberId).not.toBeNull()
		expect((await memberRow(seats[0]!.castMemberId!)).lorebookId).toBe(
			s!.lorebookId
		)
		const players = await playerSeats(s!.id)
		expect(players).toHaveLength(1)
		expect(players[0]!.castMemberId).not.toBeNull()
		expect(players[0]!.castMemberId).not.toBe(seats[0]!.castMemberId)
	})

	it("a group chat that reads a world book: every member seat carries its own member of it, in order", async () => {
		const u = await user()
		const result = await importTree(u.id, {
			"settings.json": SETTINGS,
			"worlds/Seats World.json": JSON.stringify({ entries: {} }),
			"characters/Aria.png": cardPng("Aria"),
			"characters/Bram.png": cardPng("Bram"),
			"groups/1700000000001.json": JSON.stringify({
				id: "1700000000001",
				name: "Seats Night",
				members: ["Aria.png", "Bram.png"],
				chat_metadata: { world_info: "Seats World" },
				chat_id: "seats-night"
			}),
			"group chats/seats-night.jsonl": jsonl([
				{ user_name: "Jody", chat_metadata: {} },
				{
					name: "Bram",
					is_user: false,
					send_date: 1704304860000,
					mes: "Evening."
				}
			])
		})
		expect(result.errors ?? []).toEqual([])
		const s = await sessionNamed(u.id, "Seats Night")
		expect(s).toBeTruthy()
		const seats = await charSeats(s!.id)
		expect(seats.map((r) => r.position)).toEqual([0, 1])
		expect(
			seats.every((r) => r.castMemberId != null && r.mergedInto == null)
		).toBe(true)
		expect(new Set(seats.map((r) => r.castMemberId)).size).toBe(2)
		expect(s!.lorebookId).not.toBeNull()
		for (const seat of seats)
			expect((await memberRow(seat.castMemberId!)).lorebookId).toBe(
				s!.lorebookId
			)
		const players = await playerSeats(s!.id)
		expect(players.every((r) => r.castMemberId != null)).toBe(true)
	})
})

// ── Envoy seatings ─────────────────────────────────────────────────────────

describe("envoy seatings go through the one seat writer", () => {
	async function guideSession() {
		const u = await user()
		const { GUIDE_GENRE_ID, GUIDE_MASCOT_KEY } = await import(
			"@serene-pub/core-catalog"
		)
		const { declaredEnvoys } = await import(
			"$lib/server/pipelines/entities/envoys"
		)
		const slug = (await declaredEnvoys(asDb(testDb), GUIDE_GENRE_ID)).find(
			(e) => e.key === GUIDE_MASCOT_KEY
		)!.slug
		const s = await session(u.id, { genreId: GUIDE_GENRE_ID })
		return { s, slug, genreId: GUIDE_GENRE_ID }
	}

	const envoySeat = async (sessionId: number, slug: string) =>
		(
			await testDb
				.select()
				.from(schema.sessionCharacters)
				.where(
					and(
						eq(schema.sessionCharacters.sessionId, sessionId),
						eq(schema.sessionCharacters.envoySlug, slug)
					)
				)
		)[0]

	it("seatEnvoy writes an envoy seat with no member, then revives a removed one", async () => {
		const { s, slug } = await guideSession()
		const { seatEnvoy, unseatEnvoy } = await import(
			"$lib/server/pipelines/entities/envoys"
		)
		expect(await seatEnvoy(asDb(testDb), s.id, slug, 3)).toBe(true)
		let seat = await envoySeat(s.id, slug)
		expect(seat).toMatchObject({
			characterId: null,
			castMemberId: null,
			position: 3,
			isActive: true,
			removedAt: null
		})
		// Already live: nothing changes for the caller.
		expect(await seatEnvoy(asDb(testDb), s.id, slug, 3)).toBe(false)

		expect(await unseatEnvoy(asDb(testDb), s.id, slug, "Guide")).toBe(true)
		seat = await envoySeat(s.id, slug)
		expect(seat!.removedAt).not.toBeNull()
		expect(seat!.removedName).toBe("Guide")
		expect(seat!.isActive).toBe(false)

		expect(await seatEnvoy(asDb(testDb), s.id, slug, 1)).toBe(true)
		const revived = await envoySeat(s.id, slug)
		expect(revived).toMatchObject({
			id: seat!.id,
			castMemberId: null,
			position: 1,
			isActive: true,
			removedAt: null,
			removedName: null
		})
	})

	it("seatDefaultEnvoys seats the defaults with no member and keeps a seat that is there", async () => {
		const { s, slug, genreId } = await guideSession()
		const { seatDefaultEnvoys, unseatEnvoy } = await import(
			"$lib/server/pipelines/entities/envoys"
		)
		const seated = await seatDefaultEnvoys(asDb(testDb), s.id, genreId)
		expect(seated).toContain(slug)
		const seat = await envoySeat(s.id, slug)
		expect(seat).toMatchObject({
			characterId: null,
			castMemberId: null,
			isActive: true,
			removedAt: null
		})

		// A seat the person unseated stays unseated: an upgrade must not undo a choice.
		await unseatEnvoy(asDb(testDb), s.id, slug)
		await seatDefaultEnvoys(asDb(testDb), s.id, genreId)
		const after = await envoySeat(s.id, slug)
		expect(after).toMatchObject({ id: seat!.id, isActive: false })
		expect(after!.removedAt).not.toBeNull()
		const all = await charSeats(s.id)
		expect(all.filter((r) => r.envoySlug === slug)).toHaveLength(1)
	})
})
