/**
 * 🚧 The one hand-edit decider (`state/handEdits.ts`, lane ed, plan §25 B and D) — over the real sockets
 * (`state:set`, `state:configure`, `state:givePiece`, `state:decide`, `state:get`) and the decider itself.
 *
 * What is pinned: the roles (owner · player · watcher); whose a target is; each sheet level and the
 * `changedBy` it does or does not set aside; a per-stat lock (`people` beats every player level, `all`
 * beats everyone); an unheard value; a configure by a player; Story's owner at `all-any` on a rules-only
 * stat; the Crawler's players (no hand edits, their own items); a give as two sides (an offer the receiver
 * accepts, a drop at a place); and what `state:get` says of it all (`handLocked`, `editable`).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineRuleset, rulesetAttributeSlotId } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { memberFormOn, memberFormSwitch } from "$lib/server/state/memberForm"

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
		path.join(os.tmpdir(), "serene-pub-vitest-hand-edits-")
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

// ── fixtures ────────────────────────────────────────────────────────────────

const CRAWLER = "core:genre/dungeon-crawler"
const STORY = "core:genre/story"
const VIS_ITINERIS = "core:ruleset/vis-itineris@1"
const HP = "core:slot/hp@1"
const INVENTORY = "core:slot/inventory@1"
/** The Crawler's carried things: a piece list on the cast (the Crawler tracks no `inventory`). */
const CONSUMABLES = "core:slot/crawl-consumables@1"
const WHISPER = "core:slot/whisper@1"

/** A ruleset of four marks: the holder's, the rules and the game master's, the rules' alone, nobody's. */
const R = "test:ruleset/hand-edits@1"
defineRuleset(R, {
	name: { en: "Hand edits" },
	attributes: [
		{
			id: "name-tag",
			name: { en: "Name tag" },
			kind: "label",
			changedBy: ["holder"],
			prose: "What they go by."
		},
		{
			id: "score",
			name: { en: "Score" },
			kind: "number",
			changedBy: ["rules", "gm"],
			prose: "The score."
		},
		{
			id: "sealed",
			name: { en: "Sealed" },
			kind: "number",
			changedBy: ["rules"],
			prose: "The rules' alone."
		},
		{ id: "free", name: { en: "Free" }, kind: "number", prose: "Anyone's." }
	]
})
const TAG = rulesetAttributeSlotId(R, "name-tag")
const SCORE = rulesetAttributeSlotId(R, "score")
const SEALED = rulesetAttributeSlotId(R, "sealed")
const FREE = rulesetAttributeSlotId(R, "free")

const WORLD_SENTENCE =
	"The world, its places and the people nobody plays are the session owner's to change."
const NO_EDITS =
	"Players don't edit sheets by hand in this session. The session owner can change that in the session's settings, under Players."
const NO_MOVES =
	"Players don't move items by hand in this session. The session owner can change that in the session's settings, under Players."

let n = 0

function fakeSocket(userId: number) {
	return {
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }), sockets: { sockets: new Map() } }
	} as any
}

type Fixture = Awaited<ReturnType<typeof table>>

/**
 * A table: the session's owner (with a card-less seat, Ann), two playing guests (Cara, with a card, and Bo, with a
 * card-less seat), a watcher, and a character nobody plays. `fields` are the session's stored genre fields.
 */
async function table(
	opts: {
		genreId?: string
		ruleset?: string
		fields?: Record<string, unknown>
		presetSettings?: Record<string, unknown>
	} = {}
) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const suffix = `${++n}`
	const owner = (await createTestUser(testDb, `hand-owner-${suffix}`))!
	const cara = (await createTestUser(testDb, `hand-cara-${suffix}`))!
	const bo = (await createTestUser(testDb, `hand-bo-${suffix}`))!
	const watcher = (await createTestUser(testDb, `hand-watcher-${suffix}`))!
	const stranger = (await createTestUser(testDb, `hand-stranger-${suffix}`))!
	const card = async (userId: number, name: string) =>
		(
			await testDb
				.insert(schema.characters)
				.values({ userId, name, description: "…" } as any)
				.returning()
		)[0]!
	const caraCard = await card(cara.id, "Cara")
	const npc = await card(owner.id, "Gideon")
	let presetId: number | null = null
	if (opts.presetSettings) {
		const [preset] = await testDb
			.insert(schema.sessionPresets)
			.values({
				name: `hand preset ${suffix}`,
				genreId: opts.genreId ?? CRAWLER,
				settings: opts.presetSettings
			} as any)
			.returning()
		presetId = preset!.id
	}
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: `Hands ${suffix}`,
			genreId: opts.genreId ?? CRAWLER,
			primaryRuleset: opts.ruleset ?? R,
			genreFields: opts.fields ?? {},
			presetId
		} as any)
		.returning()
	const sessionId = session!.id
	await testDb.insert(schema.sessionGuests).values([
		{ sessionId, userId: cara.id, isPlayer: true },
		{ sessionId, userId: bo.id, isPlayer: true },
		{ sessionId, userId: watcher.id, isPlayer: false }
	] as any)
	await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId: npc.id } as any)
	const seat = async (
		personaId: number | null,
		userId: number,
		seatName: string | null
	) =>
		(
			await testDb
				.insert(schema.sessionPersonas)
				.values({ sessionId, personaId, userId, seatName } as any)
				.returning()
		)[0]!.id
	const ann = await seat(null, owner.id, "Ann")
	const boSeat = await seat(null, bo.id, "Bo")
	const caraSeatId = await seat(caraCard.id, cara.id, null)
	return {
		sessionId,
		owner,
		cara,
		bo,
		watcher,
		stranger,
		// The owners a hand edit is about.
		world: { kind: "session" as const, id: sessionId },
		place: { kind: "session_location" as const, id: 987_000 + n },
		npc: { kind: "session_cast" as const, id: npc.id },
		// A carded player seat's owner: its card until the flip, its seat once seats are stored in member form (`memberForm.ts`).
		caraSeat: memberFormOn()
			? { kind: "player_seat" as const, id: caraSeatId }
			: { kind: "session_cast" as const, id: caraCard.id },
		boSeat: { kind: "player_seat" as const, id: boSeat },
		annSeat: { kind: "player_seat" as const, id: ann }
	}
}

async function ask(
	t: Fixture,
	userId: number,
	owner: { kind: any; id: number },
	slotId: string,
	act: "set" | "configure" | "take-from" | "put-on" = "set",
	lock?: boolean
) {
	const { handEditRefusal } = await import("$lib/server/state/handEdits")
	return handEditRefusal(testDb as any, {
		sessionId: t.sessionId,
		userId,
		owner,
		slotId,
		act,
		...(lock !== undefined ? { lock } : {})
	})
}

const setLevel = async (t: Fixture, fields: Record<string, unknown>) => {
	const [row] = await testDb
		.select({ genreFields: schema.sessions.genreFields })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, t.sessionId))
	await testDb
		.update(schema.sessions)
		.set({
			genreFields: { ...((row?.genreFields as object) ?? {}), ...fields }
		} as any)
		.where(eq(schema.sessions.id, t.sessionId))
}

/** Lock a stat as the run would have it filed (a configuration row), without a person's hand. */
async function lockStat(
	t: Fixture,
	owner: { kind: any; id: number },
	slotId: string,
	lock: "people" | "all"
) {
	const { configure } = await import("$lib/server/state/write")
	await configure(
		testDb as any,
		{ sessionId: t.sessionId, updatedBy: "run:test" },
		{ owner, slotId, config: { lock } as any }
	)
}

/** A `state:*` handler as `userId`: the sentence it refused with, or null when it answered. */
async function viaSocket(
	name: "stateSet" | "stateConfigure" | "stateGivePiece" | "stateDecide",
	userId: number,
	params: any
) {
	const handlers = await import("$lib/server/sockets/state")
	let refused: string | null = null
	const res = await (handlers[name] as any)
		.handler(fakeSocket(userId), params, (event: string, data: any) => {
			if (event.endsWith(":error")) refused = data.error
		})
		.catch(() => undefined)
	return { refused: refused as string | null, res }
}

async function stateOf(t: Fixture, userId: number) {
	const { stateGet } = await import("$lib/server/sockets/state")
	return (await stateGet.handler(
		fakeSocket(userId),
		{ sessionId: t.sessionId } as any,
		(() => {}) as any
	)) as any
}

const valueAt = async (
	t: Fixture,
	owner: { kind: any; id: number },
	slotId: string
) => {
	const { valueOf } = await import("$lib/server/state/resolve")
	return (await valueOf(testDb as any, {
		sessionId: t.sessionId,
		owner,
		slotId
	})) as any
}

/** Put things on a sheet as the run would (no person's hand). */
async function stock(
	t: Fixture,
	owner: { kind: any; id: number },
	items: string[]
) {
	const { setValue } = await import("$lib/server/state/write")
	await setValue(
		testDb as any,
		{ sessionId: t.sessionId, updatedBy: "run:test" },
		{ owner, slotId: INVENTORY, value: items as any }
	)
}

// ── roles and whose ─────────────────────────────────────────────────────────

describe("who the person is, and whose the target is", () => {
	test("a watcher (a guest who does not play, or no one) never changes anything", async () => {
		const t = await table({ fields: { playerSheetLatitude: "all-any" } })
		for (const who of [t.watcher.id, t.stranger.id]) {
			for (const act of [
				"set",
				"configure",
				"take-from",
				"put-on"
			] as const) {
				const refused = await ask(t, who, t.world, FREE, act)
				expect(refused?.cause, `${who} ${act}`).toBe("watching")
				expect(refused?.sentence).toBe(
					"You're watching this session; only its players and owner change sheets."
				)
			}
		}
	})

	test("the owner changes the world, a place, the people nobody plays and any seat — and configures", async () => {
		const t = await table()
		for (const owner of [
			t.world,
			t.place,
			t.npc,
			t.boSeat,
			t.annSeat,
			t.caraSeat
		])
			expect(
				await ask(t, t.owner.id, owner, FREE),
				JSON.stringify(owner)
			).toBeNull()
		expect(
			await ask(t, t.owner.id, t.boSeat, FREE, "configure", false)
		).toBeNull()
	})

	test("a player on their own sheet is 'own' (a card they own, a card-less seat of theirs); on anyone else's, 'other'", async () => {
		const t = await table({ fields: { playerSheetLatitude: "as-ruled" } })
		expect(await ask(t, t.cara.id, t.caraSeat, FREE)).toBeNull()
		expect(await ask(t, t.bo.id, t.boSeat, FREE)).toBeNull()
		// Another player's seat, in the words of today's refusal.
		expect((await ask(t, t.cara.id, t.boSeat, FREE))?.sentence).toBe(
			"only Bo's player or the session's owner can change their sheet."
		)
		expect((await ask(t, t.bo.id, t.caraSeat, FREE))?.sentence).toBe(
			"only Cara's player or the session's owner can change their sheet."
		)
		expect((await ask(t, t.bo.id, t.annSeat, FREE))?.cause).toBe(
			"not-theirs"
		)
		// The world, its places and the people nobody plays are the owner's.
		for (const owner of [t.world, t.place, t.npc]) {
			const refused = await ask(t, t.bo.id, owner, FREE)
			expect(refused?.cause).toBe("not-theirs")
			expect(refused?.sentence).toBe(WORLD_SENTENCE)
		}
	})
})

// ── sheet levels and changedBy ──────────────────────────────────────────────

describe("the player's sheet latitude", () => {
	test("the Crawler's players start at no-edits (exposed): refused in the session's words", async () => {
		const t = await table()
		const refused = await ask(t, t.cara.id, t.caraSeat, FREE)
		expect(refused).toEqual({ cause: "no-edits", sentence: NO_EDITS })
		// The owner's level is pinned at all-any (★ed-2, owner 2026-11-05: the host can always fix a mistake by
		// hand): the rules' alone stat is theirs to change. (Was: pinned as-ruled, refused with the rules' words.)
		expect(await ask(t, t.owner.id, t.caraSeat, SEALED)).toBeNull()
	})

	test("as-ruled: changedBy decides — the holder's, the game master's and the rules'", async () => {
		const t = await table({ fields: { playerSheetLatitude: "as-ruled" } })
		expect(await ask(t, t.cara.id, t.caraSeat, TAG)).toBeNull()
		expect(await ask(t, t.cara.id, t.caraSeat, FREE)).toBeNull()
		for (const slot of [SCORE, SEALED]) {
			const refused = await ask(t, t.cara.id, t.caraSeat, slot)
			expect(refused?.cause).toBe("changed-by")
			expect(refused?.sentence).toMatch(
				/^Only the game master or the rules change /
			)
		}
		// The owner is the game master: it may change what the holder may, and what the game master may; in the
		// Crawler (owner pinned all-any since ★ed-2, 2026-11-05) the rules' alone stat too.
		expect(await ask(t, t.owner.id, t.caraSeat, TAG)).toBeNull()
		expect(await ask(t, t.owner.id, t.caraSeat, SCORE)).toBeNull()
		expect(await ask(t, t.owner.id, t.caraSeat, SEALED)).toBeNull()
	})

	test("a live seat's character is its player's, whoever owns the card (scope review 2026-11-05)", async () => {
		const t = await table({ fields: { playerSheetLatitude: "all-own" } })
		// Bo owns a card that Cara plays on a seat of her own.
		const [boCard] = await testDb
			.insert(schema.characters)
			.values({ userId: t.bo.id, name: "Dee", description: "…" } as any)
			.returning()
		await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId: t.sessionId, personaId: boCard!.id, userId: t.cara.id, seatName: null } as any)
		const deeSeat = { kind: "session_cast" as const, id: boCard!.id }
		expect(await ask(t, t.cara.id, deeSeat, SEALED)).toBeNull()
		expect((await ask(t, t.bo.id, deeSeat, SEALED))?.cause).toBe("not-theirs")
	})

	test("all-own sets changedBy aside on their own characters only; all-any on anyone's, the world and places too", async () => {
		const t = await table({ fields: { playerSheetLatitude: "all-own" } })
		expect(await ask(t, t.cara.id, t.caraSeat, SEALED)).toBeNull()
		expect((await ask(t, t.cara.id, t.boSeat, SEALED))?.cause).toBe(
			"not-theirs"
		)
		expect((await ask(t, t.cara.id, t.world, SEALED))?.cause).toBe(
			"not-theirs"
		)
		await setLevel(t, { playerSheetLatitude: "all-any" })
		for (const owner of [
			t.caraSeat,
			t.boSeat,
			t.annSeat,
			t.npc,
			t.world,
			t.place
		])
			expect(
				await ask(t, t.cara.id, owner, SEALED),
				JSON.stringify(owner)
			).toBeNull()
	})

	test("an owner pinned at all-any can edit a Vis Itineris stat marked for the rules by hand again", async () => {
		// The pin is the preset layer here (`presetSettings`): the genre layer's own pin is the next test.
		const t = await table({
			genreId: STORY,
			ruleset: VIS_ITINERIS,
			presetSettings: { ownerSheetLatitude: "all-any" }
		})
		expect(await ask(t, t.owner.id, t.annSeat, HP)).toBeNull()
		// Through the socket: the write lands.
		const set = await viaSocket("stateSet", t.owner.id, {
			sessionId: t.sessionId,
			owner: t.annSeat,
			slotId: HP,
			value: 7
		})
		expect(set.refused).toBeNull()
		expect(await valueAt(t, t.annSeat, HP)).toBe(7)
		// Story exposes nothing to its players: they sit at the default, as-ruled — rules-only stays the rules'.
		expect((await ask(t, t.cara.id, t.caraSeat, HP))?.cause).toBe(
			"changed-by"
		)
	})

	// A core genre's own `settings` pin (Story and Lair: owner `all-any`) is carried by its create spec's
	// `meta.genre` (`core-catalog/src/genres/*/create.ts`; lead, ed B1 2026-11-05), so the host reads it off
	// the spec row.
	test(
		"Story's own pin (owner all-any) reaches the cascade: the owner edits a rules-only stat",
		async () => {
			const t = await table({ genreId: STORY, ruleset: VIS_ITINERIS })
			expect(await ask(t, t.owner.id, t.annSeat, HP)).toBeNull()
		}
	)

	test("a level the genre pins reads 'in this genre' where the session's owner cannot change it", async () => {
		const t = await table({
			genreId: STORY,
			presetSettings: {
				playerSheetLatitude: "no-edits",
				playerItemMoves: "no-moves"
			}
		})
		expect(await ask(t, t.cara.id, t.caraSeat, FREE)).toEqual({
			cause: "no-edits",
			sentence: "Players don't edit sheets by hand in this genre."
		})
		expect(
			await ask(t, t.cara.id, t.caraSeat, INVENTORY, "take-from")
		).toEqual({
			cause: "no-moves",
			sentence: "Players don't move items by hand in this genre."
		})
	})
})

// ── locks and earshot ───────────────────────────────────────────────────────

describe("a per-stat lock, and what a person does not hear", () => {
	test("people beats every player level; the owner passes it; all beats everyone", async () => {
		const t = await table({ fields: { playerSheetLatitude: "all-any" } })
		await lockStat(t, t.caraSeat, FREE, "people")
		expect(await ask(t, t.cara.id, t.caraSeat, FREE)).toEqual({
			cause: "locked",
			sentence: "This stat is locked."
		})
		expect(await ask(t, t.owner.id, t.caraSeat, FREE)).toBeNull()
		await lockStat(t, t.caraSeat, FREE, "all")
		expect((await ask(t, t.cara.id, t.caraSeat, FREE))?.cause).toBe(
			"locked"
		)
		expect((await ask(t, t.owner.id, t.caraSeat, FREE))?.cause).toBe(
			"locked"
		)
		// A lock is a configure's to change, and only the owner's: the owner may unlock it.
		expect(
			await ask(t, t.owner.id, t.caraSeat, FREE, "configure", true)
		).toBeNull()
	})

	test("an unheard value is refused at all-any, in today's words; the owner hears everything", async () => {
		const t = await table({ fields: { playerSheetLatitude: "all-any" } })
		const refused = await ask(t, t.bo.id, t.npc, WHISPER)
		expect(refused?.cause).toBe("unheard")
		expect(refused?.sentence).toMatch(
			/^Only the session's owner and whoever plays Gideon can change Gideon's /
		)
		expect(await ask(t, t.owner.id, t.npc, WHISPER)).toBeNull()
	})
})

describe("a configure", () => {
	test("is the session owner's alone; the sentence depends on whether it sets a lock", async () => {
		const t = await table({ fields: { playerSheetLatitude: "all-any" } })
		expect(
			await ask(t, t.cara.id, t.caraSeat, FREE, "configure", true)
		).toEqual({
			cause: "owner-locks",
			sentence: "Only the session owner locks or unlocks a stat."
		})
		expect(
			await ask(t, t.cara.id, t.caraSeat, FREE, "configure", false)
		).toEqual({
			cause: "owner-locks",
			sentence: "Only the session owner changes how a stat is set up."
		})
		// Through the socket.
		const refused = await viaSocket("stateConfigure", t.cara.id, {
			sessionId: t.sessionId,
			owner: t.caraSeat,
			slotId: FREE,
			config: { lock: "people" }
		})
		expect(refused.refused).toBe(
			"Only the session owner locks or unlocks a stat."
		)
		const owned = await viaSocket("stateConfigure", t.owner.id, {
			sessionId: t.sessionId,
			owner: t.caraSeat,
			slotId: FREE,
			config: { lock: "people" }
		})
		expect(owned.refused).toBeNull()
	})
})

// ── moves ───────────────────────────────────────────────────────────────────

describe("item moves", () => {
	test("the Crawler's players move their own items but do not edit sheets; not another's", async () => {
		const t = await table()
		expect(
			(await ask(t, t.cara.id, t.caraSeat, CONSUMABLES, "set"))?.cause
		).toBe("no-edits")
		expect(
			await ask(t, t.cara.id, t.caraSeat, CONSUMABLES, "take-from")
		).toBeNull()
		expect(
			await ask(t, t.cara.id, t.caraSeat, CONSUMABLES, "put-on")
		).toBeNull()
		expect(
			(await ask(t, t.cara.id, t.boSeat, CONSUMABLES, "take-from"))?.cause
		).toBe("not-theirs")
		expect(
			(await ask(t, t.cara.id, t.boSeat, CONSUMABLES, "put-on"))?.cause
		).toBe("not-theirs")
		// The owner may do both anywhere (as-ruled; a list is no ruleset attribute).
		expect(
			await ask(t, t.owner.id, t.boSeat, CONSUMABLES, "take-from")
		).toBeNull()
		expect(
			await ask(t, t.owner.id, t.npc, CONSUMABLES, "put-on")
		).toBeNull()
	})

	test("no-moves refuses a player in the session's words", async () => {
		const t = await table({ fields: { playerItemMoves: "no-moves" } })
		expect(
			await ask(t, t.cara.id, t.caraSeat, CONSUMABLES, "take-from")
		).toEqual({ cause: "no-moves", sentence: NO_MOVES })
	})

	/** A table that moves items as the Crawler does (players: no sheet edits, their own items) over a genre with `inventory`. */
	const moving = (levels: Record<string, unknown> = {}) =>
		table({
			genreId: STORY,
			ruleset: VIS_ITINERIS,
			presetSettings: {
				playerSheetLatitude: "no-edits",
				playerItemMoves: "own-items",
				...levels
			}
		})

	test("a player gives their own item to another player's seat: an offer, nothing moves yet", async () => {
		const t = await moving()
		await stock(t, t.caraSeat, ["rope", "torch"])
		const give = (userId: number, over: Record<string, unknown> = {}) =>
			viaSocket("stateGivePiece", userId, {
				sessionId: t.sessionId,
				from: t.caraSeat,
				to: t.boSeat,
				slotId: INVENTORY,
				index: 0,
				...over
			})
		const offered = await give(t.cara.id)
		expect(offered.refused).toBeNull()
		expect(offered.res.given).toBe("offered")
		expect(await valueAt(t, t.caraSeat, INVENTORY)).toEqual([
			"rope",
			"torch"
		])
		const open = async () =>
			(
				await testDb
					.select()
					.from(schema.stateProposals)
					.where(eq(schema.stateProposals.sessionId, t.sessionId))
			).filter((p) => p.status === "pending")
		const [offer] = await open()
		// The offer names the giver and the receiver; nothing moved.
		expect((offer!.payload as any).offer.by).toBe(t.cara.id)
		expect(await valueAt(t, t.boSeat, INVENTORY)).toBeFalsy()
	})

	test("a player gives their own item to another player: the receiver may decline, the giver withdraw, the owner decline", async () => {
		const t = await moving()
		await stock(t, t.caraSeat, ["rope", "torch", "lamp", "map"])
		const open = async () =>
			(
				await testDb
					.select()
					.from(schema.stateProposals)
					.where(eq(schema.stateProposals.sessionId, t.sessionId))
			).filter((p) => p.status === "pending")
		for (const [by, who] of [
			["receiver", t.bo.id],
			["giver", t.cara.id],
			["owner", t.owner.id]
		] as const) {
			const given = await viaSocket("stateGivePiece", t.cara.id, {
				sessionId: t.sessionId,
				from: t.caraSeat,
				to: t.boSeat,
				slotId: INVENTORY,
				index: 0
			})
			expect(given.res.given, by).toBe("offered")
			const [pending] = await open()
			const declined = await viaSocket("stateDecide", who, {
				proposalId: pending!.id,
				accept: false
			})
			expect(declined.refused, by).toBeNull()
			expect(declined.res.status, by).toBe("rejected")
		}
		// Nothing moved.
		expect(await valueAt(t, t.caraSeat, INVENTORY)).toEqual([
			"rope",
			"torch",
			"lamp",
			"map"
		])
	})

	test("a player's offer is accepted by the receiver as their own put-on; another player cannot accept it", async () => {
		const t = await moving()
		await stock(t, t.caraSeat, ["rope", "torch"])
		const given = await viaSocket("stateGivePiece", t.cara.id, {
			sessionId: t.sessionId,
			from: t.caraSeat,
			to: t.boSeat,
			slotId: INVENTORY,
			index: 0
		})
		expect(given.res.given).toBe("offered")
		const [offer] = (
			await testDb
				.select()
				.from(schema.stateProposals)
				.where(eq(schema.stateProposals.sessionId, t.sessionId))
		).filter((p) => p.status === "pending")
		// The giver's own hand does not accept their offer to someone else's seat.
		expect(
			(
				await viaSocket("stateDecide", t.cara.id, {
					proposalId: offer!.id,
					accept: true
				})
			).refused
		).toBe(
			"only Bo's player or the session's owner can change their sheet."
		)
		const accepted = await viaSocket("stateDecide", t.bo.id, {
			proposalId: offer!.id,
			accept: true
		})
		expect(accepted.refused).toBeNull()
		expect(accepted.res.status).toBe("accepted")
		expect(await valueAt(t, t.boSeat, INVENTORY)).toEqual(["rope"])
		expect(await valueAt(t, t.caraSeat, INVENTORY)).toEqual(["torch"])
	})

	test("a watcher cannot decline an offer", async () => {
		const t = await moving()
		await stock(t, t.caraSeat, ["rope"])
		await viaSocket("stateGivePiece", t.cara.id, {
			sessionId: t.sessionId,
			from: t.caraSeat,
			to: t.boSeat,
			slotId: INVENTORY,
			index: 0
		})
		const [offer] = (
			await testDb
				.select()
				.from(schema.stateProposals)
				.where(eq(schema.stateProposals.sessionId, t.sessionId))
		).filter((p) => p.status === "pending")
		expect(
			(
				await viaSocket("stateDecide", t.watcher.id, {
					proposalId: offer!.id,
					accept: false
				})
			).refused
		).toBe(
			"You're watching this session; only its players and owner change sheets."
		)
	})

	test("a player at no-moves cannot give; at any-items the same give is direct", async () => {
		const t = await moving({ playerItemMoves: "no-moves" })
		await stock(t, t.caraSeat, ["rope"])
		const params = {
			sessionId: t.sessionId,
			from: t.caraSeat,
			to: t.boSeat,
			slotId: INVENTORY,
			index: 0
		}
		expect(
			(await viaSocket("stateGivePiece", t.cara.id, params)).res.error
		).toBe("Players don't move items by hand in this genre.")
		const u = await moving({ playerItemMoves: "any-items" })
		await stock(u, u.caraSeat, ["rope"])
		const direct = await viaSocket("stateGivePiece", u.cara.id, {
			...params,
			sessionId: u.sessionId,
			from: u.caraSeat,
			to: u.boSeat
		})
		expect(direct.res.given).toBe("direct")
		expect(await valueAt(u, u.boSeat, INVENTORY)).toEqual(["rope"])
	})

	test("a player does not give from another's sheet", async () => {
		const t = await moving()
		await stock(t, t.boSeat, ["lamp"])
		const refused = await viaSocket("stateGivePiece", t.cara.id, {
			sessionId: t.sessionId,
			from: t.boSeat,
			to: t.caraSeat,
			slotId: INVENTORY,
			index: 0
		})
		expect(refused.res.error).toBe(
			"only Bo's player or the session's owner can change their sheet."
		)
	})

	test("the session's owner gives directly to a player's seat; a watcher cannot give", async () => {
		const t = await moving()
		await stock(t, t.annSeat, ["map"])
		const params = {
			sessionId: t.sessionId,
			from: t.annSeat,
			to: t.caraSeat,
			slotId: INVENTORY,
			index: 0
		}
		expect(
			(await viaSocket("stateGivePiece", t.watcher.id, params)).res.error
		).toBe(
			"You're watching this session; only its players and owner change sheets."
		)
		const given = await viaSocket("stateGivePiece", t.owner.id, params)
		expect(given.res.given).toBe("direct")
		expect(await valueAt(t, t.caraSeat, INVENTORY)).toEqual(["map"])
	})

	test("a drop at a place is the giver's side only; a pick-up is the receiver's side only", async () => {
		const t = await moving()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: t.owner.id, name: `Hands book ${n}` } as any)
			.returning()
		const [hall] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: book!.id,
				typeId: "core:entry/location",
				typeVersion: 1,
				position: 0,
				title: "Hall",
				content: "…"
			} as any)
			.returning()
		await testDb
			.update(schema.sessions)
			.set({ lorebookId: book!.id } as any)
			.where(eq(schema.sessions.id, t.sessionId))
		const place = { kind: "session_location" as const, id: hall!.id }
		await stock(t, t.caraSeat, ["rope", "torch"])
		// Cara drops at the Hall: her own items (take-from), no put-on to judge on a place.
		const drop = await viaSocket("stateGivePiece", t.cara.id, {
			sessionId: t.sessionId,
			from: t.caraSeat,
			to: place,
			slotId: INVENTORY,
			index: 0
		})
		expect(drop.res.error, drop.res.error).toBeUndefined()
		expect(drop.res.given).toBe("direct")
		expect(await valueAt(t, place, INVENTORY)).toEqual(["rope"])
		// Bo picks it up: the receiver's side is his own.
		const pick = await viaSocket("stateGivePiece", t.bo.id, {
			sessionId: t.sessionId,
			from: place,
			to: t.boSeat,
			slotId: INVENTORY,
			index: 0
		})
		expect(pick.res.error, pick.res.error).toBeUndefined()
		expect(pick.res.given).toBe("direct")
		expect(await valueAt(t, t.boSeat, INVENTORY)).toEqual(["rope"])
		// A watcher can neither drop nor pick up.
		const watched = await viaSocket("stateGivePiece", t.watcher.id, {
			sessionId: t.sessionId,
			from: place,
			to: t.boSeat,
			slotId: INVENTORY,
			index: 0
		})
		expect(watched.res.error).toBeTruthy()
	})
})

// ── what the sheet is told ──────────────────────────────────────────────────

describe("state:get — handLocked and editable, from the same decider", () => {
	const rowOf = (state: any, owner: { kind: string; id: number }) =>
		state.owners.find(
			(o: any) => o.kind === owner.kind && o.id === owner.id
		)

	test("the Crawler's player: their own sheet is hand-locked but their things can be given away; others' are read-only", async () => {
		const t = await table({ ruleset: VIS_ITINERIS })
		const state = await stateOf(t, t.cara.id)
		const mine = rowOf(state, t.caraSeat)
		expect(mine.editable).toBe(true)
		expect(mine.handLocked[CONSUMABLES]).toBe(NO_EDITS)
		expect(mine.handLocked[HP]).toBe(NO_EDITS)
		const bos = rowOf(state, t.boSeat)
		expect(bos.editable).toBe(false)
		// At no-edits the level answers first, whoever's the sheet is.
		expect(bos.handLocked[CONSUMABLES]).toBe(NO_EDITS)
		const world = rowOf(state, t.world)
		expect(world.editable).toBe(false)
		const words = Object.values(world.handLocked) as string[]
		expect(words.length).toBeGreaterThan(0)
		expect(new Set(words)).toEqual(new Set([NO_EDITS]))
	})

	test("the session's owner: the world and every seat are theirs; in the Crawler nothing is hand-locked for them", async () => {
		const t = await table({ ruleset: VIS_ITINERIS })
		const state = await stateOf(t, t.owner.id)
		for (const owner of [t.world, t.npc, t.boSeat, t.annSeat, t.caraSeat])
			expect(rowOf(state, owner).editable, JSON.stringify(owner)).toBe(
				true
			)
		// ★ed-2 (2026-11-05): the Crawler's owner is pinned all-any — no stat is hand-locked for them.
		expect(rowOf(state, t.boSeat).handLocked?.[HP]).toBeUndefined()
		expect(rowOf(state, t.boSeat).handLocked?.[CONSUMABLES]).toBeUndefined()
	})

	test("a watcher is told everything is locked, with the reason", async () => {
		const t = await table({ ruleset: VIS_ITINERIS })
		const state = await stateOf(t, t.watcher.id)
		for (const row of state.owners) {
			expect(row.editable, row.key).toBe(false)
			for (const sentence of Object.values(row.handLocked ?? {}))
				expect(sentence).toBe(
					"You're watching this session; only its players and owner change sheets."
				)
		}
	})

	test("a player at as-ruled: free stats are theirs, the rules' alone are locked with their cause; the world is read-only", async () => {
		const t = await table({
			ruleset: R,
			fields: { playerSheetLatitude: "as-ruled" }
		})
		const state = await stateOf(t, t.cara.id)
		const mine = rowOf(state, t.caraSeat)
		expect(mine.editable).toBe(true)
		expect(mine.handLocked?.[FREE]).toBeUndefined()
		expect(mine.handLocked?.[TAG]).toBeUndefined()
		expect(mine.handLocked[SEALED]).toBe(
			`Only the game master or the rules change Sealed.`
		)
		expect(rowOf(state, t.world).editable).toBe(false)
	})
})

// ── nothing a run does reaches the decider ──────────────────────────────────

describe("runs", () => {
	test("a write with no person on it is never judged: a locked-people stat takes a run's value", async () => {
		const t = await table({ fields: { playerSheetLatitude: "no-edits" } })
		await lockStat(t, t.caraSeat, FREE, "people")
		const { applyAutomatic } = await import("$lib/server/state/write")
		await applyAutomatic(
			testDb as any,
			{ sessionId: t.sessionId, updatedBy: "run:test" },
			{ owner: t.caraSeat, slotId: FREE, value: 3 } as any
		)
		expect(await valueAt(t, t.caraSeat, FREE)).toBe(3)
	})
})

// ── deciding the model's held change on a seat (lane ed supervisor, 2026-11-05) ──

describe("who decides a held change on a player's seat", () => {
	test("the session's owner or the seat's own player; never a watcher or another player — and no sheet level asked", async () => {
		const t = await table({ fields: { playerSheetLatitude: "no-edits" } })
		const { proposeChange, decideProposal } = await import("$lib/server/state/write")
		const held = async () =>
			proposeChange(
				testDb as any,
				{ sessionId: t.sessionId, updatedBy: "run:test" },
				{ owner: t.boSeat, slotId: FREE, value: 4 } as any
			)
		const one = await held()
		await expect(decideProposal(testDb as any, one, true, t.watcher.id)).rejects.toThrow(
			"You're watching this session; only its players and owner change sheets."
		)
		await expect(decideProposal(testDb as any, one, true, t.cara.id)).rejects.toThrow(/Bo's player/)
		// Its own player accepts it, even at `no-edits`: deciding the model's change is not a hand edit.
		expect((await decideProposal(testDb as any, one, true, t.bo.id)).status).toBe("accepted")
		expect(await valueAt(t, t.boSeat, FREE)).toBe(4)
		const two = await held()
		expect((await decideProposal(testDb as any, two, false, t.owner.id)).status).toBe("rejected")
	}, 60_000)
})

// ── S4 wave 3: member form (switch on) ──────────────────────────────────────

describe("an offer taken before the flip, restored in member form", () => {
	test("payload.offer.from and payload.owner come back in member form; the restored offer is accepted", async () => {
		const was = memberFormSwitch.on
		memberFormSwitch.on = true
		try {
			const t = await table({
				genreId: STORY,
				ruleset: VIS_ITINERIS,
				presetSettings: { playerSheetLatitude: "no-edits", playerItemMoves: "own-items" }
			})
			const [caraRow] = await testDb
				.select()
				.from(schema.sessionPersonas)
				.where(eq(schema.sessionPersonas.sessionId, t.sessionId))
				.then((rows) => rows.filter((r) => r.personaId != null))
			// The sheet the offer is about: the giver's carded player seat, in member form.
			await stock(t, { kind: "player_seat", id: caraRow!.id }, ["rope", "torch"])
			// An offer as it was stored before the flip: the giver by card, the receiver by seat.
			const before = {
				owner: { kind: "player_seat", id: t.boSeat.id },
				slotId: INVENTORY,
				offer: {
					from: { kind: "session_cast", id: caraRow!.personaId },
					item: "rope",
					count: 1,
					by: t.cara.id,
					fromLabel: "Cara",
					toLabel: "Bo",
					itemName: "rope"
				}
			}
			const { restoredInMemberForm } = await import("$lib/server/state/write")
			const out = await restoredInMemberForm(testDb as any, {
				values: [],
				configs: [],
				zones: [],
				proposals: [{ sessionId: t.sessionId, payload: before }]
			})
			const payload = out.proposals[0]!.payload as typeof before
			expect(payload.offer.from).toEqual({ kind: "player_seat", id: caraRow!.id })
			expect(payload.owner).toEqual({ kind: "player_seat", id: t.boSeat.id })
			// Run twice: nothing more to translate.
			const again = await restoredInMemberForm(testDb as any, { values: [], configs: [], zones: [], proposals: out.proposals })
			expect(again.proposals[0]!.payload).toEqual(payload)

			const [row] = await testDb
				.insert(schema.stateProposals)
				.values({ sessionId: t.sessionId, messageId: null, kind: "value", payload: payload as any, status: "pending", proposedBy: `user:${t.cara.id}`, baseVersion: null })
				.returning()
			const accepted = await viaSocket("stateDecide", t.bo.id, { proposalId: row!.id, accept: true })
			expect(accepted.refused).toBeNull()
			expect(accepted.res.status).toBe("accepted")
			expect(await valueAt(t, t.boSeat, INVENTORY)).toEqual(["rope"])
			expect(await valueAt(t, { kind: "player_seat", id: caraRow!.id }, INVENTORY)).toEqual(["torch"])
		} finally {
			memberFormSwitch.on = was
		}
	})
})

describe("a card held by a character seat and a player seat (★K-2, switch on)", () => {
	test("each seat reads its own member: the player seat is its member's active card's owner's", async () => {
		const was = memberFormSwitch.on
		memberFormSwitch.on = true
		try {
			const { createTestUser } = await import("$lib/server/utils/testDb")
			const suffix = `${++n}`
			const owner = (await createTestUser(testDb, `k2-owner-${suffix}`))!
			const guest = (await createTestUser(testDb, `k2-guest-${suffix}`))!
			const card = async (userId: number, name: string) =>
				(await testDb.insert(schema.characters).values({ userId, name, description: "…" } as any).returning())[0]!
			const shared = await card(owner.id, "Shared")
			const other = await card(guest.id, "Bravo's card")
			const [book] = await testDb.insert(schema.lorebooks).values({ userId: owner.id, name: `K2 ${suffix}` }).returning()
			const mChar = (await insertCastMember(testDb, { lorebookId: book!.id, binding: `{{char:k2a${suffix}}}`, characterId: shared.id, name: "Shared" })).member!
			const mPlayer = (await insertCastMember(testDb, { lorebookId: book!.id, binding: `{{char:k2b${suffix}}}`, characterId: other.id, name: "Bravo" })).member!
			const [session] = await testDb
				.insert(schema.sessions)
				.values({ userId: owner.id, isGroup: true, name: `K2 ${suffix}`, genreId: CRAWLER, lorebookId: book!.id } as any)
				.returning()
			const sessionId = session!.id
			await testDb.insert(schema.sessionGuests).values({ sessionId, userId: guest.id, isPlayer: true } as any)
			await testDb.insert(schema.sessionCharacters).values({ sessionId, characterId: shared.id, castMemberId: mChar.id } as any)
			// The player seat holds the shared card in its column, but its member's active card is Bravo's.
			const [seat] = await testDb
				.insert(schema.sessionPersonas)
				.values({ sessionId, personaId: shared.id, castMemberId: mPlayer.id, userId: null, position: 5 } as any)
				.returning()
			const { handEditJudge } = await import("$lib/server/state/handEdits")
			const judge = await handEditJudge(testDb as any, sessionId, guest.id)
			const seatOwner = { kind: "player_seat", id: seat!.id } as const
			await judge.know(seatOwner)
			expect(judge.role).toBe("player")
			expect(judge.whose(seatOwner)).toBe("own")
		} finally {
			memberFormSwitch.on = was
		}
	})
})
