/**
 * 🚧 **The lorebook annex** (M0, lane S1; SHAPES L9): a book's own
 * owner → document store, written by `core:outlet/set-lorebook-annex@1` and a
 * press on a field declared `scope: 'lorebook'`.
 *
 * Claims, over the real host and the real retraction/settle roads:
 *
 *  1. a session's write on a writable attached book lands in that book, as one
 *     imprint (subject `annex`, field `<owner>/<key>`);
 *  2. a book the session may not write (Review mode) takes the write in the
 *     session's own book, and the session's union read shows it;
 *  3. a swipe takes it back (`retractStateAnchoredTo`); a later person's
 *     change keeps it, the person's value standing;
 *  4. the settle line settles it (status `settled`, nothing to restore);
 *  5. a book-level write (no session) is lasting at once: no imprint;
 *  6. `core:event/lorebook-annex-changed@1` is emitted on both paths;
 *  7. the viewer's view hides a key whose declared `see` excludes them;
 *  8. a session-annex write ignores a `scope: 'lorebook'` field, and
 *     `set-annex-field` on one routes to the lorebook.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { annexField, annexFieldAction } from "@serene-pub/sdk"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

let testDb: TestDb
let dataDir: string

const emitSessionEvent = vi.fn(async () => ({ dispatched: null }))
const notify = vi.fn(async () => {})

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
vi.mock("$lib/server/sockets/utils/broadcastHelpers", async (importOriginal) => ({
	...(await importOriginal<object>()),
	broadcastToSessionUsers: async () => {},
	emitToUserRedacted: async () => {}
}))
vi.mock("$lib/server/pipelines/runtime/sessionEvents", async (importOriginal) => ({
	...(await importOriginal<object>()),
	emitSessionEvent: (...args: unknown[]) => (emitSessionEvent as any)(...args)
}))
vi.mock("$lib/server/plugins/eventHost", async (importOriginal) => ({
	...(await importOriginal<object>()),
	pluginEvents: () => ({ notify: (...args: unknown[]) => (notify as any)(...args) })
}))

const OWNER = "acme.world"
const db = () => testDb as unknown as Db

const FIELDS = () => [
	annexField({ key: "mood", shape: { type: "string" }, see: ["participant"], scope: "lorebook", act: ["participant"] }),
	annexField({ key: "tension", shape: { type: "integer", min: 0 }, see: ["participant"], scope: "lorebook" }),
	annexField({ key: "hidden", shape: { type: "string" }, see: ["owner"], scope: "lorebook" }),
	annexField({ key: "clock", shape: { type: "integer", min: 0 }, see: ["participant"] })
]

const WRITE = { key: "set", definitionId: "core:outlet/set-lorebook-annex", definitionVersion: 1 } as any
const SESSION_WRITE = { key: "set", definitionId: "core:outlet/set-session-annex", definitionVersion: 1 } as any
const PRESS = { key: "press", definitionId: "core:outlet/set-annex-field", definitionVersion: 1 } as any

let n = 0

beforeAll(async () => {
	process.env.SP_PLUGINS_ENABLED = "1"
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-lorebook-annex-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db())
	const manifest = { annexFields: FIELDS() }
	await testDb.insert(schema.plugins).values({
		pluginId: OWNER,
		name: OWNER,
		version: "1.0.0",
		bundleSource: "// none",
		bundleHash: `hash-${OWNER}`,
		enabled: true,
		manifest
	} as any)
	const { registerPluginAnnex } = await import("$lib/server/plugins/pluginAnnex")
	expect(registerPluginAnnex(manifest, OWNER)).toEqual([])
}, 120_000)

afterAll(async () => {
	const { withdrawPluginAnnex } = await import("$lib/server/plugins/pluginAnnex")
	withdrawPluginAnnex(OWNER)
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** A user, their book, a session reading it at `mode`, a guest, and a way to post messages. */
async function world(opts: { mode?: "full" | "review" } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `lbannex-${suffix}`)
	const guest = await createTestUser(testDb, `lbannex-guest-${suffix}`)
	await testDb.insert(schema.userSettings).values({ userId: user.id, loreWriteMode: opts.mode ?? "full" })
	const [book] = await testDb.insert(schema.lorebooks).values({ userId: user.id, name: `World ${suffix}` }).returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, lorebookId: book!.id })
		.returning()
	await testDb.insert(schema.sessionGuests).values({ sessionId: session!.id, userId: guest.id })
	const message = async () => {
		const [legacy] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: session!.id, role: "assistant", content: "…" })
			.returning()
		await testDb.insert(schema.messages).values({ id: legacy!.id, sessionId: session!.id, role: "assistant" })
		return legacy!
	}
	const host = async (runId: string) => {
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		return createHost(db(), { sessionId: session!.id, userId: user.id, specId: `${OWNER}:spec/world`, runId } as any)
	}
	return { user, guest, book: book!, session: session!, message, host }
}

const annexOf = async (lorebookId: number) => {
	const [row] = await testDb
		.select({ annex: schema.lorebooks.annex, audiences: schema.lorebooks.annexAudiences })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
	return { annex: (row!.annex ?? {}) as any, audiences: (row!.audiences ?? {}) as any }
}
const imprints = async (sessionId: number) => {
	const { imprintsOf } = await import("./imprints")
	return imprintsOf(db(), sessionId)
}
const swipe = async (messageId: number) => {
	const { retractStateAnchoredTo } = await import("$lib/server/state/write")
	return retractStateAnchoredTo(db(), messageId, "replaced")
}

describe("a session's lorebook-annex write", () => {
	it("lands in the writable attached book as one imprint, subject annex", async () => {
		const w = await world()
		const m = await w.message()
		const done: any = await (await w.host("run-a")).commit!({ value: { mood: "wary" } }, WRITE)
		expect(done).toMatchObject({ written: true, lorebookId: w.book.id, owner: OWNER })
		const { annex, audiences } = await annexOf(w.book.id)
		expect(annex[OWNER]).toEqual({ mood: "wary" })
		expect(audiences[OWNER]).toEqual({ mood: ["participant"] })
		const filed = await imprints(w.session.id)
		expect(filed.map((i) => [i.subjectKind, i.subjectId, i.field, i.messageId, i.status])).toEqual([
			["annex", w.book.id, `${OWNER}/mood`, m.id, "standing"]
		])
		// An unchanged write writes nothing.
		expect(((await (await w.host("run-b")).commit!({ value: { mood: "wary" } }, WRITE)) as any).written).toBe(false)
		expect(await imprints(w.session.id)).toHaveLength(1)
	}, 60_000)

	it("goes to the session's own book when the attached book is not writable, and the union read shows it", async () => {
		const w = await world({ mode: "review" })
		await w.message()
		await testDb.update(schema.lorebooks).set({ annex: { [OWNER]: { tension: 1, mood: "calm" } } }).where(eq(schema.lorebooks.id, w.book.id))
		const done: any = await (await w.host("run-a")).commit!({ value: { mood: "tense" } }, WRITE)
		const { ownBookOf } = await import("./ownBook")
		const own = (await ownBookOf(db(), w.session.id))!
		expect(done.lorebookId).toBe(own.id)
		expect(own.id).not.toBe(w.book.id)
		expect((await annexOf(w.book.id)).annex[OWNER]).toEqual({ tension: 1, mood: "calm" })
		expect((await annexOf(own.id)).annex[OWNER]).toEqual({ mood: "tense" })
		const { sessionLorebookAnnex, bookLorebookAnnex } = await import("./annex")
		expect(await sessionLorebookAnnex(db(), w.session.id, OWNER)).toEqual({ tension: 1, mood: "tense" })
		expect(await bookLorebookAnnex(db(), w.book.id, OWNER)).toEqual({ tension: 1, mood: "calm" })
	}, 60_000)

	it("is taken back by a swipe; a person's change since keeps it", async () => {
		const w = await world()
		const m = await w.message()
		await (await w.host("run-a")).commit!({ value: { mood: "wary" } }, WRITE)
		const taken = await swipe(m.id)
		expect(taken.changed).toBe(true)
		expect((await annexOf(w.book.id)).annex[OWNER] ?? {}).toEqual({})
		expect(await imprints(w.session.id)).toEqual([])

		const m2 = await w.message()
		await (await w.host("run-b")).commit!({ value: { mood: "wary" } }, WRITE)
		await testDb
			.update(schema.lorebooks)
			.set({ annex: { [OWNER]: { mood: "furious" } } })
			.where(eq(schema.lorebooks.id, w.book.id))
		await swipe(m2.id)
		expect((await annexOf(w.book.id)).annex[OWNER]).toEqual({ mood: "furious" })
		const kept = await imprints(w.session.id)
		expect(kept.map((i) => [i.field, i.status])).toEqual([[`${OWNER}/mood`, "kept"]])
	}, 60_000)

	it("is settled with the stretch", async () => {
		const w = await world()
		const m = await w.message()
		await (await w.host("run-a")).commit!({ value: { mood: "wary" } }, WRITE)
		const { settleThrough } = await import("$lib/server/sessions/settle")
		await db().transaction((tx) => settleThrough(tx as any, w.session.id, m.id, {}))
		const filed = await imprints(w.session.id)
		expect(filed.map((i) => [i.field, i.status, i.before])).toEqual([[`${OWNER}/mood`, "settled", null]])
		expect((await annexOf(w.book.id)).annex[OWNER]).toEqual({ mood: "wary" })
	}, 60_000)
})

describe("🚧 M2b: set-lorebook-annex takes a base", () => {
	it("a stale base writes nothing and answers the fresh document and version; a matching base writes; a swipe moves the version", async () => {
		const w = await world()
		const m = await w.message()
		const READ = { key: "read", definitionId: "core:query/lorebook-annex", definitionVersion: 1 } as any
		const versionNow = async () => ((await w.host("run-read")) as any).read("lorebook_annex_version", { sessionId: w.session.id }, READ)
		expect(await versionNow()).toBe(0)
		const first: any = await (await w.host("run-a")).commit!({ value: { mood: "wary" }, base: 0 }, WRITE)
		expect(first).toMatchObject({ written: true, lorebookId: w.book.id, version: 1 })
		const won: any = await (await w.host("run-b")).commit!({ value: { mood: "tense" }, base: 1 }, WRITE)
		expect(won).toMatchObject({ written: true, version: 2 })
		const lost: any = await (await w.host("run-c")).commit!({ value: { mood: "calm" }, base: 1 }, WRITE)
		expect(lost).toMatchObject({ written: false, stale: true, version: 2, annex: { mood: "tense" } })
		expect(lost.notes?.[0]).toMatch(/moved since this run read it \(version 1, now 2\)/)
		expect((await annexOf(w.book.id)).annex[OWNER]).toEqual({ mood: "tense" })
		// A base that is no count is refused out loud.
		await expect((await w.host("run-d")).commit!({ value: { mood: "x" }, base: -1 }, WRITE)).rejects.toThrow(/base is the annex document version/)
		// Taking the turn back moves the document, so it moves the version.
		await swipe(m.id)
		expect(await versionNow()).toBeGreaterThan(2)
	}, 60_000)
})

describe("a book-level lorebook-annex write", () => {
	it("is lasting at once: no imprint", async () => {
		const w = await world()
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const host = createHost(db(), {
			lorebookId: w.book.id,
			userId: w.user.id,
			specId: `${OWNER}:spec/world`,
			runId: "book-run"
		} as any)
		const done: any = await host.commit!({ value: { tension: 3 } }, WRITE)
		expect(done).toMatchObject({ written: true, lorebookId: w.book.id })
		expect((await annexOf(w.book.id)).annex[OWNER]).toEqual({ tension: 3 })
		expect(await testDb.select().from(schema.loreImprints).where(eq(schema.loreImprints.lorebookId, w.book.id))).toEqual([])
	}, 60_000)

	it("refuses a run with neither a session nor a lorebook", async () => {
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const w = await world()
		const host = createHost(db(), { userId: w.user.id, specId: `${OWNER}:spec/world`, runId: "none" } as any)
		await expect(host.commit!({ value: { mood: "x" } }, WRITE)).rejects.toThrow(
			/run it in a session or on a lorebook/
		)
	}, 60_000)
})

describe("core:event/lorebook-annex-changed@1", () => {
	it("is emitted on both paths, once per change", async () => {
		const w = await world()
		await w.message()
		emitSessionEvent.mockClear()
		notify.mockClear()
		await (await w.host("run-a")).commit!({ value: { mood: "wary", tension: 2 } }, WRITE)
		expect(emitSessionEvent).toHaveBeenCalledTimes(1)
		const call = (emitSessionEvent.mock.calls[0] as unknown as [unknown, any])[1]
		expect(call.event).toBe("core:event/lorebook-annex-changed@1")
		expect(call.payload).toMatchObject({ sessionId: w.session.id, lorebookId: w.book.id, owner: OWNER })
		expect([...call.payload.keys].sort()).toEqual(["mood", "tension"])
		// An unchanged write emits nothing.
		await (await w.host("run-b")).commit!({ value: { mood: "wary" } }, WRITE)
		expect(emitSessionEvent).toHaveBeenCalledTimes(1)

		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const host = createHost(db(), { lorebookId: w.book.id, userId: w.user.id, specId: `${OWNER}:spec/world`, runId: "book" } as any)
		await host.commit!({ value: { tension: 9 } }, WRITE)
		expect(notify).toHaveBeenCalledTimes(1)
		expect((notify.mock.calls[0] as unknown as [unknown, string, any])[1]).toBe("core:event/lorebook-annex-changed@1")
		expect((notify.mock.calls[0] as unknown as [unknown, string, any])[2]).toMatchObject({
			lorebookId: w.book.id,
			owner: OWNER,
			keys: ["tension"]
		})
		expect(emitSessionEvent).toHaveBeenCalledTimes(1)
	}, 60_000)
})

describe("the viewer's view", () => {
	it("hides a key whose declared audience excludes the viewer", async () => {
		const w = await world()
		await w.message()
		await (await w.host("run-a")).commit!({ value: { mood: "wary" } }, WRITE)
		// `hidden` is for the owner alone, by its declaration.
		await (await w.host("run-b")).commit!({ value: { hidden: "the vault code" } }, WRITE)
		const { lorebookAnnexViewFor } = await import("./annex")
		expect(await lorebookAnnexViewFor(db(), w.session.id, w.guest.id)).toEqual({ [OWNER]: { mood: "wary" } })
		expect(await lorebookAnnexViewFor(db(), w.session.id, w.user.id)).toEqual({
			[OWNER]: { mood: "wary", hidden: "the vault code" }
		})
		const stranger = await (await import("$lib/server/utils/testDb")).createTestUser(testDb, `lbannex-stranger-${++n}`)
		expect(await lorebookAnnexViewFor(db(), w.session.id, stranger.id)).toBeNull()
	}, 60_000)
})

describe("scope: 'lorebook' fields", () => {
	it("a session-annex write ignores them", async () => {
		const w = await world()
		await expect(
			(await w.host("run-a")).commit!({ value: { mood: "wary" } }, SESSION_WRITE)
		).rejects.toThrow(/'mood' is not a key '.*' declares/)
	}, 60_000)

	it("a press on one routes to the lorebook, not the session", async () => {
		const w = await world()
		await w.message()
		await (await w.host("run-a")).commit!(
			{ payload: { field: annexFieldAction(OWNER, "mood"), value: "elated" } },
			PRESS
		)
		expect((await annexOf(w.book.id)).annex[OWNER]).toEqual({ mood: "elated" })
		const [session] = await testDb.select({ annex: schema.sessions.annex }).from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect((session!.annex ?? {}) as any).toEqual({})
	}, 60_000)
})
