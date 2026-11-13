/**
 * 🚧 The state read fills the seat's identity (plan §27, S3): every
 * `state.cast.byId` entry and every `session_cast` / `player_seat` owner row
 * of `session-state@1` carries `ref` and `castMemberId`; the entries carry
 * `cardId` too. Keys stay as they were (`byId[<cardId>]`,
 * `byId["player_seat:<id>"]`), and refs stay the card form until S4.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { memberFormSwitch } from "$lib/server/state/memberForm"
import type { TestDb } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { insertDatedCardVersion } from "$lib/server/pipelines/testing/fixtures"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-state-seatident-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

const switchWas = memberFormSwitch.on
afterEach(() => {
	memberFormSwitch.on = switchWas
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) =>
	({
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }), sockets: { sockets: new Map() } }
	}) as any

let n = 0

async function stateGet(userId: number, sessionId: number) {
	const { stateGet } = await import("./state")
	const emitted: Array<{ event: string; data: any }> = []
	const res: any = await (stateGet as any).handler(
		fakeSocket(userId),
		{ sessionId },
		(event: string, data: any) => emitted.push({ event, data })
	)
	const refused = emitted.find((e) => e.event.endsWith(":error"))
	if (refused) throw new Error(refused.data.error)
	return res
}

async function table() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `seatident-${++n}`)
	const card = async (name: string) =>
		(
			await testDb
				.insert(schema.characters)
				.values({ userId: owner.id, name, description: "…" })
				.returning()
		)[0]!
	const held = await card(`Maren ${n}`)
	const younger = await card(`Maren, younger ${n}`)
	const pia = await card(`Pia ${n}`)
	const [bk] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `Book ${n}` } as any)
		.returning()
	const mk = async (characterId: number | null) =>
		(
			await insertCastMember(testDb, {
				lorebookId: bk!.id,
				characterId,
				binding: `{{char:${++n}}}`,
				name: "member"
			} as any)
		).member
	const m = await mk(held.id)
	const pm = await mk(pia.id)
	await insertDatedCardVersion(testDb, m.id, younger.id, 1)
	const [s] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: `Run ${n}`,
			lorebookId: bk!.id,
			storyClockYear: 5
		} as any)
		.returning()
	const sessionId = s!.id
	await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId: held.id, castMemberId: m.id } as any)
	const [carded] = await testDb
		.insert(schema.sessionPersonas)
		.values({
			sessionId,
			userId: owner.id,
			personaId: pia.id,
			castMemberId: pm.id,
			position: 1
		} as any)
		.returning()
	const [cardless] = await testDb
		.insert(schema.sessionPersonas)
		.values({
			sessionId,
			userId: owner.id,
			personaId: null,
			seatName: "Wren",
			position: 2
		} as any)
		.returning()
	return {
		owner,
		sessionId,
		held,
		younger,
		pia,
		m,
		pm,
		carded: carded!,
		cardless: cardless!
	}
}

describe("state:get fills the seat's identity", () => {
	test("state.cast.byId entries carry ref, castMemberId and cardId; keys are unchanged (switch off)", async () => {
		memberFormSwitch.on = false
		const t = await table()
		const { state } = await stateGet(t.owner.id, t.sessionId)
		const byId = state.cast.byId
		expect(Object.keys(byId).sort()).toEqual(
			[
				String(t.held.id),
				String(t.pia.id),
				`player_seat:${t.cardless.id}`
			].sort()
		)
		// The dated active card is not the held card: cardId is the dated card, ref the held one.
		expect(byId[String(t.held.id)]).toMatchObject({
			ref: `character:${t.held.id}`,
			castMemberId: t.m.id,
			cardId: t.younger.id
		})
		// A carded player seat is its card.
		expect(byId[String(t.pia.id)]).toMatchObject({
			ref: `character:${t.pia.id}`,
			castMemberId: t.pm.id,
			cardId: t.pia.id
		})
		// A card-less player seat with no member.
		expect(byId[`player_seat:${t.cardless.id}`]).toMatchObject({
			ref: `player-seat:${t.cardless.id}`,
			castMemberId: null,
			cardId: null
		})
	})

	test("session_cast and player_seat owner rows carry ref and castMemberId (switch off)", async () => {
		memberFormSwitch.on = false
		const t = await table()
		const { owners } = await stateGet(t.owner.id, t.sessionId)
		const castOwner = owners.find(
			(o: any) => o.kind === "session_cast" && o.id === t.held.id
		)
		expect(castOwner).toMatchObject({
			ref: `character:${t.held.id}`,
			castMemberId: t.m.id
		})
		const cardedOwner = owners.find(
			(o: any) => o.kind === "session_cast" && o.id === t.pia.id
		)
		expect(cardedOwner).toMatchObject({
			ref: `character:${t.pia.id}`,
			castMemberId: t.pm.id
		})
		const seatOwner = owners.find(
			(o: any) => o.kind === "player_seat" && o.id === t.cardless.id
		)
		expect(seatOwner).toMatchObject({
			ref: `player-seat:${t.cardless.id}`,
			castMemberId: null
		})
		// The world owner carries neither.
		const world = owners.find((o: any) => o.kind === "session")
		expect(world.ref).toBeUndefined()
		expect(world.castMemberId).toBeUndefined()
	})

	test("switch on: entries are keyed and referenced in member form, each carrying castMemberId and cardId", async () => {
		memberFormSwitch.on = true
		const t = await table()
		const { state } = await stateGet(t.owner.id, t.sessionId)
		const byId = state.cast.byId
		expect(Object.keys(byId).sort()).toEqual(
			[
				`seated_member:${t.m.id}`,
				`player_seat:${t.carded.id}`,
				`player_seat:${t.cardless.id}`
			].sort()
		)
		// The dated active card is not the held card: cardId is the dated card.
		expect(byId[`seated_member:${t.m.id}`]).toMatchObject({
			ref: `seated-member:${t.m.id}`,
			castMemberId: t.m.id,
			cardId: t.younger.id
		})
		// A carded player seat is a player seat now, still naming its card.
		expect(byId[`player_seat:${t.carded.id}`]).toMatchObject({
			ref: `player-seat:${t.carded.id}`,
			castMemberId: t.pm.id,
			cardId: t.pia.id
		})
		expect(byId[`player_seat:${t.cardless.id}`]).toMatchObject({
			ref: `player-seat:${t.cardless.id}`,
			castMemberId: null,
			cardId: null
		})
	})

	test("switch on: seated_member and player_seat owner rows carry ref and castMemberId", async () => {
		memberFormSwitch.on = true
		const t = await table()
		const { owners } = await stateGet(t.owner.id, t.sessionId)
		expect(
			owners.find((o: any) => o.kind === "seated_member" && o.id === t.m.id)
		).toMatchObject({
			ref: `seated-member:${t.m.id}`,
			castMemberId: t.m.id
		})
		expect(
			owners.find(
				(o: any) => o.kind === "player_seat" && o.id === t.carded.id
			)
		).toMatchObject({
			ref: `player-seat:${t.carded.id}`,
			castMemberId: t.pm.id
		})
		expect(
			owners.find(
				(o: any) => o.kind === "player_seat" && o.id === t.cardless.id
			)
		).toMatchObject({
			ref: `player-seat:${t.cardless.id}`,
			castMemberId: null
		})
		const world = owners.find((o: any) => o.kind === "session")
		expect(world.ref).toBeUndefined()
		expect(world.castMemberId).toBeUndefined()
	})
})
