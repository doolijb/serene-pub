/**
 * 🚧 The scene summary review's seed lists speakers only (owner rulings D57
 * 2026-11-16, B1 2026-11-17): the senders core's cast rule keeps, whatever the
 * model's `cast` step names. A seated, silent member and a stranger the model
 * names are not seeded, no name is suggested, and no member is minted. The
 * run itself (`runSpec`) is faked; everything else is real.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { insertLegacy } from "$lib/server/messages/store"
import { insertCastMember } from "$lib/server/characters/versions"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string
let seq = 0

const castNames = vi.hoisted(() => ({ participants: [] as any[] }))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

/** A receipt the socket reads its result off: a summary, and a `cast` step naming whoever the test says. */
vi.mock("$lib/server/pipelines/runtime/runTurn", async (importOriginal) => {
	const actual = await importOriginal<any>()
	return {
		...actual,
		runSpec: vi.fn(async () => ({
			outcome: "halt",
			haltNodeKey: "save",
			haltReason: "preview: stopped before save, nothing sent",
			runId: 1,
			nodes: [
				{
					nodeKey: "synth",
					definitionId: "core:oracle/summarize-synth@1",
					output: { content: "They talked by the gate until dark." }
				},
				{
					nodeKey: "cast",
					definitionId: "core:oracle/extract-cast@1",
					output: {
						cast: {
							participants: castNames.participants,
							mentioned: []
						}
					}
				}
			]
		}))
	}
})

const PLAIN = "test:genre/reviewseed-plain"
const PLACED = "test:genre/reviewseed-placed"
const LOCATION = "core:slot/location@1"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-reviewseed-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { locationSlot } = await import("@serene-pub/core-catalog")
	genreKeeping(PLAIN, {
		name: { en: "Plain" },
		family: "test",
		shape: { channels: ["main"] },
		slots: [],
		events: {}
	})
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
	// The host reads a genre's place key from its published session-created spec.
	const { sessionEvents } = await import("@serene-pub/sdk")
	const [spec] = await testDb
		.insert(schema.pipelineSpecs)
		.values({ slug: "test:spec/reviewseed-placed-create", name: "placed" })
		.returning()
	const [version] = await testDb
		.insert(schema.pipelineSpecVersions)
		.values({
			specId: spec.id,
			semver: "1.0.0",
			status: "published",
			canonicalHash: "test-reviewseed-placed-create",
			inputGenre: PLACED,
			inputEvent: sessionEvents.sessionCreated,
			genre: {
				name: { en: "Placed" },
				family: "test",
				shape: {
					channels: ["main"],
					scenes: { place: { stateKey: "location" } }
				}
			}
		} as any)
		.returning()
	await testDb
		.update(schema.pipelineSpecs)
		.set({ activeVersionId: version.id })
		.where(eq(schema.pipelineSpecs.id, spec.id))
	const [connection] = await testDb
		.insert(schema.connections)
		.values({ name: "seed-conn", type: "ollama" })
		.returning()
	const [sampling] = await testDb
		.insert(schema.samplingConfigs)
		.values({ name: "seed-sampling" })
		.returning()
	const existing = await testDb.query.systemSettings.findFirst()
	if (!existing) await testDb.insert(schema.systemSettings).values({} as any)
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const model = await ensureConnectionModel(
		testDb as any,
		connection.id,
		"seed-7b"
	)
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(testDb as any, "text->text", {
		connectionId: connection.id,
		connectionModelId: model!.id,
		samplingConfigId: sampling.id
	})
})

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as any

type Seat = {
	card: { id: number; name: string }
	member: { id: number }
	seatId: number
	player: boolean
}
type World = Awaited<ReturnType<typeof world>>

async function world(genreId: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const label = `reviewseed-${++seq}`
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

async function seat(w: World, name: string, player: boolean): Promise<Seat> {
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
	const [row] = player
		? await testDb
				.insert(schema.sessionPersonas)
				.values({
					sessionId: w.session.id,
					userId: w.user.id,
					personaId: card.id,
					castMemberId: member.id
				} as any)
				.returning()
		: await testDb
				.insert(schema.sessionCharacters)
				.values({
					sessionId: w.session.id,
					characterId: card.id,
					castMemberId: member.id,
					seatedByUserId: w.user.id
				} as any)
				.returning()
	return { card, member, seatId: row.id, player }
}

async function say(w: World, who: Seat, content: string) {
	const m = await insertLegacy(db(), {
		sessionId: w.session.id,
		role: who.player ? "user" : "assistant",
		content,
		...(who.player
			? { personaId: who.card.id }
			: { characterId: who.card.id })
	} as any)
	return m.id
}

const tick = () => new Promise((r) => setTimeout(r, 8))

async function setPlace(
	w: World,
	owner: { kind: string; id: number },
	v: string
) {
	await tick()
	await testDb.insert(schema.attributeValues).values({
		ownerKind: owner.kind,
		ownerId: owner.id,
		slotId: LOCATION,
		value: { v },
		sessionId: w.session.id,
		updatedBy: "run:test"
	} as any)
	await tick()
}

/** A closed live scene over the lines from `first` to `last`, reviewed; the review's seed is returned. */
async function reviewSeed(w: World, first: number, last: number) {
	const { openScene } = await import("$lib/server/scenes/liveScenes")
	const { scene } = await openScene(db(), {
		sessionId: w.session.id,
		userId: w.user.id,
		channel: "main",
		atMessageId: first,
		closeAt: last
	})
	const { sceneProcessHandler } = await import("./scenes")
	const res = (await sceneProcessHandler.handler(
		{ user: { id: w.user.id } } as any,
		{ sceneId: scene.id },
		() => {}
	)) as any
	const { activityStore } = await import("$lib/server/utils/activityStore")
	const pending = (activityStore.getById(res.activityId) as any).pendingResult
	activityStore.remove(res.activityId, "dismissed")
	return pending as {
		participantCharacters: number[]
	}
}

async function memberCount(lorebookId: number) {
	return (
		await testDb
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
	).length
}

const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b)

describe("the review's seed", () => {
	test("speakers only: a seated silent member, a stranger and the model's names add nothing", async () => {
		const w = await world(PLAIN)
		const mira = await seat(w, "Mira", false)
		const tomas = await seat(w, "Tomas", true)
		const pell = await seat(w, "Pell", false)
		const first = await say(w, mira, "Mira looks up.")
		const last = await say(w, tomas, "I sit down.")
		castNames.participants = ["Pell", "Grust", "Mira"]
		const before = await memberCount(w.book.id)

		const seed = await reviewSeed(w, first, last)

		expect(sorted(seed.participantCharacters)).toEqual(
			sorted([mira.member.id, tomas.member.id])
		)
		expect(seed.participantCharacters).not.toContain(pell.member.id)
		expect(await memberCount(w.book.id)).toBe(before)
	})

	test("a speaker whose own place at its line differs from the scene's place is not seeded", async () => {
		const w = await world(PLACED)
		const mira = await seat(w, "Mira", false)
		const bram = await seat(w, "Bram", false)
		await setPlace(w, { kind: "session", id: w.session.id }, "the Tavern")
		await setPlace(
			w,
			{ kind: "seated_member", id: mira.member.id },
			"the Cellar"
		)
		await setPlace(
			w,
			{ kind: "seated_member", id: bram.member.id },
			"the Tavern"
		)
		const first = await say(w, mira, "Mira calls up the stairs.")
		const last = await say(w, bram, "Bram pours.")
		castNames.participants = ["Mira", "Bram"]

		const seed = await reviewSeed(w, first, last)

		expect(seed.participantCharacters).toEqual([bram.member.id])
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

/** A line stored with the given speaker columns and metadata, and no card. */
async function line(
	w: World,
	values: {
		role?: string
		castMemberId?: number
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

describe("the review's seed — who spoke is what the line stores", () => {
	test("a card-less character seat, a card-less player seat and a side-character turn are seeded", async () => {
		const w = await world(PLAIN)
		const mira = await seat(w, "Mira", false)
		const bram = await seat(w, "Bram", false)
		const grust = await cardlessMember(w, "Grust")
		const ilsa = await cardlessMember(w, "Ilsa")
		const [ilsaSeat] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: w.session.id,
				userId: w.user.id,
				castMemberId: ilsa.id
			} as any)
			.returning()
		const first = await say(w, mira, "Mira looks up.")
		await line(w, { castMemberId: grust.id }, "Grust grunts.")
		await line(
			w,
			{ role: "user", metadata: { speaker: `player-seat:${ilsaSeat.id}` } },
			"I step forward."
		)
		const last = await line(
			w,
			{
				metadata: {
					speaker: `character:${bram.card.id}`,
					sideCharacter: { name: "Bram", characterId: bram.card.id }
				}
			},
			"Bram clears his throat."
		)
		castNames.participants = []
		const before = await memberCount(w.book.id)

		const seed = await reviewSeed(w, first, last)

		expect(sorted(seed.participantCharacters)).toEqual(
			sorted([mira.member.id, grust.id, ilsa.id, bram.member.id])
		)
		expect(await memberCount(w.book.id)).toBe(before)
	})

	test("a line whose member is gone and a plain narrator line seed nobody", async () => {
		const w = await world(PLAIN)
		const mira = await seat(w, "Mira", false)
		const grust = await cardlessMember(w, "Grust")
		const first = await say(w, mira, "Mira looks up.")
		await line(w, { castMemberId: grust.id }, "Grust grunts.")
		await testDb
			.delete(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, grust.id))
		const last = await line(
			w,
			{ metadata: { speaker: "envoy:narrator" } },
			'Pell said, "Two it is." Bram nodded.'
		)
		castNames.participants = ["Pell", "Bram"]

		const seed = await reviewSeed(w, first, last)

		expect(seed.participantCharacters).toEqual([mira.member.id])
	})
})
