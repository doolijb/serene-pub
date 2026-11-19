/**
 * 🚧 HM1 (owner, 2026-11-17): a seat holding the session owner's card is the card owner's to change,
 * whoever plays it (`seatSheetHolder` in `state/handEdits.ts`). A card owned by anyone else keeps its
 * person (the player of a player seat, the seater of a character seat).
 * HM2 (owner, 2026-11-17): a card-less seat follows who made its cast member. The person made it:
 * theirs. Someone else made it: the session owner holds it. No maker recorded: the person.
 *
 * The matrix: card (session owner's · guest's · none) × person (session owner · guest) × seat kind
 * (player seat · character seat), and for a card-less seat × maker (guest · owner · none). Only
 * {session owner's card × guest person × both seat kinds} and {card-less × owner-made × guest person
 * × both seat kinds} differ from before: there the guest is no longer "own" and the session owner is.
 * A guest's card with the session owner as person is built as data (no door reaches it) and keeps
 * today's answer.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { defineRuleset, rulesetAttributeSlotId } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { memberFormSwitch } from "$lib/server/state/memberForm"
import { seatSheetHolder } from "$lib/server/state/handEdits"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-hand-card-owner-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const R = "test:ruleset/hand-card-owner@1"
defineRuleset(R, {
	name: { en: "Hand card owner" },
	attributes: [
		{ id: "free", name: { en: "Free" }, kind: "number", prose: "Anyone's." }
	]
})
const FREE = rulesetAttributeSlotId(R, "free")

let n = 0

function fakeSocket(userId: number) {
	return {
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }), sockets: { sockets: new Map() } }
	} as any
}

type CardKind = "owners" | "guests" | "none"
type PersonKind = "owner" | "guest"
type SeatKind = "player" | "character"
/** Who made a card-less seat's cast member (HM2): the person, the other one, or no one recorded. */
type Maker = "guest" | "owner" | "none"

/** One session holding one seat: the cell of the matrix. */
async function cell(
	card: CardKind,
	person: PersonKind,
	seat: SeatKind,
	fields: Record<string, unknown>,
	maker?: Maker
) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const suffix = `${++n}`
	const owner = (await createTestUser(testDb, `hco-owner-${suffix}`))!
	const guest = (await createTestUser(testDb, `hco-guest-${suffix}`))!
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: `HCO ${suffix}`,
			genreId: "core:genre/dungeon-crawler",
			primaryRuleset: R,
			genreFields: fields
		} as any)
		.returning()
	const sessionId = session!.id
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId, userId: guest.id, isPlayer: true } as any)
	const personId = person === "owner" ? owner.id : guest.id
	const cardRow =
		card === "none"
			? null
			: (
					await testDb
						.insert(schema.characters)
						.values({
							userId: card === "owners" ? owner.id : guest.id,
							name: `Card ${suffix}`,
							description: "…"
						} as any)
						.returning()
				)[0]!
	const { eq } = await import("drizzle-orm")
	const makerId =
		maker === "guest" ? guest.id : maker === "owner" ? owner.id : null
	/** A card-less seat's cast member, in a book the session reads. */
	const mintMember = async () => {
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: owner.id, name: `HCO ${suffix}` })
			.returning()
		const { member } = await insertCastMember(testDb, {
			lorebookId: book!.id,
			binding: `{{char:hco${suffix}}}`,
			characterId: null,
			name: "Nobody",
			ownName: "Nobody",
			createdBy: makerId
		})
		await testDb
			.update(schema.sessions)
			.set({ lorebookId: book!.id } as any)
			.where(eq(schema.sessions.id, sessionId))
		return member!
	}
	let target: { kind: any; id: number }
	if (seat === "player") {
		const member = !cardRow && maker ? await mintMember() : null
		const [row] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId,
				personaId: cardRow?.id ?? null,
				userId: personId,
				seatName: cardRow ? null : `Seat ${suffix}`,
				castMemberId: member?.id ?? null
			} as any)
			.returning()
		target = { kind: "player_seat", id: row!.id }
	} else if (cardRow) {
		await testDb.insert(schema.sessionCharacters).values({
			sessionId,
			characterId: cardRow.id,
			seatedByUserId: personId
		} as any)
		target = { kind: "session_cast", id: cardRow.id }
	} else {
		// A card-less character seat is a cast member in member form (S4).
		const member = await mintMember()
		await testDb.insert(schema.sessionCharacters).values({
			sessionId,
			characterId: null,
			envoySlug: null,
			castMemberId: member.id,
			seatedByUserId: personId
		} as any)
		target = { kind: "seated_member", id: member.id }
	}
	return { sessionId, owner, guest, target }
}

async function judgeOf(
	c: Awaited<ReturnType<typeof cell>>,
	userId: number
) {
	const { handEditJudge } = await import("$lib/server/state/handEdits")
	const judge = await handEditJudge(testDb as any, c.sessionId, userId)
	await judge.know(c.target as any)
	return judge
}

async function view(
	card: CardKind,
	person: PersonKind,
	seat: SeatKind,
	fields: Record<string, unknown> = {},
	maker?: Maker
) {
	const memberSeat = seat === "character" && card === "none"
	const was = memberFormSwitch.on
	if (memberSeat) memberFormSwitch.on = true
	try {
		const c = await cell(card, person, seat, fields, maker)
		const ownerJudge = await judgeOf(c, c.owner.id)
		const guestJudge = await judgeOf(c, c.guest.id)
		const refuse = (j: typeof ownerJudge) =>
			j.refusal({ owner: c.target as any, slotId: FREE, act: "set" })
		return {
			c,
			ownerWhose: ownerJudge.whose(c.target as any),
			guestWhose: guestJudge.whose(c.target as any),
			ownerRefusal: refuse(ownerJudge),
			guestRefusal: refuse(guestJudge)
		}
	} finally {
		memberFormSwitch.on = was
	}
}

type Whose = "own" | "other"
/** [owner sees, guest sees] — `*` marks a cell HM1 changed. */
const MATRIX: Array<
	[CardKind, PersonKind, SeatKind, Whose, Whose, boolean]
> = [
	// The session owner's card: HM1 moves it off a guest person (changed: both seat kinds).
	["owners", "guest", "player", "own", "other", true],
	["owners", "guest", "character", "own", "other", true],
	["owners", "owner", "player", "own", "other", false],
	["owners", "owner", "character", "own", "other", false],
	// The guest's own card: its person's (the owner sees a guest-played seat as the guest's; a character seat nobody plays is the owner's).
	["guests", "guest", "player", "other", "own", false],
	["guests", "guest", "character", "own", "own", false],
	["guests", "owner", "player", "own", "other", false],
	["guests", "owner", "character", "own", "other", false],
	// Card-less, no member or no maker recorded: its person's.
	["none", "guest", "player", "other", "own", false],
	["none", "guest", "character", "own", "own", false],
	["none", "owner", "player", "own", "other", false],
	["none", "owner", "character", "own", "other", false]
]

/** [person, seat kind, maker, owner sees, guest sees, HM2 row]: card-less seats with a cast member. */
const HM2_MATRIX: Array<[PersonKind, SeatKind, Maker, Whose, Whose, boolean]> = [
	// The person made it (a seat they named, their shared-card copy): theirs.
	["guest", "player", "guest", "other", "own", false],
	["guest", "character", "guest", "own", "own", false],
	// No maker recorded: today's rule, the person.
	["guest", "player", "none", "other", "own", false],
	["guest", "character", "none", "own", "own", false],
	// The owner made it for a guest: the session owner holds it (HM2).
	["guest", "player", "owner", "own", "other", true],
	["guest", "character", "owner", "own", "other", true],
	// The session owner as person: theirs whoever made it.
	["owner", "player", "owner", "own", "other", false],
	["owner", "character", "owner", "own", "other", false],
	["owner", "player", "guest", "own", "other", false],
	["owner", "character", "guest", "own", "other", false]
]

describe("HM2: whose a card-less seat is, by who made its cast member", () => {
	for (const [person, seat, maker, ownerSees, guestSees, changed] of HM2_MATRIX) {
		test(`${person} person · ${seat} seat · made by ${maker}${changed ? " (HM2 row)" : ""}`, async () => {
			for (const level of ["as-ruled", "no-edits"] as const) {
				const v = await view("none", person, seat, { playerSheetLatitude: level }, maker)
				expect(v.ownerWhose).toBe(ownerSees)
				expect(v.guestWhose).toBe(guestSees)
				expect(v.ownerRefusal).toBeNull()
				if (level === "as-ruled")
					expect(v.guestRefusal?.cause ?? null).toBe(
						guestSees === "own" ? null : "not-theirs"
					)
				else expect(v.guestRefusal?.cause).toBe("no-edits")
			}
		})
	}

	test("the new sentence goes to the guest on a seat the owner made for them, on both seat kinds", async () => {
		for (const seat of ["player", "character"] as const) {
			const v = await view(
				"none",
				"guest",
				seat,
				{ playerSheetLatitude: "as-ruled" },
				"owner"
			)
			expect(v.guestRefusal?.sentence).toMatch(
				seat === "player"
					? /^Seat \d+ is not a seat you made, so only the session's owner changes its sheet\.$/
					: /^Nobody is not a seat you made, so only the session's owner changes its sheet\.$/
			)
		}
	})

		test("a model's proposal for a seat the owner made for a guest waits for the session owner; one the guest made, for the guest", async () => {
		const { proposeChange, decideProposal } = await import("$lib/server/state/write")
		const c = await cell("none", "guest", "player", { playerSheetLatitude: "all-own" }, "owner")
		const one = await proposeChange(
			testDb as any,
			{ sessionId: c.sessionId, updatedBy: "run:test" },
			{ owner: c.target, slotId: FREE, value: 4 } as any
		)
		await expect(
			decideProposal(testDb as any, one, true, c.guest.id)
		).rejects.toThrow(/is not a seat you made, so only the session's owner changes its sheet/)
		expect((await decideProposal(testDb as any, one, true, c.owner.id)).status).toBe("accepted")
		const g = await cell("none", "guest", "player", { playerSheetLatitude: "all-own" }, "guest")
		const two = await proposeChange(
			testDb as any,
			{ sessionId: g.sessionId, updatedBy: "run:test" },
			{ owner: g.target, slotId: FREE, value: 4 } as any
		)
		expect((await decideProposal(testDb as any, two, true, g.guest.id)).status).toBe("accepted")
	}, 60_000)

	test("a model's proposal for a card-less character seat: the session owner and the guest handed it decide; another guest does not", async () => {
		const { proposeChange, decideProposal } = await import("$lib/server/state/write")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const propose = (c: Awaited<ReturnType<typeof cell>>) =>
			proposeChange(
				testDb as any,
				{ sessionId: c.sessionId, updatedBy: "run:test" },
				{ owner: c.target, slotId: FREE, value: 4 } as any
			)
		const stranger = (await createTestUser(testDb, `hco-stranger-${++n}`))!
		// Made by the owner, handed to the guest: the session owner's to decide.
		const a = await cell("none", "guest", "character", { playerSheetLatitude: "all-own" }, "owner")
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: a.sessionId, userId: stranger.id, isPlayer: true } as any)
		const one = await propose(a)
		await expect(decideProposal(testDb as any, one, true, a.guest.id)).rejects.toThrow(
			/only the session's owner changes its sheet/
		)
		await expect(decideProposal(testDb as any, one, true, stranger.id)).rejects.toThrow()
		expect((await decideProposal(testDb as any, one, true, a.owner.id)).status).toBe("accepted")
		// Made by the guest: the guest's.
		const b = await cell("none", "guest", "character", { playerSheetLatitude: "all-own" }, "guest")
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: b.sessionId, userId: stranger.id, isPlayer: true } as any)
		const two = await propose(b)
		await expect(decideProposal(testDb as any, two, true, stranger.id)).rejects.toThrow()
		expect((await decideProposal(testDb as any, two, true, b.guest.id)).status).toBe("accepted")
	}, 60_000)

	test("seatSheetHolder: a card-less seat follows its member's maker", () => {
		const q = { cardOwnerId: null, personId: 2, sessionOwnerId: 1 }
		expect(seatSheetHolder({ ...q, memberCreatorId: 2 })).toBe(2)
		expect(seatSheetHolder({ ...q, memberCreatorId: 1 })).toBe(1)
		expect(seatSheetHolder({ ...q, memberCreatorId: 3 })).toBe(1)
		expect(seatSheetHolder({ ...q, memberCreatorId: null })).toBe(2)
		expect(seatSheetHolder(q)).toBe(2)
		// A carded seat keeps HM1 whatever the input says.
		expect(
			seatSheetHolder({ cardOwnerId: 3, personId: 2, sessionOwnerId: 1, memberCreatorId: 1 })
		).toBe(2)
		expect(
			seatSheetHolder({ cardOwnerId: 1, personId: 2, sessionOwnerId: 1, memberCreatorId: 2 })
		).toBe(1)
	})
})

describe("HM1: whose a seat is, by card owner and person", () => {
	for (const [card, person, seat, ownerSees, guestSees, changed] of MATRIX) {
		test(`${card} card · ${person} person · ${seat} seat${changed ? " (HM1 row)" : ""}`, async () => {
			for (const level of ["as-ruled", "no-edits"] as const) {
				const v = await view(card, person, seat, {
					playerSheetLatitude: level
				})
				expect(v.ownerWhose).toBe(ownerSees)
				expect(v.guestWhose).toBe(guestSees)
				// The owner's level is the default: the owner sets a free stat anywhere they are the game master.
				expect(v.ownerRefusal).toBeNull()
				if (level === "as-ruled")
					expect(v.guestRefusal?.cause ?? null).toBe(
						guestSees === "own" ? null : "not-theirs"
					)
				else expect(v.guestRefusal?.cause).toBe("no-edits")
			}
		})
	}

	test("the new sentence goes to the guest who plays the session owner's card, on both seat kinds", async () => {
		for (const seat of ["player", "character"] as const) {
			const v = await view("owners", "guest", seat, {
				playerSheetLatitude: "as-ruled"
			})
			expect(v.guestRefusal?.sentence).toMatch(
				/^Card \d+ is the session owner's card, so only they change its sheet\.$/
			)
		}
	})

	test("a refusal elsewhere keeps its words (a card-less seat of the session owner read by a guest)", async () => {
		const v = await view("none", "owner", "player", {
			playerSheetLatitude: "as-ruled"
		})
		expect(v.guestRefusal?.sentence).toMatch(
			/^only Seat \d+'s player or the session's owner can change their sheet\.$/
		)
	})

	test("state:get: the owner's-card seat is editable for the owner, not for the guest who plays it; a card-less seat stays the guest's", async () => {
		const { stateGet } = await import("$lib/server/sockets/state")
		const rowFor = async (
			c: Awaited<ReturnType<typeof cell>>,
			userId: number
		) => {
			const state = (await stateGet.handler(
				fakeSocket(userId),
				{ sessionId: c.sessionId } as any,
				(() => {}) as any
			)) as any
			return state.owners.find(
				(o: any) => o.kind === c.target.kind && o.id === c.target.id
			)
		}
		for (const [card, ownerEdits, guestEdits] of [
			["owners", true, false],
			["none", true, true]
		] as const) {
			const c = await cell(card, "guest", "player", {
				playerSheetLatitude: "all-own"
			})
			const guestRow = await rowFor(c, c.guest.id)
			const ownerRow = await rowFor(c, c.owner.id)
			expect(guestRow, card).toBeTruthy()
			expect(guestRow.editable, `${card} guest`).toBe(guestEdits)
			expect(ownerRow.editable, `${card} owner`).toBe(ownerEdits)
			if (!guestEdits) expect(guestRow.handLocked?.[FREE]).toMatch(/session owner's card/)
		}
	})

	test("a model's proposal for the sheet of the owner's card a guest plays waits for the session owner (assertSeatDecider follows HM1)", async () => {
		const { proposeChange, decideProposal } = await import("$lib/server/state/write")
		const c = await cell("owners", "guest", "player", {
			playerSheetLatitude: "all-own"
		})
		const held = async () =>
			proposeChange(
				testDb as any,
				{ sessionId: c.sessionId, updatedBy: "run:test" },
				{ owner: c.target, slotId: FREE, value: 4 } as any
			)
		const one = await held()
		await expect(
			decideProposal(testDb as any, one, true, c.guest.id)
		).rejects.toThrow(/session owner's card, so only they change its sheet/)
		expect((await decideProposal(testDb as any, one, true, c.owner.id)).status).toBe("accepted")
		// A card-less seat the guest plays stays the guest's to decide.
		const g = await cell("none", "guest", "player", {
			playerSheetLatitude: "all-own"
		})
		const two = await proposeChange(
			testDb as any,
			{ sessionId: g.sessionId, updatedBy: "run:test" },
			{ owner: g.target, slotId: FREE, value: 4 } as any
		)
		expect((await decideProposal(testDb as any, two, true, g.guest.id)).status).toBe("accepted")
	}, 60_000)

	test("seatSheetHolder: the session owner's card is theirs; else the person's", () => {
		expect(
			seatSheetHolder({ cardOwnerId: 1, personId: 2, sessionOwnerId: 1 })
		).toBe(1)
		expect(
			seatSheetHolder({ cardOwnerId: 3, personId: 2, sessionOwnerId: 1 })
		).toBe(2)
		expect(
			seatSheetHolder({ cardOwnerId: null, personId: 2, sessionOwnerId: 1 })
		).toBe(2)
		expect(
			seatSheetHolder({ cardOwnerId: null, personId: null, sessionOwnerId: null })
		).toBeNull()
	})
})
