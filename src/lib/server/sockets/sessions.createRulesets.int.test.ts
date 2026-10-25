/**
 * 🚧 Session creation applies the genre's ruleset defaults (PLAN-rulesets §4,
 * §13): a session attached to a lorebook adopts the lorebook's own ruleset
 * (a book on Freeform, every book's default, brings none — fix7); with
 * none, the person's pick, else the genre's default ruleset (strict's first,
 * recommended's `default`), else Story; How strict is the genre's
 * `rigour.default`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "sessions-create-rulesets-test-secret" }
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

const STORY = "core:ruleset/freeform@1"
const VIS_ITINERIS = "core:ruleset/vis-itineris@1"

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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-create-rulesets-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "rulesets-creator")).id
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function create(session: Record<string, unknown>, extra: Record<string, unknown> = {}) {
	const { sessionsCreateHandler } = await import("./sessions")
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{ session, characterIds: [], personaIds: [], characterPositions: {}, tags: [], ...extra } as any,
		() => {}
	)
	expect(res?.error, res?.error).toBeUndefined()
	const [row] = await db
		.select({
			primaryRuleset: schema.sessions.primaryRuleset,
			rigour: schema.sessions.rigour
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, res.session.id))
	return row!
}

describe("sessions:create — the genre's ruleset defaults", () => {
	it("Chat: Story, prose", async () => {
		expect(await create({ name: "A chat", genreId: "core:genre/story" })).toEqual({
			primaryRuleset: STORY,
			rigour: "prose"
		})
	})

	it("Dungeon Crawler: Vis Itineris (its recommended default), scripts — whatever rigour the client sent outside its options", async () => {
		const [preset] = await db
			.select({ id: schema.sessionPresets.id })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, "core-dungeon-crawler-default"))
		expect(await create({ name: "A crawl", presetId: preset!.id, rigour: "nonsense" })).toEqual({
			primaryRuleset: VIS_ITINERIS,
			rigour: "scripts"
		})
	})

	/** A book, a character and a persona of the owner's. */
	async function bookAndCast(name: string, primaryRuleset?: string) {
		const [book] = await db
			.insert(schema.lorebooks)
			.values({ userId: ownerId, name, ...(primaryRuleset ? { primaryRuleset } : {}) })
			.returning()
		const [character] = await db
			.insert(schema.characters)
			.values({ userId: ownerId, name: "Wren", description: "" })
			.returning()
		const [persona] = await db
			.insert(schema.characters)
			.values({ userId: ownerId, name: "Ann", description: "", isPersona: true })
			.returning()
		return { book: book!, cast: { characterIds: [character!.id], personaIds: [persona!.id] } }
	}

	it("Story with a lorebook on Freeform (every book's default): the book brings no rules, so the pick stands (fix7)", async () => {
		const { book, cast } = await bookAndCast("Umberwood")
		expect(book.primaryRuleset).toBe(STORY)
		expect(
			await create(
				{ name: "An adventure", genreId: "core:genre/story", lorebookId: book.id, primaryRuleset: VIS_ITINERIS },
				cast
			)
		).toEqual({ primaryRuleset: VIS_ITINERIS, rigour: "prose" })
		// No pick: the genre's default, as with no book.
		expect(await create({ name: "Another", genreId: "core:genre/story", lorebookId: book.id }, cast)).toEqual({
			primaryRuleset: STORY,
			rigour: "prose"
		})
	})

	it("the Lair with a lorebook on Freeform: the person's Rules and How strict (fix7, owner: \"In lair, I can't choose a ruleset\")", async () => {
		const { book, cast } = await bookAndCast("Undercroft")
		expect(
			await create({ name: "A lair", genreId: "core:genre/lair", lorebookId: book.id, primaryRuleset: VIS_ITINERIS }, cast)
		).toEqual({ primaryRuleset: VIS_ITINERIS, rigour: "mechanics" })
	})

	it("a lorebook with rules of its own: the session adopts them, and the pick loses", async () => {
		const { book, cast } = await bookAndCast("Drowned Coast", VIS_ITINERIS)
		expect(
			await create(
				{ name: "A coast", genreId: "core:genre/lair", lorebookId: book.id, primaryRuleset: "core:ruleset/wherewithal@1" },
				cast
			)
		).toEqual({ primaryRuleset: VIS_ITINERIS, rigour: "mechanics" })
	})
})

describe("the form's Rules and How strict", () => {
	it("sessions:create takes the person's Rules and How strict picks", async () => {
		const [preset] = await db
			.select({ id: schema.sessionPresets.id })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, "core-dungeon-crawler-default"))
		expect(await create({ name: "A told crawl", presetId: preset!.id, primaryRuleset: STORY, rigour: "prose" })).toEqual({
			primaryRuleset: STORY,
			rigour: "prose"
		})
	})

	it("sessions:genres offers each genre's Rules and How strict; Chat none", async () => {
		const { sessionsModesHandler } = await import("./sessions")
		const res: any = await sessionsModesHandler.handler(fakeSocket(ownerId), {} as any, () => {})
		const crawl = res.genres.find((g: any) => g.genreId.startsWith("core:genre/dungeon-crawler"))
		expect(crawl.rules.choices[0]).toMatchObject({ id: VIS_ITINERIS, recommended: true })
		expect(crawl.rules.choices.find((c: any) => c.id === STORY)).toMatchObject({ subtitle: "Words decide; no numbers." })
		expect(crawl.rules.rigour).toEqual({ options: ["prose", "mechanics", "scripts"], default: "scripts" })
		// Chat is the assistant (2026-10-19): no rules. Story, which took in
		// Adventure, offers them.
		expect(res.genres.find((g: any) => g.genreId === "core:genre/chat").rules).toBeUndefined()
		expect(res.genres.find((g: any) => g.genreId === "core:genre/story").rules).toBeTruthy()
	})

	// How strict may change mid-session (PLAN-rulesets §21) — kept by the
	// main session's ruling of 2026-10-20 over R32's gloss; a layer that
	// locks it (Rule Based) still holds (A10).
	it("sessions:update changes How strict mid-session, and refuses one the genre does not offer", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const [made] = await db
			.insert(schema.sessions)
			.values({ userId: ownerId, isGroup: false, name: "Strictness", genreId: "core:genre/story", rigour: "prose" } as any)
			.returning()
		const id = made!.id
		await sessionsUpdateHandler.handler(fakeSocket(ownerId), { session: { id, rigour: "mechanics" } } as any, () => {})
		const [row] = await db.select({ rigour: schema.sessions.rigour }).from(schema.sessions).where(eq(schema.sessions.id, id))
		expect(row!.rigour).toBe("mechanics")
		const errors: unknown[] = []
		await sessionsUpdateHandler
			.handler(fakeSocket(ownerId), { session: { id, rigour: "nonsense" } } as any, (e: string, d: unknown) => {
				if (e.endsWith(":error")) errors.push(d)
			})
			.catch(() => {})
		expect(JSON.stringify(errors)).toContain("How strict must be Words only, Rules or The rules decide.")
	})

	it("a How strict a layer locks is refused mid-session in a sentence (Rule Based); the same value is no change", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const [preset] = await db
			.select({ id: schema.sessionPresets.id })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, "core-story-rule-based"))
		const [made] = await db
			.insert(schema.sessions)
			.values({ userId: ownerId, isGroup: false, name: "Locked strictness", genreId: "core:genre/story", presetId: preset!.id, rigour: "scripts" } as any)
			.returning()
		const id = made!.id
		const errors: unknown[] = []
		const collect = (e: string, d: unknown) => {
			if (e.endsWith(":error")) errors.push(d)
		}
		await sessionsUpdateHandler.handler(fakeSocket(ownerId), { session: { id, rigour: "scripts" } } as any, collect).catch((e: Error) => errors.push(e.message))
		expect(errors).toEqual([])
		await sessionsUpdateHandler.handler(fakeSocket(ownerId), { session: { id, rigour: "prose" } } as any, collect).catch((e: Error) => errors.push(e.message))
		const [row] = await db.select({ rigour: schema.sessions.rigour }).from(schema.sessions).where(eq(schema.sessions.id, id))
		expect(row!.rigour).toBe("scripts")
		expect(JSON.stringify(errors)).toContain("How strict is set by the session's preset and cannot be changed here.")
	})

	it("switching to a preset that pins How strict writes it — only one the session's rules can play", async () => {
		const { sessionsSetSessionPresetHandler } = await import("./sessions")
		const presetOf = async (seedKey: string) =>
			(await db.select({ id: schema.sessionPresets.id }).from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, seedKey)))[0]!.id
		const living = await presetOf("core-story-living")
		const ruleBased = await presetOf("core-story-rule-based")
		const made = async (primaryRuleset: string) =>
			(
				await db
					.insert(schema.sessions)
					.values({ userId: ownerId, isGroup: false, name: "Switching", genreId: "core:genre/story", presetId: living, primaryRuleset, rigour: "prose" } as any)
					.returning()
			)[0]!.id
		const rigourOf = async (id: number) =>
			(await db.select({ rigour: schema.sessions.rigour }).from(schema.sessions).where(eq(schema.sessions.id, id)))[0]!.rigour
		const dice = await made(VIS_ITINERIS)
		const res: any = await sessionsSetSessionPresetHandler.handler(fakeSocket(ownerId), { sessionId: dice, presetId: ruleBased } as any, () => {})
		expect(res?.error).toBeUndefined()
		expect(await rigourOf(dice)).toBe("scripts")
		// Rule Based over Freeform: its rules play Words only, so the pin is not written.
		const words = await made("core:ruleset/freeform@1")
		await sessionsSetSessionPresetHandler.handler(fakeSocket(ownerId), { sessionId: words, presetId: ruleBased } as any, () => {})
		expect(await rigourOf(words)).toBe("prose")
	})

	it("🚧 R32: a rigour a preset locks is taken at creation whatever was sent (Rule Based, dice rules)", async () => {
		const [preset] = await db
			.select({ id: schema.sessionPresets.id })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, "core-story-rule-based"))
		expect(await create({ name: "By the book", presetId: preset!.id, primaryRuleset: VIS_ITINERIS, rigour: "prose" })).toMatchObject({
			primaryRuleset: VIS_ITINERIS,
			rigour: "scripts"
		})
	})
})
