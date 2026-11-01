/**
 * Spoken audio in the media module (speech build, lane C4; verified by lane V).
 *
 * Spoken files are a DERIVED class: hidden from the default listing, culled with
 * the derived forms, never an original, cleared per session or pub-wide, and
 * swept by the "Keep spoken audio" retention setting.
 */
import { beforeAll, afterAll, afterEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, inArray } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import { MediaVariant } from "$lib/shared/constants/MediaVisibility"
import type { TestDb } from "$lib/server/utils/testDb"

// DB setup and the first createMedia (wasm compile) are slow under load.
vi.setConfig({ testTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

function png(seed: number): Buffer {
	const p = new PNG({ width: 4, height: 4 })
	for (let i = 0; i < p.data.length; i += 4) {
		p.data[i] = seed
		p.data[i + 1] = (i * 7) % 255
		p.data[i + 2] = 90
		p.data[i + 3] = 255
	}
	return PNG.sync.write(p)
}

const sock = (id: number, isAdmin = false) => ({ user: { id, isAdmin } }) as any
const noop = () => {}

let admin: number
let owner: number
let stranger: number
let sessA: number
let sessB: number
let seed = 10

async function mk(opts: {
	userId: number
	sessionId?: number | null
	meta?: Record<string, unknown> | null
	bytes?: Buffer
}) {
	const { createMedia } = await import("$lib/server/media")
	const { file } = await createMedia(db, {
		userId: opts.userId,
		bytes: opts.bytes ?? png(seed++),
		...(opts.sessionId != null
			? { sessionId: opts.sessionId }
			: { bucket: "generated" }),
		meta: opts.meta === undefined ? null : opts.meta
	})
	return file
}
const spoken = (userId: number, sessionId: number | null) =>
	mk({ userId, sessionId, meta: { spoken: true } })

async function exists(fileId: number) {
	const [r] = await db.select().from(schema.files).where(eq(schema.files.id, fileId))
	return !!r
}
async function variantRows(fileId: number) {
	return db.select().from(schema.variants).where(eq(schema.variants.fileId, fileId))
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-spoken-int-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	const { createTestUser } = await import("$lib/server/utils/testDb")
	admin = (await createTestUser(db, "spk-admin")).id
	await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, admin))
	owner = (await createTestUser(db, "spk-owner")).id
	stranger = (await createTestUser(db, "spk-stranger")).id
	const mkSession = async () =>
		(
			await db
				.insert(schema.sessions)
				.values({ userId: owner, name: "S", isGroup: false })
				.returning()
		)[0].id
	sessA = await mkSession()
	sessB = await mkSession()
	const existing = await db.select().from(schema.systemSettings).limit(1)
	if (!existing.length) await db.insert(schema.systemSettings).values({ id: 1 })
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function wipe() {
	// Each describe starts from no files so counts are exact.
	const rows = await db.select({ id: schema.files.id }).from(schema.files)
	const ids = rows.map((r) => r.id)
	if (ids.length) {
		await db.delete(schema.variants).where(inArray(schema.variants.fileId, ids))
		await db.delete(schema.files).where(inArray(schema.files.id, ids))
	}
}

describe("media:list", () => {
	test("default excludes spoken; includeSpoken includes; null meta listed", async () => {
		await wipe()
		const { mediaList } = await import("./media")
		const plain = await mk({ userId: owner, meta: null })
		const withMeta = await mk({ userId: owner, meta: { other: 1 } })
		const sp = await spoken(owner, sessA)
		const ids = (r: any) => r.media.map((m: any) => m.id)
		const def = await mediaList.handler(sock(owner), {}, noop)
		expect(ids(def)).toContain(plain.id)
		expect(ids(def)).toContain(withMeta.id)
		expect(ids(def)).not.toContain(sp.id)
		const inc = await mediaList.handler(sock(owner), { includeSpoken: true }, noop)
		expect(ids(inc)).toContain(sp.id)
		expect(ids(inc)).toContain(plain.id)
	})
})

describe("cull", () => {
	test("cullDerived removes spoken files (row, bytes, thumbs); originals never see spoken", async () => {
		await wipe()
		const { mediaCullDerived } = await import("./media")
		const { cullableDerived, cullableOriginals } = await import("$lib/server/media/cull")
		const { ensureVariant } = await import("$lib/server/media")
		const { resolveMediaPath } = await import("$lib/server/media/paths")
		const sp = await spoken(owner, sessA)
		const plain = await mk({ userId: owner })
		await ensureVariant(db, sp, MediaVariant.THUMB)
		const rows = await variantRows(sp.id)
		expect(rows.length).toBeGreaterThanOrEqual(2)
		const abs = rows.map((r) => resolveMediaPath(r.path))
		for (const a of abs) await fs.access(a)

		const derived = await cullableDerived(owner)
		expect(derived.spokenFileIds).toEqual([sp.id])
		const orig = await cullableOriginals(owner)
		const origJson = JSON.stringify(orig)
		expect(origJson.includes(`"fileId":${sp.id}`)).toBe(false)
		expect(JSON.stringify(orig).includes(`"id":${sp.id},`)).toBe(false)

		const res = await mediaCullDerived.handler(sock(owner), {}, noop)
		expect(res.spokenFiles).toBe(1)
		expect(res.bytes).toBeGreaterThan(0)
		expect(await exists(sp.id)).toBe(false)
		expect((await variantRows(sp.id)).length).toBe(0)
		for (const a of abs) await expect(fs.access(a)).rejects.toBeTruthy()
		expect(await exists(plain.id)).toBe(true)
	})
})

describe("media:spokenSummary / media:clearSpoken", () => {
	test("per session: owner and admin allowed, stranger refused; counts correct; others untouched", async () => {
		await wipe()
		const { mediaSpokenSummary, mediaClearSpoken } = await import("./media")
		const a1 = await spoken(owner, sessA)
		const a2 = await spoken(owner, sessA)
		const b1 = await spoken(owner, sessB)
		const plain = await mk({ userId: owner, sessionId: sessA, meta: null })
		const sum = await mediaSpokenSummary.handler(sock(owner), { sessionId: sessA }, noop)
		expect(sum.count).toBe(2)
		expect(sum.sessionId).toBe(sessA)
		const expectBytes = (await variantRows(a1.id)).concat(await variantRows(a2.id)).reduce((s, v) => s + v.bytes, 0)
		expect(sum.bytes).toBe(expectBytes)
		const adminSum = await mediaSpokenSummary.handler(sock(admin, true), { sessionId: sessA }, noop)
		expect(adminSum.count).toBe(2)
		await expect(
			mediaSpokenSummary.handler(sock(stranger), { sessionId: sessA }, noop)
		).rejects.toThrow()
		await expect(
			mediaClearSpoken.handler(sock(stranger), { sessionId: sessA }, noop)
		).rejects.toThrow()
		expect(await exists(a1.id)).toBe(true)

		const cleared = await mediaClearSpoken.handler(sock(owner), { sessionId: sessA }, noop)
		expect(cleared.cleared).toBe(2)
		expect(cleared.bytes).toBe(expectBytes)
		expect(await exists(a1.id)).toBe(false)
		expect(await exists(a2.id)).toBe(false)
		expect(await exists(b1.id)).toBe(true)
		expect(await exists(plain.id)).toBe(true)
	})

	test("pub-wide: admin allowed, member refused", async () => {
		await wipe()
		const { mediaSpokenSummary, mediaClearSpoken } = await import("./media")
		const a = await spoken(owner, sessA)
		const b = await spoken(owner, sessB)
		await expect(mediaSpokenSummary.handler(sock(owner), {}, noop)).rejects.toThrow()
		await expect(mediaClearSpoken.handler(sock(owner), {}, noop)).rejects.toThrow()
		expect(await exists(a.id)).toBe(true)
		const sum = await mediaSpokenSummary.handler(sock(admin, true), {}, noop)
		expect(sum.count).toBe(2)
		expect(sum.sessionId).toBeNull()
		const out = await mediaClearSpoken.handler(sock(admin, true), {}, noop)
		expect(out.cleared).toBe(2)
		expect(await exists(a.id)).toBe(false)
		expect(await exists(b.id)).toBe(false)
	})

	test("dedupe: three message lines sharing one file are all cleared by one Clear", async () => {
		await wipe()
		const { mediaClearSpoken } = await import("./media")
		const { createMedia } = await import("$lib/server/media")
		const bytes = png(200)
		const first = await createMedia(db, { userId: owner, bytes, sessionId: sessA, meta: { spoken: true } })
		const again = await createMedia(db, { userId: owner, bytes, sessionId: sessA, meta: { spoken: true } })
		expect(again.file.id).toBe(first.file.id)
		const msgs = []
		for (let i = 0; i < 3; i++) {
			const [m] = await db
				.insert(schema.messages)
				.values({
					sessionId: sessA,
					role: "assistant",
					content: "x",
					parts: [{ type: "core:audio", media: { uuid: first.file.uuid } }]
				} as any)
				.returning()
			msgs.push(m)
		}
		const out = await mediaClearSpoken.handler(sock(owner), { sessionId: sessA }, noop)
		expect(out.cleared).toBe(1)
		expect(await exists(first.file.id)).toBe(false)
		// every line now names a missing file
		for (const m of msgs) {
			const [row] = await db.select().from(schema.messages).where(eq(schema.messages.id, m.id))
			expect(row).toBeTruthy()
		}
	})
})

describe("media:setKeepSpokenAudio", () => {
	test("accepts forever, archived, 1, 3650 and round-trips through system_settings", async () => {
		const { mediaSetKeepSpokenAudio } = await import("./media")
		const s = await import("$lib/server/media/spoken")
		for (const keep of ["forever", "archived", 1, 3650] as const) {
			const r = await mediaSetKeepSpokenAudio.handler(sock(admin, true), { keep }, noop)
			expect(r.keep).toBe(keep)
			expect(await s.readKeepSpokenAudio(db)).toBe(keep)
			const [row] = await db.select().from(schema.systemSettings).limit(1)
			expect(row.keepSpokenAudio).toBe(String(keep))
			expect(s.parseKeepSpokenAudio(s.formatKeepSpokenAudio(keep))).toBe(keep)
		}
	})
	test("rejects 0, 3651, 1.5 and a member caller", async () => {
		const { mediaSetKeepSpokenAudio } = await import("./media")
		const s = await import("$lib/server/media/spoken")
		await s.writeKeepSpokenAudio(db, "forever")
		for (const keep of [0, 3651, 1.5, -1, "soon"] as any[]) {
			await expect(
				mediaSetKeepSpokenAudio.handler(sock(admin, true), { keep }, noop)
			).rejects.toThrow()
		}
		await expect(
			mediaSetKeepSpokenAudio.handler(sock(owner), { keep: 5 }, noop)
		).rejects.toThrow()
		expect(await s.readKeepSpokenAudio(db)).toBe("forever")
	})
	test("parse falls back to forever on junk", async () => {
		const s = await import("$lib/server/media/spoken")
		expect(s.parseKeepSpokenAudio("0")).toBe("forever")
		expect(s.parseKeepSpokenAudio("3651")).toBe("forever")
		expect(s.parseKeepSpokenAudio("abc")).toBe("forever")
		expect(s.parseKeepSpokenAudio(" 30 ")).toBe(30)
	})
})

describe("sweepSpokenAudio", () => {
	const DAY = 24 * 60 * 60 * 1000
	test("forever keeps all", async () => {
		await wipe()
		const { sweepSpokenAudio } = await import("$lib/server/media/spokenRetention")
		const s = await import("$lib/server/media/spoken")
		await s.writeKeepSpokenAudio(db, "forever")
		const f = await spoken(owner, sessA)
		await db.update(schema.files).set({ createdAt: new Date(0) }).where(eq(schema.files.id, f.id))
		const r = await sweepSpokenAudio(db, new Date())
		expect(r.cleared).toBe(0)
		expect(await exists(f.id)).toBe(true)
	})
	test("archived deletes only spoken files of archived sessions", async () => {
		await wipe()
		const { sweepSpokenAudio } = await import("$lib/server/media/spokenRetention")
		const s = await import("$lib/server/media/spoken")
		const [arch] = await db
			.insert(schema.sessions)
			.values({ userId: owner, name: "Arch", isGroup: false, archivedAt: new Date() })
			.returning()
		const inArchived = await spoken(owner, arch.id)
		const inLive = await spoken(owner, sessA)
		const noSession = await spoken(owner, null)
		const plainArchived = await mk({ userId: owner, sessionId: arch.id, meta: null })
		await s.writeKeepSpokenAudio(db, "archived")
		const r = await sweepSpokenAudio(db, new Date())
		expect(r.cleared).toBe(1)
		expect(await exists(inArchived.id)).toBe(false)
		expect(await exists(inLive.id)).toBe(true)
		expect(await exists(noSession.id)).toBe(true)
		expect(await exists(plainArchived.id)).toBe(true)
		await s.writeKeepSpokenAudio(db, "forever")
	})
	test("N days: boundary kept at N days - 1 ms, deleted at N days + 1 ms; non-spoken never touched", async () => {
		await wipe()
		const { sweepSpokenAudio } = await import("$lib/server/media/spokenRetention")
		const s = await import("$lib/server/media/spoken")
		const now = new Date("2026-10-28T12:00:00.000Z")
		const N = 7
		const young = await spoken(owner, sessA)
		const old = await spoken(owner, sessA)
		const plainOld = await mk({ userId: owner, sessionId: sessA, meta: null })
		const set = (id: number, d: Date) =>
			db.update(schema.files).set({ createdAt: d }).where(eq(schema.files.id, id))
		await set(young.id, new Date(now.getTime() - N * DAY + 1))
		await set(old.id, new Date(now.getTime() - N * DAY - 1))
		await set(plainOld.id, new Date(0))
		await s.writeKeepSpokenAudio(db, N)
		const r = await sweepSpokenAudio(db, now)
		expect(r.cleared).toBe(1)
		expect(await exists(young.id)).toBe(true)
		expect(await exists(old.id)).toBe(false)
		expect(await exists(plainOld.id)).toBe(true)
		await s.writeKeepSpokenAudio(db, "forever")
	})
})

describe("retention timer", () => {
	afterEach(async () => {
		const m = await import("$lib/server/media/spokenRetention")
		m.stopSpokenRetention()
		vi.useRealTimers()
	})
	test("start twice -> one timer; stop clears it", async () => {
		vi.useFakeTimers()
		const m = await import("$lib/server/media/spokenRetention")
		expect(vi.getTimerCount()).toBe(0)
		m.startSpokenRetention()
		m.startSpokenRetention()
		expect(vi.getTimerCount()).toBe(1)
		m.stopSpokenRetention()
		expect(vi.getTimerCount()).toBe(0)
		m.stopSpokenRetention() // idempotent
		m.startSpokenRetention()
		expect(vi.getTimerCount()).toBe(1)
	})
})
