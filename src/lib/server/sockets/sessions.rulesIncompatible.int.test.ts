/**
 * 🚧 Rules a genre can't play are refused, never offered as a choice (owner
 * 2026-11-05: "Always lock out Incompatible, no setting"). The fixture is the
 * Lair declared as using dice (`uses.dice: "required"`), so Freeform — which
 * has none — rates Incompatible for it and Vis Itineris does not. No core
 * genre rates a core ruleset Incompatible today.
 *
 * A preset's ruleset is a default, never a lock: the person's pick wins.
 * A next chapter is never re-judged for its rules.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { BOOK_LOCK_REFUSAL } from "$lib/shared/lorebooks/sessionNotes"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string

vi.mock("@serene-pub/sdk", async (importOriginal) => {
	const real = await importOriginal<typeof import("@serene-pub/sdk")>()
	return {
		...real,
		getGenre: (id: string) => {
			const g = real.getGenre(id)
			return g && id === "core:genre/lair"
				? {
						...g,
						uses: { ...(g.uses as object), dice: "required" },
						rulesets: {
							recommended: ["core:ruleset/vis-itineris@1"],
							default: "core:ruleset/vis-itineris@1"
						}
					}
				: g
		}
	}
})
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		db,
		getCryptoSecretKey: () => "sessions-rules-incompatible-test-secret"
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
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

const FREEFORM = "core:ruleset/freeform@1"
const VIS_ITINERIS = "core:ruleset/vis-itineris@1"
const WHEREWITHAL = "core:ruleset/wherewithal@1"
const LAIR = "core:genre/lair"
const STORY = "core:genre/story"
/** The refusal for the fixture genre on Freeform, in the helper's own words. */
const LAIR_CANT_PLAY_FREEFORM =
	"Lair can't play Freeform: missing dice with no fallback."

/** Wherewithal rolls no dice either; its reason is the SDK's own sentence. */
const WHEREWITHAL_REASON = "missing dice with no fallback"
const WHEREWITHAL_REFUSAL = `Lair can't play Wherewithal: ${WHEREWITHAL_REASON}.`

let ownerId: number
const fakeSocket = (uid: number) =>
	({
		user: { id: uid, isAdmin: false },
		io: {
			sockets: {
				adapter: { rooms: { get: () => undefined } },
				sockets: { get: () => undefined, values: () => [].values() }
			},
			to: () => ({ emit: () => {} })
		}
	}) as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-rules-incompatible-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "rules-incompatible")).id
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** Calls sessions:create and returns the raw response (refusals included). */
async function createRaw(
	session: Record<string, unknown>,
	extra: Record<string, unknown> = {}
): Promise<any> {
	const { sessionsCreateHandler } = await import("./sessions")
	return sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{
			session,
			characterIds: [],
			personaIds: [],
			characterPositions: {},
			tags: [],
			...extra
		} as any,
		() => {}
	)
}

async function rulesOf(sessionId: number) {
	const [row] = await db
		.select({ primaryRuleset: schema.sessions.primaryRuleset })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return row!.primaryRuleset
}

const sessionCount = async () =>
	(await db.select({ id: schema.sessions.id }).from(schema.sessions)).length

async function cast() {
	const [character] = await db
		.insert(schema.characters)
		.values({ userId: ownerId, name: "Wren", description: "" })
		.returning()
	const [persona] = await db
		.insert(schema.characters)
		.values({
			userId: ownerId,
			name: "Ann",
			description: "",
			isPersona: true
		})
		.returning()
	return { characterIds: [character!.id], personaIds: [persona!.id] }
}

async function bookOn(
	name: string,
	primaryRuleset: string,
	kind?: "starter_kit"
) {
	const [book] = await db
		.insert(schema.lorebooks)
		.values({
			userId: ownerId,
			name,
			primaryRuleset,
			...(kind ? { kind } : {})
		} as any)
		.returning()
	return book!
}

describe("the fixture genre", () => {
	it("rates Freeform Incompatible and Vis Itineris not", async () => {
		const { getGenre, getRuleset, rulesetFit } = await import(
			"@serene-pub/sdk"
		)
		const rate = (id: string) =>
			rulesetFit(getGenre(LAIR) as any, getRuleset(id) as any).rating
		expect(rate(FREEFORM)).toBe("incompatible")
		expect(rate(VIS_ITINERIS)).not.toBe("incompatible")
		const { rulesetIncompatibleRefusal } = await import(
			"$lib/server/rulesets/bookRules"
		)
		expect(rulesetIncompatibleRefusal(LAIR, FREEFORM)).toBe(
			LAIR_CANT_PLAY_FREEFORM
		)
	})
})

describe("sessions:create refuses Incompatible rules", () => {
	it("a blank pick on Incompatible rules is refused, never swapped to the default; no session is made", async () => {
		const before = await sessionCount()
		const res = await createRaw(
			{ name: "A lair", genreId: LAIR, primaryRuleset: FREEFORM },
			await cast()
		)
		expect(res.error).toBe(LAIR_CANT_PLAY_FREEFORM)
		expect(await sessionCount()).toBe(before)
	})

	it("rules the genre can play are taken as picked", async () => {
		const res = await createRaw(
			{ name: "A lair", genreId: LAIR, primaryRuleset: VIS_ITINERIS },
			await cast()
		)
		expect(res.error).toBeUndefined()
		expect(await rulesOf(res.session.id)).toBe(VIS_ITINERIS)
	})

	it("a lorebook told by Incompatible rules is refused in words", async () => {
		const book = await bookOn("Dry Coast", WHEREWITHAL)
		const before = await sessionCount()
		const res = await createRaw(
			{ name: "A lair", genreId: LAIR, lorebookId: book.id },
			await cast()
		)
		expect(res.error).toBe(WHEREWITHAL_REFUSAL)
		expect(await sessionCount()).toBe(before)
	})

	it("a starter lorebook on Incompatible rules is refused in words", async () => {
		const kit = await bookOn("Dry Start", WHEREWITHAL, "starter_kit")
		const before = await sessionCount()
		const res = await createRaw(
			{ name: "A lair", genreId: LAIR },
			{ ...(await cast()), starterKit: { lorebookId: kit.id } }
		)
		expect(res.error).toBe(WHEREWITHAL_REFUSAL)
		expect(await sessionCount()).toBe(before)
	})

	it("a next chapter on such a book is allowed: no running story is re-judged for its rules", async () => {
		const book = await bookOn("Old Coast", WHEREWITHAL)
		const [followed] = await db
			.insert(schema.sessions)
			.values({
				userId: ownerId,
				isGroup: false,
				name: "Chapter one",
				genreId: LAIR,
				lorebookId: book.id,
				primaryRuleset: WHEREWITHAL
			} as any)
			.returning()
		const res = await createRaw(
			{ name: "Chapter two", genreId: LAIR },
			{ ...(await cast()), mode: "next-chapter", from: followed!.id }
		)
		expect(res.error, res.error).toBeUndefined()
		expect(await rulesOf(res.session.id)).toBe(WHEREWITHAL)
	})
})

describe("attaching a lorebook later is refused: the session keeps the lorebook it started with", () => {
	async function bareSession(name: string) {
		const [made] = await db
			.insert(schema.sessions)
			.values({
				userId: ownerId,
				isGroup: false,
				name,
				genreId: LAIR,
				primaryRuleset: VIS_ITINERIS
			} as any)
			.returning()
		return made!.id
	}
	const lorebookOf = async (id: number) =>
		(
			await db
				.select({ lorebookId: schema.sessions.lorebookId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, id))
		)[0]!.lorebookId

	it("sessions:update refuses it on a session with no messages", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const book = await bookOn("Dry Update", WHEREWITHAL)
		const id = await bareSession("Attach by update")
		await expect(
			sessionsUpdateHandler.handler(
				fakeSocket(ownerId),
				{ session: { id, lorebookId: book.id } } as any,
				() => {}
			)
		).rejects.toThrow(BOOK_LOCK_REFUSAL)
		expect(await lorebookOf(id)).toBeNull()
	})
})

describe("a preset's ruleset is a default, never a lock (owner 2026-11-05)", () => {
	async function presetPinning(genreId: string, ruleset: string) {
		const [preset] = await db
			.insert(schema.sessionPresets)
			.values({
				name: `Old lock on ${ruleset}`,
				genreId,
				bindings: {},
				settings: { ruleset: { value: ruleset, lock: true } }
			} as any)
			.returning()
		return preset!.id
	}

	it("an old preset stored with a lock: no pick gets its value; the person's pick wins", async () => {
		const presetId = await presetPinning(STORY, VIS_ITINERIS)
		const none = await createRaw({ name: "Default", presetId })
		expect(none.error, none.error).toBeUndefined()
		expect(await rulesOf(none.session.id)).toBe(VIS_ITINERIS)
		const picked = await createRaw({
			name: "Picked",
			presetId,
			primaryRuleset: FREEFORM
		})
		expect(picked.error, picked.error).toBeUndefined()
		expect(await rulesOf(picked.session.id)).toBe(FREEFORM)
	})

	it("a preset's default the genre can't play falls through to the genre's default, silently", async () => {
		const presetId = await presetPinning(LAIR, FREEFORM)
		const res = await createRaw(
			{ name: "Lair default", presetId },
			await cast()
		)
		expect(res.error, res.error).toBeUndefined()
		expect(await rulesOf(res.session.id)).toBe(VIS_ITINERIS)
	})
})
