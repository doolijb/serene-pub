/**
 * 🚧 A new own book's Timeline follows the genre / preset rule wherever it is made
 * (`insertOwnBook`): the `ownBookFor` fallback, the import's call, the boot pass
 * `ensureOwnBooks`. An explicit switch wins; an existing notes row is never changed.
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
let ownerId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve(), getCryptoSecretKey: () => "own-book-timeline-default-secret" }
})

const STORY_PRESETS = ["core-story-minimal", "core-story-living", "core-story-rule-based"]
const LAIR = "core-lair-default"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-own-book-timeline-default-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "own-book-timeline-owner")).id
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** A session row on a preset (its genre), or on a bare genre id; no notes yet. */
async function session(opts: { seedKey?: string; genreId?: string } = {}) {
	let presetId: number | null = null
	let genreId = opts.genreId
	if (opts.seedKey) {
		const [p] = await db.select().from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, opts.seedKey))
		presetId = p!.id
		genreId = p!.genreId
	}
	const [row] = await db
		.insert(schema.sessions)
		.values({ userId: ownerId, isGroup: false, name: opts.seedKey ?? genreId ?? "bare", presetId, ...(genreId ? { genreId } : {}) } as any)
		.returning()
	return row!
}

const notes = async (sessionId: number) => {
	const [b] = await db.select().from(schema.lorebooks).where(eq(schema.lorebooks.sessionId, sessionId))
	return b
}

async function lairGenreId() {
	const [p] = await db.select().from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, LAIR))
	return p!.genreId
}

describe("the ownBookFor fallback", () => {
	it.each(STORY_PRESETS)("%s: notes start by the preset's own boolean, else off", async (key) => {
		const s = await session({ seedKey: key })
		const [p] = await db.select().from(schema.sessionPresets).where(eq(schema.sessionPresets.id, s.presetId!))
		const pinned = (p!.defaults as { timeline?: unknown } | null)?.timeline
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const made = await ownBookFor(db as any, s.id)
		expect(made.timelineEnabled).toBe(typeof pinned === "boolean" ? pinned : false)
	})
	it("a required genre's notes start on", async () => {
		const s = await session({ seedKey: LAIR })
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		expect((await ownBookFor(db as any, s.id)).timelineEnabled).toBe(true)
	})
	it("never changes an existing notes row", async () => {
		const s = await session({ seedKey: "core-story-minimal" })
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const first = await ownBookFor(db as any, s.id)
		await db.update(schema.lorebooks).set({ timelineEnabled: !first.timelineEnabled }).where(eq(schema.lorebooks.id, first.id))
		expect((await ownBookFor(db as any, s.id)).timelineEnabled).toBe(!first.timelineEnabled)
	})
})

describe("the import's insert (no preset, Story by the column default)", () => {
	it("starts the notes off", async () => {
		const s = await session()
		const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
		await insertOwnBook(db as any, {
			sessionId: s.id,
			userId: ownerId,
			name: s.name,
			overlayOf: s.lorebookId ?? null,
			primaryRuleset: s.primaryRuleset,
			rulesetVersion: s.rulesetVersion ?? null
		})
		expect((await notes(s.id))!.timelineEnabled).toBe(false)
	})
})

describe("insertOwnBook with an explicit switch", () => {
	it("true still gives true for a Story session", async () => {
		const s = await session()
		const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
		const made = await insertOwnBook(db as any, {
			sessionId: s.id,
			userId: ownerId,
			name: s.name,
			overlayOf: null,
			primaryRuleset: s.primaryRuleset,
			rulesetVersion: null,
			timelineEnabled: true
		})
		expect(made.timelineEnabled).toBe(true)
	})
})

describe("ensureOwnBooks", () => {
	it("makes notes by the rule, a second run makes none and changes no switch, existing notes keep theirs", async () => {
		const story = await session()
		const lair = await session({ genreId: await lairGenreId() })
		const had = await session()
		const { insertOwnBook, ensureOwnBooks } = await import("$lib/server/lorebooks/ownBook")
		await insertOwnBook(db as any, {
			sessionId: had.id,
			userId: ownerId,
			name: had.name,
			overlayOf: null,
			primaryRuleset: had.primaryRuleset,
			rulesetVersion: null,
			timelineEnabled: true
		})
		const first = await ensureOwnBooks(db as any)
		expect(first.made).toBeGreaterThanOrEqual(2)
		expect((await notes(story.id))!.timelineEnabled).toBe(false)
		expect((await notes(lair.id))!.timelineEnabled).toBe(true)
		expect((await notes(had.id))!.timelineEnabled).toBe(true)
		const all = await db.select({ id: schema.lorebooks.id, on: schema.lorebooks.timelineEnabled }).from(schema.lorebooks)
		const second = await ensureOwnBooks(db as any)
		expect(second.made).toBe(0)
		const again = await db.select({ id: schema.lorebooks.id, on: schema.lorebooks.timelineEnabled }).from(schema.lorebooks)
		expect(again).toEqual(all)
	})
})
