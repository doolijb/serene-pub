/**
 * 🚧 The owner opens their persona for a guest (owner rulings PS1, S1, S2,
 * 2026-11-17): the person of a player seat is its `user_id`, so the guest
 * speaks as the owner's card in that seat and gains nothing over the card
 * elsewhere. Every refusal is a sentence and writes nothing.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import {
	PLAYER_SEATS_FOR_REFUSALS as F,
	SEAT_HANDOVER_REFUSALS as R
} from "$lib/server/sessions/guestSeats"
import { memberFormSwitch } from "$lib/server/state/memberForm"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

/** A hook run between `playerSeatsFor`'s check and its write. */
const hooks = vi.hoisted(() => ({
	afterCheck: null as null | (() => Promise<void>)
}))
vi.mock("$lib/server/sessions/guestSeats", async (importOriginal) => {
	const real = await importOriginal<typeof import("$lib/server/sessions/guestSeats")>()
	return {
		...real,
		resolvePlayerSeatsFor: async (...args: Parameters<typeof real.resolvePlayerSeatsFor>) => {
			const out = await real.resolvePlayerSeatsFor(...args)
			await hooks.afterCheck?.()
			return out
		}
	}
})

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return {
		...testDbModule(await createTestDb()),
		getCryptoSecretKey: () => "owner-card-guest-test-secret"
	}
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {},
	autoEnqueueCharacter: async () => {}
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn(() => {})
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

let n = 0

/** A reply is never asked for here: only the send's own half runs. */
vi.mock("../utils/runReply", () => ({ runReply: async () => ({ ok: true }) }))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-ownercardguest-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
	// Evaluated whole before any send reaches it through a dynamic import.
	await import("$lib/server/pipelines/config/variableLayoutsView")
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const socket = (userId: number) =>
	({
		id: `s-${userId}`,
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

const user = async (label: string) => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `${label}-${++n}`)
}

const card = async (userId: number, name: string) =>
	(
		await testDb
			.insert(schema.characters)
			.values({ userId, name, description: "" })
			.returning()
	)[0]!

const NOT_YOURS = "You can only send messages with personas you own."

async function table() {
	const owner = await user("oc-owner")
	const g1 = await user("oc-g1")
	const g2 = await user("oc-g2")
	const w = await user("oc-w")
	const outsider = await user("oc-out")
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true } as any)
		.returning()
	const sessionId = session!.id
	await testDb.insert(schema.sessionGuests).values([
		{ sessionId, userId: g1.id, isPlayer: true },
		{ sessionId, userId: g2.id, isPlayer: true },
		{ sessionId, userId: w.id, isPlayer: false }
	])
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `Notes ${++n}`, sessionId } as any)
		.returning()
	return { owner, g1, g2, w, outsider, sessionId, bookId: book!.id }
}

const seatRows = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionPersonas)
		.where(eq(schema.sessionPersonas.sessionId, sessionId))
		.orderBy(asc(schema.sessionPersonas.id))

async function update(
	userId: number,
	sessionId: number,
	body: Record<string, unknown>
) {
	const { sessionsUpdateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	let error: string | null = null
	try {
		await sessionsUpdateHandler.handler(
			socket(userId),
			{ session: { id: sessionId }, ...body } as any,
			() => {}
		)
	} catch (e) {
		error = e instanceof Error ? e.message : String(e)
	}
	return { error }
}

/** An update that must be refused with `sentence`, leaving every seat as it was. */
async function refused(
	userId: number,
	sessionId: number,
	body: Record<string, unknown>,
	sentence: string
) {
	const before = JSON.stringify(await seatRows(sessionId))
	const { error } = await update(userId, sessionId, body)
	expect(error).toBe(sentence)
	expect(JSON.stringify(await seatRows(sessionId))).toBe(before)
}

async function send(
	userId: number,
	sessionId: number,
	personaId: number,
	content = "A line."
) {
	const { sessionMessagesSendPersonaMessageHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	return (await sessionMessagesSendPersonaMessageHandler.handler(
		socket(userId),
		{ sessionId, personaId, content } as any,
		() => {}
	)) as Sockets.SessionMessages.SendPersonaMessage.Response
}

const memberRow = async (lorebookId: number, name: string, characterId: number | null = null) =>
	(
		await insertCastMember(
			testDb as any,
			{
				lorebookId,
				characterId,
				binding: `{{char:${++n}}}`,
				name
			} as any
		)
	).member

/** The owner's card seated for G1; returns the card and the seat row. */
async function ownerCardForG1(t: Awaited<ReturnType<typeof table>>, name = "Ownercard") {
	const c = await card(t.owner.id, name)
	const { error } = await update(t.owner.id, t.sessionId, {
		playerSeatsFor: [{ characterId: c.id, toUserId: t.g1.id }]
	})
	expect(error).toBeNull()
	const seat = (await seatRows(t.sessionId)).find((r) => r.personaId === c.id)!
	return { card: c, seat }
}

describe("the owner opens their card for a guest", () => {
	test("1. a persona seated linked: the card, its member, the guest as its person", async () => {
		const t = await table()
		const { card: c, seat } = await ownerCardForG1(t)
		expect(seat).toMatchObject({ personaId: c.id, userId: t.g1.id, removedAt: null })
		expect(seat.castMemberId).not.toBeNull()
	})

	test("2. the guest sends as the card; the owner is refused with it", async () => {
		const t = await table()
		const { card: c } = await ownerCardForG1(t)
		const res = await send(t.g1.id, t.sessionId, c.id)
		expect(res.refused).toBeUndefined()
		expect(res.sessionMessage?.personaId).toBe(c.id)
		const [row] = await testDb
			.select({ personaId: schema.sessionMessages.personaId })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, res.sessionMessage!.id))
		expect(row!.personaId).toBe(c.id)

		const refusal = await send(t.owner.id, t.sessionId, c.id)
		expect(refusal.refused).toContain(NOT_YOURS)
		// The host's own door (a run's person line) holds the same rule.
		const { offerMessage } = await import("$lib/server/sessions/offerMessage")
		const offered = await offerMessage(testDb as any, {
			sessionId: t.sessionId,
			userId: t.owner.id,
			speaker: `character:${c.id}`,
			channel: "main",
			text: "Mine?",
			trayItemIds: [],
			replyTo: null,
			io: socket(t.owner.id).io
		} as any)
		expect(JSON.stringify(offered)).toContain(NOT_YOURS)
	})

	test("3. who.user and the turn order read the guest as the seat's person", async () => {
		const t = await table()
		const { card: c, seat } = await ownerCardForG1(t)
		const wasOn = memberFormSwitch.on
		memberFormSwitch.on = false
		try {
			const { stateFor } = await import("$lib/server/state/resolve")
			const asGuest = await stateFor(testDb as any, t.sessionId, { userId: t.g1.id })
			expect(asGuest.who.user).toBeTruthy()
			expect(JSON.stringify(asGuest.who.user)).toContain(String(c.id))
			const asOther = await stateFor(testDb as any, t.sessionId, { userId: t.g2.id })
			expect(asOther.who.user).toBeFalsy()
		} finally {
			memberFormSwitch.on = wasOn
		}
		const [row] = await testDb
			.select({
				persona: { id: schema.characters.id, name: schema.characters.name, userId: schema.characters.userId },
				seatUserId: schema.sessionPersonas.userId
			})
			.from(schema.sessionPersonas)
			.innerJoin(schema.characters, eq(schema.characters.id, schema.sessionPersonas.personaId))
			.where(eq(schema.sessionPersonas.id, seat.id))
		const { coreBindings } = await import("$lib/server/pipelines/runtime/bindings")
		const out = await (coreBindings() as any)["core:task/turn-pool@1"]({
			cast: {
				sessionCharacters: [],
				sessionPersonas: [
					{ position: 0, removedAt: null, enabled: true, persona: row!.persona, seatId: seat.id, seatName: null, seatUserId: row!.seatUserId }
				],
				envoys: []
			},
			messages: []
		})
		const entries = out.value.main.filter((e: any) => e.kind === "persona")
		expect(entries).toHaveLength(1)
		expect(entries[0].ownerUserId).toBe(t.g1.id)
	})

	test("4. the guest edits and re-runs their own line; the owner may not edit it", async () => {
		const t = await table()
		const { card: c } = await ownerCardForG1(t)
		const sent = await send(t.g1.id, t.sessionId, c.id)
		const id = sent.sessionMessage!.id
		const { canActOnMessage } = await import("$lib/server/messages/permissions")
		expect(await canActOnMessage(testDb as any, id, t.g1.id, "rerun")).toBe(true)
		expect(await canActOnMessage(testDb as any, id, t.owner.id, "change")).toBe(false)
		const { sessionMessagesUpdateHandler } = await import("$lib/server/sockets/sessions")
		const res: any = await sessionMessagesUpdateHandler.handler(
			socket(t.g1.id),
			{ id, content: "Edited." } as any,
			() => {}
		)
		expect(res.error).toBeUndefined()
		const [row] = await testDb
			.select({ content: schema.sessionMessages.content })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, id))
		expect(row!.content).toBe("Edited.")
	})

	test("5. the guest gains nothing over the card elsewhere", async () => {
		const t = await table()
		const { card: c } = await ownerCardForG1(t, "Guarded")
		const { charactersUpdate } = await import("$lib/server/sockets/characters")
		let threw = false
		try {
			await charactersUpdate.handler(
				socket(t.g1.id),
				{ character: { id: c.id, name: "Hacked" } } as any,
				() => {}
			)
		} catch {
			threw = true
		}
		const [lib] = await testDb
			.select({ name: schema.characters.name, userId: schema.characters.userId })
			.from(schema.characters)
			.where(eq(schema.characters.id, c.id))
		expect(lib).toEqual({ name: "Guarded", userId: t.owner.id })
		expect(threw).toBe(true)

		// A second session of the owner: the card is the owner's own persona.
		const [s2] = await testDb
			.insert(schema.sessions)
			.values({ userId: t.owner.id, isGroup: true } as any)
			.returning()
		await testDb.insert(schema.sessionGuests).values({ sessionId: s2!.id, userId: t.g1.id, isPlayer: true })
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: s2!.id,
			personaId: c.id,
			userId: t.owner.id,
			position: 0
		})
		expect((await send(t.g1.id, s2!.id, c.id)).refused).toContain(NOT_YOURS)
		expect((await send(t.owner.id, s2!.id, c.id)).refused).toBeUndefined()
	})

	test("6. a guest cannot add or reassign the owner's card to themselves", async () => {
		const t = await table()
		const c = await card(t.owner.id, "Takeable")
		const { sessionsAddPersonaHandler } = await import("$lib/server/sockets/sessions")
		const add: any = await sessionsAddPersonaHandler.handler(
			socket(t.g1.id),
			{ sessionId: t.sessionId, personaId: c.id } as any,
			() => {}
		)
		expect(add.success).toBe(false)
		expect(add.error).toBe("Access denied. You can only add personas you own.")
		// A removed seat of the guest's own card, swapped to the owner's card.
		const own = await card(t.g1.id, "Gown")
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: t.sessionId,
			personaId: own.id,
			userId: t.g1.id,
			removedAt: new Date(),
			position: 0
		})
		const { sessionsReassignRemovedParticipantHandler } = await import(
			"$lib/server/sockets/sessions.participants"
		)
		const re: any = await sessionsReassignRemovedParticipantHandler.handler(
			socket(t.g1.id),
			{ sessionId: t.sessionId, type: "persona", oldId: own.id, newId: c.id } as any,
			() => {}
		)
		expect(re.error).toBe("Access denied. You can only reassign to a persona you own.")
	})

	test("7. handed back to the owner and to the guest again; a guest's card stays", async () => {
		const t = await table()
		const { card: c, seat } = await ownerCardForG1(t)
		let e = await update(t.owner.id, t.sessionId, {
			seatHandovers: [{ playerSeatId: seat.id, toUserId: t.owner.id }]
		})
		expect(e.error).toBeNull()
		expect((await send(t.owner.id, t.sessionId, c.id)).refused).toBeUndefined()
		expect((await send(t.g1.id, t.sessionId, c.id)).refused).toContain(NOT_YOURS)
		e = await update(t.owner.id, t.sessionId, {
			seatHandovers: [{ playerSeatId: seat.id, toUserId: t.g1.id }]
		})
		expect(e.error).toBeNull()
		expect((await send(t.g1.id, t.sessionId, c.id)).refused).toBeUndefined()
		expect((await send(t.owner.id, t.sessionId, c.id)).refused).toContain(NOT_YOURS)

		const gc = await card(t.g1.id, "Guestcard")
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: t.sessionId,
			personaId: gc.id,
			userId: t.g1.id,
			position: 5
		})
		const [gseat] = (await seatRows(t.sessionId)).filter((r) => r.personaId === gc.id)
		await refused(
			t.owner.id,
			t.sessionId,
			{ seatHandovers: [{ playerSeatId: gseat!.id, toUserId: t.g2.id }] },
			R.cardedPlayerSeat("Guestcard")
		)
	})
})

describe("what the owner may open, and what refuses", () => {
	test("8. each refusal writes nothing", async () => {
		const t = await table()
		const mine = await card(t.owner.id, "Mine")
		const theirs = await card(t.g1.id, "Theirs")
		await refused(
			t.g1.id,
			t.sessionId,
			{ playerSeatsFor: [{ characterId: mine.id, toUserId: t.g1.id }] },
			R.ownerOnly
		)
		await refused(
			t.owner.id,
			t.sessionId,
			{ playerSeatsFor: [{ characterId: mine.id, toUserId: t.outsider.id }] },
			R.notInSession
		)
		await refused(
			t.owner.id,
			t.sessionId,
			{ playerSeatsFor: [{ characterId: mine.id, toUserId: t.w.id }] },
			R.watcher(t.w.displayName?.trim() || t.w.username)
		)
		await refused(
			t.owner.id,
			t.sessionId,
			{ playerSeatsFor: [{ characterId: theirs.id, toUserId: t.g1.id }] },
			F.notYourCard("Theirs")
		)
		await refused(
			t.owner.id,
			t.sessionId,
			{ playerSeatsFor: [{ seatName: "   ", toUserId: t.g1.id }] },
			F.blankName
		)
		await refused(
			t.owner.id,
			t.sessionId,
			{ playerSeatsFor: [{ characterId: mine.id, seatName: "Both", toUserId: t.g1.id }] },
			F.oneKey
		)
		// A card a live seat already holds.
		await update(t.owner.id, t.sessionId, {
			playerSeatsFor: [{ characterId: mine.id, toUserId: t.g1.id }]
		})
		await refused(
			t.owner.id,
			t.sessionId,
			{ playerSeatsFor: [{ characterId: mine.id, toUserId: t.g2.id }] },
			F.alreadySeated("Mine")
		)
	})

	test("9. a card-less member and a named seat open card-less seats", async () => {
		const t = await table()
		const m = await memberRow(t.bookId, "Mira")
		let e = await update(t.owner.id, t.sessionId, {
			playerSeatsFor: [{ castMemberId: m.id, toUserId: t.g1.id }]
		})
		expect(e.error).toBeNull()
		const [seat] = await seatRows(t.sessionId)
		expect(seat).toMatchObject({
			personaId: null,
			castMemberId: m.id,
			seatName: "Mira",
			userId: t.g1.id
		})
		// G1 already has a seat: a named seat is a NEW one.
		e = await update(t.owner.id, t.sessionId, {
			playerSeatsFor: [{ seatName: "Thorn", toUserId: t.g1.id }]
		})
		expect(e.error).toBeNull()
		const rows = await seatRows(t.sessionId)
		expect(rows).toHaveLength(2)
		expect(rows[0]!.seatName).toBe("Mira")
		expect(rows[1]).toMatchObject({ seatName: "Thorn", userId: t.g1.id, personaId: null })
	})

	test("10. a removed seat of the owner's card is revived for the guest, same row", async () => {
		const t = await table()
		const c = await card(t.owner.id, "Revived")
		await update(t.owner.id, t.sessionId, { personaIds: [c.id] })
		const [first] = await seatRows(t.sessionId)
		// Added through the persona list by its owner: the row names the owner.
		expect(first!.userId).toBe(t.owner.id)
		await testDb
			.update(schema.sessionPersonas)
			.set({ removedAt: new Date(), removedName: "Revived" })
			.where(eq(schema.sessionPersonas.id, first!.id))
		const { error } = await update(t.owner.id, t.sessionId, {
			playerSeatsFor: [{ characterId: c.id, toUserId: t.g1.id }]
		})
		expect(error).toBeNull()
		const rows = await seatRows(t.sessionId)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ id: first!.id, removedAt: null, userId: t.g1.id })
	})

	test("11. a second identical save is refused and changes nothing", async () => {
		const t = await table()
		const { card: c } = await ownerCardForG1(t)
		await refused(
			t.owner.id,
			t.sessionId,
			{ playerSeatsFor: [{ characterId: c.id, toUserId: t.g1.id }] },
			F.alreadySeated("Ownercard")
		)
	})
})

/** The readers of a seat's person (scope-review fix): the guest on the owner's card yes, others no; unchanged elsewhere. */
describe("the person of a carded player seat, at every reader", () => {
	const withMemberForm = async (on: boolean, f: () => Promise<void>) => {
		const was = memberFormSwitch.on
		memberFormSwitch.on = on
		try {
			await f()
		} finally {
			memberFormSwitch.on = was
		}
	}
	const guestOwnCard = async (t: Awaited<ReturnType<typeof table>>) => {
		const gc = await card(t.g2.id, "G2card")
		await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId: t.sessionId, personaId: gc.id, userId: t.g2.id, position: 5 })
		return gc
	}

	test("12. portrayals: the card's person, in both forms; ownPresence follows", async () => {
		const t = await table()
		const { card: c, seat } = await ownerCardForG1(t)
		const gc = await guestOwnCard(t)
		const oc = await card(t.owner.id, "Heldbyowner")
		await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId: t.sessionId, personaId: oc.id, position: 7 })
		const { resolvePortrayals, ownPresence } = await import(
			"$lib/server/pipelines/runtime/portrayals"
		)
		const ask = (refs: string[]) =>
			resolvePortrayals(testDb as any, {
				sessionId: t.sessionId,
				runOwnerUserId: t.owner.id,
				refs: refs as any
			}) as Promise<Record<string, any>>
		await withMemberForm(false, async () => {
			const p = await ask([`character:${c.id}`, `character:${gc.id}`, `character:${oc.id}`])
			expect(p[`character:${c.id}`]).toMatchObject({ by: "person", userId: String(t.g1.id) })
			expect(p[`character:${gc.id}`]).toMatchObject({ by: "person", userId: String(t.g2.id) })
			expect(p[`character:${oc.id}`]).toMatchObject({ by: "person", userId: String(t.owner.id) })
		})
		await withMemberForm(true, async () => {
			const p = await ask([`player-seat:${seat.id}`])
			expect(p[`player-seat:${seat.id}`]).toMatchObject({ by: "person", userId: String(t.g1.id) })
		})
		expect(await ownPresence(testDb as any, t.sessionId, t.g1.id)).toBe(c.id)
		expect(await ownPresence(testDb as any, t.sessionId, t.g2.id)).toBe(gc.id)
		expect(await ownPresence(testDb as any, t.sessionId, t.owner.id)).toBe(oc.id)
		// The owner with no card of their own seated has no presence: the guest holds theirs.
		const t2 = await table()
		const held = await ownerCardForG1(t2)
		expect(await ownPresence(testDb as any, t2.sessionId, t2.owner.id)).toBeNull()
		expect(await ownPresence(testDb as any, t2.sessionId, t2.g1.id)).toBe(held.card.id)
	})

	test("13. earshot, private channels and your-move go to the guest who plays the card", async () => {
		const t = await table()
		const { card: c } = await ownerCardForG1(t)
		await withMemberForm(false, async () => {
			const { hearingOf, hears } = await import("$lib/server/state/earshot")
			const cast = [{ characterId: c.id }]
			expect(hears(await hearingOf(testDb as any, t.sessionId, t.g1.id, cast), c.id)).toBe(true)
			expect(hears(await hearingOf(testDb as any, t.sessionId, t.g2.id, cast), c.id)).toBe(false)

			const { audienceHiddenSlugsFor } = await import("$lib/server/channels/lanes")
			const shape = {
				channels: [{ slug: "phone", audience: { participants: [`character:${c.id}`] } }]
			}
			const hiddenFor = (uid: number) =>
				audienceHiddenSlugsFor(testDb as any, t.sessionId, shape, uid, uid === t.owner.id)
			expect([...(await hiddenFor(t.g1.id))]).toEqual([])
			expect([...(await hiddenFor(t.g2.id))]).toEqual(["phone"])

			const { dueUserOf } = await import("$lib/server/notifications/yourMove")
			const { EMPTY_TURN_ORDER } = await import("@serene-pub/sdk")
			await testDb
				.update(schema.sessions)
				.set({
					turnOrder: {
						...EMPTY_TURN_ORDER,
						order: [{ ref: `character:${c.id}`, via: "strategy" }],
						basedOnAt: Date.now(),
						computedAt: Date.now(),
						strategy: "core:task/turn-round-robin@1"
					}
				} as any)
				.where(eq(schema.sessions.id, t.sessionId))
			expect((await dueUserOf(testDb as any, t.sessionId)).userId).toBe(t.g1.id)
		})
	})

	test("14. a guest's own card and an owner-held card keep their person in the lanes and the order", async () => {
		const t = await table()
		const gc = await guestOwnCard(t)
		const oc = await card(t.owner.id, "Mine")
		await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId: t.sessionId, personaId: oc.id, position: 7 })
		await withMemberForm(false, async () => {
			const { audienceHiddenSlugsFor } = await import("$lib/server/channels/lanes")
			const shape = (id: number) => ({
				channels: [{ slug: "phone", audience: { participants: [`character:${id}`] } }]
			})
			const hidden = async (id: number, uid: number) => [
				...(await audienceHiddenSlugsFor(testDb as any, t.sessionId, shape(id), uid, false))
			]
			expect(await hidden(gc.id, t.g2.id)).toEqual([])
			expect(await hidden(gc.id, t.g1.id)).toEqual(["phone"])
			expect(await hidden(oc.id, t.owner.id)).toEqual([])
			expect(await hidden(oc.id, t.g1.id)).toEqual(["phone"])
		})
	})

	test("15. the turn rotation names the seat's person", async () => {
		const { rotationPersonas } = await import("$lib/server/pipelines/runtime/speakerRotation")
		const persona = (userId: number) => ({ id: 9, userId, name: "C" }) as any
		const seats = (seatUserId: number | null) =>
			rotationPersonas({
				sessionPersonas: [{ persona: persona(1), seatUserId, removedAt: null, isActive: true }]
			} as any)
		expect(seats(2)[0]).toMatchObject({ personaId: 9, ownerUserId: 2 })
		expect(seats(null)[0]).toMatchObject({ personaId: 9, ownerUserId: 1 })
	})

	test("16. who.owner is the owner's own persona, never the guest's character", async () => {
		const t = await table()
		const { card: c } = await ownerCardForG1(t)
		await withMemberForm(false, async () => {
			const { stateFor } = await import("$lib/server/state/resolve")
			const alone = await stateFor(testDb as any, t.sessionId, { userId: t.owner.id })
			expect(alone.who.owner).toBeFalsy()
			const own = await card(t.owner.id, "Ownercard2")
			await testDb
				.insert(schema.sessionPersonas)
				.values({ sessionId: t.sessionId, personaId: own.id, position: 9 })
			const both = await stateFor(testDb as any, t.sessionId, { userId: t.owner.id })
			expect(JSON.stringify(both.who.owner)).toContain(String(own.id))
			expect(JSON.stringify(both.who.owner)).not.toContain(`"${c.id}"`)
		})
	})
})

describe("the owner is never locked out of their own card", () => {
	test("17. a removed seat, or a person who left, hands the card back; the guest's own card is untouched", async () => {
		const { maySpeakAsCard } = await import("$lib/server/sessions/seats")
		const t = await table()
		const { card: c, seat } = await ownerCardForG1(t)
		const may = (uid: number) =>
			maySpeakAsCard(testDb as any, { sessionId: t.sessionId, cardId: c.id, userId: uid })
		expect([await may(t.g1.id), await may(t.owner.id)]).toEqual([true, false])
		await testDb
			.delete(schema.sessionGuests)
			.where(eq(schema.sessionGuests.userId, t.g1.id))
		expect([await may(t.g1.id), await may(t.owner.id)]).toEqual([false, true])
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: t.sessionId, userId: t.g1.id, isPlayer: true })
		expect(await may(t.owner.id)).toBe(false)
		await testDb
			.update(schema.sessionPersonas)
			.set({ removedAt: new Date() })
			.where(eq(schema.sessionPersonas.id, seat.id))
		expect([await may(t.g1.id), await may(t.owner.id)]).toEqual([false, true])
	})

	test("18. removing the guest hands their seat on the owner's card back; their own card's seat stays", async () => {
		const t = await table()
		const { card: c, seat } = await ownerCardForG1(t)
		const gc = await card(t.g1.id, "G1own")
		const [own] = await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId: t.sessionId, personaId: gc.id, userId: t.g1.id, position: 4 })
			.returning()
		const { sessionsRemoveGuestHandler } = await import("$lib/server/sockets/sessions")
		const res = (await sessionsRemoveGuestHandler.handler(
			socket(t.owner.id),
			{ sessionId: t.sessionId, guestUserId: t.g1.id } as any,
			() => {}
		)) as any
		expect(res.success).toBe(true)
		const rows = await seatRows(t.sessionId)
		expect(rows.find((r) => r.id === seat.id)!.userId).toBe(t.owner.id)
		expect(rows.find((r) => r.id === own!.id)!.userId).toBe(t.g1.id)
		expect((await send(t.owner.id, t.sessionId, c.id)).refused).toBeUndefined()
	})

	test("19. a seat removed and added again by the owner is the owner's", async () => {
		const t = await table()
		const { card: c, seat } = await ownerCardForG1(t)
		await testDb
			.update(schema.sessionPersonas)
			.set({ removedAt: new Date(), removedName: "Ownercard" })
			.where(eq(schema.sessionPersonas.id, seat.id))
		const { error } = await update(t.owner.id, t.sessionId, { personaIds: [c.id] })
		expect(error).toBeNull()
		const rows = await seatRows(t.sessionId)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ id: seat.id, removedAt: null, userId: t.owner.id })
		expect((await send(t.owner.id, t.sessionId, c.id)).refused).toBeUndefined()
		expect((await send(t.g1.id, t.sessionId, c.id)).refused).toContain(NOT_YOURS)
	})
})

describe("the write inside the transaction guards what the check saw", () => {
	test("20. a row made live between the check and the write refuses with alreadySeated and rolls the save back", async () => {
		const t = await table()
		const c = await card(t.owner.id, "Racecard")
		await update(t.owner.id, t.sessionId, { personaIds: [c.id] })
		const [first] = await seatRows(t.sessionId)
		await testDb
			.update(schema.sessionPersonas)
			.set({ removedAt: new Date(), removedName: "Racecard" })
			.where(eq(schema.sessionPersonas.id, first!.id))
		const other = await card(t.owner.id, "Companion")
		hooks.afterCheck = async () => {
			await testDb
				.update(schema.sessionPersonas)
				.set({ removedAt: null, userId: t.g2.id })
				.where(eq(schema.sessionPersonas.id, first!.id))
			hooks.afterCheck = null
		}
		const { error } = await update(t.owner.id, t.sessionId, {
			playerSeatsFor: [
				{ characterId: other.id, toUserId: t.g1.id },
				{ characterId: c.id, toUserId: t.g1.id }
			]
		})
		hooks.afterCheck = null
		expect(error).toBe(F.alreadySeated("Racecard"))
		const rows = await seatRows(t.sessionId)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ removedAt: null, userId: t.g2.id })
	})
})
