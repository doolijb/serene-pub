/**
 * 🚧 Ruleset decks follow Back (ST3, 2026-11-11), through the real resolver:
 * a `card-draw` check files one `deck` session imprint per key written,
 * anchored to the turn in every mode, and every door that takes the turn
 * (swipe, regenerate, Back, delete) puts the deck back as it was; Forward
 * puts the draw back. A propose-mode turn that is regenerated never spends
 * its cards twice; when two turns draw from one deck and the earlier is
 * taken, the earlier turn's cards stay spent.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, defineRuleset } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return {
		db: await createTestDb(),
		getCryptoSecretKey: () => "deck-draws-test-secret"
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
	autoEnqueueLorebook: async () => {}
}))
vi.mock(
	"$lib/server/sockets/utils/broadcastHelpers",
	async (importOriginal) => {
		const real =
			await importOriginal<
				typeof import("$lib/server/sockets/utils/broadcastHelpers")
			>()
		return {
			...real,
			emitToUserRedacted: async () => {},
			broadcastToSessionUsers: async () => {}
		}
	}
)

/** The reply road: nothing is generated (the regenerate handler fires it after the take-back). */
vi.mock("$lib/server/utils/runReply", () => ({
	runReply: async () => ({ ok: true })
}))

const GRIT = "test:slot/dd-grit@1"
const DECKED = "test:ruleset/dd-decked@1"
const DECKED_GENRE = "test:genre/dd-decked"

let ownerId: number
let characterId: number
let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-deck-draws-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await db
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)
	const grit = defineAttributeSlot(GRIT, {
		type: "integer",
		label: { en: "Grit" },
		descriptor: "Grit.",
		appliesTo: ["cast"],
		config: { min: 0, max: 10 },
		default: 2
	})
	defineRuleset(DECKED, {
		name: { en: "Decked" },
		voice: { prose: "Decked, in words.", mechanics: "Decked decides." },
		conventions: {
			methods: { cards: { kind: "card-draw", ranks: 13 } },
			defaultMethod: "cards",
			time: { unit: "round" }
		},
		stats: [{ id: GRIT }],
		selectors: {
			peek: { kind: "check", base: "dd-grit", method: "cards" }
		},
		repertoires: [],
		scripts: []
	})
	genreKeeping(DECKED_GENRE, {
		name: { en: "Decked" },
		family: "test",
		slots: [grit],
		events: {}
	})
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "deck-draws-owner")).id
	const [character] = await db
		.insert(schema.characters)
		.values({ userId: ownerId, name: "Mara", description: "A miller." })
		.returning()
	characterId = character!.id
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const d = () => db as unknown as Db
const quietIo = () =>
	({
		sockets: {
			adapter: { rooms: { get: () => undefined } },
			sockets: { get: () => undefined, values: () => [].values() }
		},
		to: () => ({ emit: () => {} }),
		emit: () => {}
	}) as any
const fakeSocket = () =>
	({ user: { id: ownerId, isAdmin: false }, io: quietIo() }) as any
const none = { scripts: { loadSource: async () => null } }

interface World {
	sessionId: number
	/** Each reply, oldest first (one per turn). */
	replies: number[]
}

/** A session on its own book, a deck already drawn once (permanent: no turn anchor), then `turns` person-line + reply pairs. */
async function world(turns = 1): Promise<World> {
	const k = ++n
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId: ownerId, name: `Deck book ${k}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: false,
			name: `Deck ${k}`,
			genreId: DECKED_GENRE,
			primaryRuleset: DECKED,
			rigour: "mechanics",
			lorebookId: lorebook!.id
		})
		.returning()
	await db
		.insert(schema.sessionCharacters)
		.values({ sessionId: session!.id, characterId, isActive: true })
	const { insertLegacy } = await import("$lib/server/messages/store")
	const replies: number[] = []
	for (let i = 0; i < turns; i++) {
		await insertLegacy(d(), {
			sessionId: session!.id,
			userId: ownerId,
			role: "user",
			content: `We go on (${i}).`,
			channel: "main"
		} as any)
		const reply = await insertLegacy(d(), {
			sessionId: session!.id,
			role: "assistant",
			isNarratorResponse: true,
			content: `It happens (${i}).`,
			channel: "main"
		} as any)
		replies.push(reply.id)
	}
	await db
		.insert(schema.attributeValues)
		.values({
			ownerKind: "session_cast",
			ownerId: characterId,
			slotId: GRIT,
			value: { v: 2 },
			sessionId: session!.id,
			updatedBy: "user"
		})
	await draw(
		{ sessionId: session!.id, replies },
		"apply",
		`dd-pre-${k}`,
		null
	)
	return { sessionId: session!.id, replies }
}

/** One draw through the real resolver, tied to `turn` (null: a permanent draw, nothing filed). */
async function draw(
	w: World,
	mode: "apply" | "propose",
	runId: string,
	turn: number | null
) {
	const { seededRandom } = await import("$lib/server/state/expressions")
	const { resolveRulesetTurn } = await import("./resolve")
	const res = await resolveRulesetTurn(
		d(),
		{
			owners: [`session:${w.sessionId}`, `character:${characterId}`],
			mode,
			deltas: [
				{
					owner: `character:${characterId}`,
					op: "use",
					check: "peek",
					against: 9
				}
			]
		},
		{
			random: seededRandom(runId),
			runId,
			...(turn != null ? { turnMessageId: turn } : {}),
			...none
		} as any
	)
	if ("halt" in res) throw new Error(res.halt)
}

const deckOf = async (w: World) => {
	const [row] = await db
		.select({ decks: schema.sessions.rulesetDecks })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, w.sessionId))
	return (row?.decks ?? {}) as Record<
		string,
		{ scene: number | null; shuffle: number; drawn: number }
	>
}
const drawn = async (w: World) => (await deckOf(w)).cards?.drawn
const rows = async (w: World) =>
	(
		await db
			.select()
			.from(schema.sessionImprints)
			.where(eq(schema.sessionImprints.sessionId, w.sessionId))
	)
		.filter((r) => r.subjectKind === "deck")
		.sort((a, b) => a.id - b.id)

const take = async (
	w: World,
	how: "swipe" | "regenerate" | "back" | "delete"
) => {
	const reply = w.replies[w.replies.length - 1]!
	if (how === "swipe") {
		const { retractStateAnchoredTo } = await import(
			"$lib/server/state/write"
		)
		await retractStateAnchoredTo(d(), reply, "replaced")
	} else if (how === "delete") {
		const { deleteLegacy } = await import("$lib/server/messages/store")
		await deleteLegacy(d(), reply)
	} else if (how === "regenerate") {
		// The real handler: the take-back (a turn's rows as Back takes them, minus the person's line), then the same turn again.
		const { sessionMessagesRegenerateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res: any = await sessionMessagesRegenerateHandler.handler(
			fakeSocket(),
			{ id: reply } as any,
			() => {}
		)
		expect(res?.error).toBeUndefined()
	} else {
		const { rewindTurn } = await import("$lib/server/sessions/rewind")
		const out = await rewindTurn(d(), {
			sessionId: w.sessionId,
			userId: ownerId
		})
		expect(out, JSON.stringify(out)).toMatchObject({ ok: true })
	}
}

describe("a deck draw follows the turn that made it", () => {
	it("the baseline: a permanent draw files nothing; a turn's draw files one row, anchored to the turn", async () => {
		const w = await world()
		expect(await drawn(w)).toBe(1)
		expect(await rows(w)).toHaveLength(0)
		await draw(w, "apply", `dd-base-${n}`, w.replies[0]!)
		expect(await drawn(w)).toBe(2)
		const filed = await rows(w)
		expect(filed).toHaveLength(1)
		expect(filed[0]).toMatchObject({
			subjectKey: "cards",
			messageId: w.replies[0],
			status: "standing",
			before: { v: { scene: null, shuffle: 0, drawn: 1 } },
			after: { v: { scene: null, shuffle: 0, drawn: 2 } }
		})
	})

	for (const how of ["swipe", "regenerate", "back", "delete"] as const) {
		it(`${how} takes the draw: the deck returns to what it was before the turn, and the row goes`, async () => {
			const w = await world()
			const before = await deckOf(w)
			await draw(w, "apply", `dd-${how}-${n}`, w.replies[0]!)
			expect(await drawn(w)).toBe(2)
			await take(w, how)
			expect(await deckOf(w)).toEqual(before)
			expect(await rows(w)).toHaveLength(0)
		})
	}

	it("Forward after Back puts the draw back, deck and row", async () => {
		const w = await world()
		await draw(w, "apply", `dd-fwd-${n}`, w.replies[0]!)
		const drawnDeck = await deckOf(w)
		const drawnRows = (await rows(w)).map(({ id: _id, ...r }) => r)
		await take(w, "back")
		expect(await drawn(w)).toBe(1)
		const { forwardTurn } = await import("$lib/server/sessions/rewind")
		expect(
			await forwardTurn(d(), { sessionId: w.sessionId, userId: ownerId })
		).toMatchObject({ ok: true })
		expect(await deckOf(w)).toEqual(drawnDeck)
		const back = await rows(w)
		expect(back).toHaveLength(1)
		expect(back[0]).toMatchObject({
			subjectKey: "cards",
			messageId: w.replies[0],
			status: "standing",
			before: drawnRows[0]!.before,
			after: drawnRows[0]!.after
		})
	})

	it("a propose-mode turn regenerated does not spend twice", async () => {
		const w = await world()
		await draw(w, "propose", `dd-prop1-${n}`, w.replies[0]!)
		expect(await drawn(w)).toBe(2)
		expect(await rows(w)).toHaveLength(1)
		await take(w, "swipe")
		expect(await drawn(w)).toBe(1)
		await draw(w, "propose", `dd-prop2-${n}`, w.replies[0]!)
		// one draw after the take-back, not two
		expect(await drawn(w)).toBe(2)
		expect(await rows(w)).toHaveLength(1)
	})

	it("two turns drawing from one deck: taking the earlier leaves its cards spent; taking the later puts the deck where it stood before both", async () => {
		const w = await world(2)
		const [a, b] = w.replies as [number, number]
		await draw(w, "apply", `dd-two-a-${n}`, a)
		await draw(w, "apply", `dd-two-b-${n}`, b)
		expect(await drawn(w)).toBe(3)
		const { deleteLegacy } = await import("$lib/server/messages/store")
		await deleteLegacy(d(), a)
		// A's cards stay spent: the later card was dealt from the position A left.
		expect(await drawn(w)).toBe(3)
		const left = await rows(w)
		expect(left).toHaveLength(1)
		expect(left[0]).toMatchObject({
			messageId: b,
			before: { v: { scene: null, shuffle: 0, drawn: 1 } },
			after: { v: { scene: null, shuffle: 0, drawn: 3 } }
		})
		await deleteLegacy(d(), b)
		expect(await drawn(w)).toBe(1)
		expect(await rows(w)).toHaveLength(0)
	})
})
