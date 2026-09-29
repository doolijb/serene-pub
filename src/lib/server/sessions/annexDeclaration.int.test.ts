/**
 * One annex declaration per owner (owner ruling 2026-09-26), over the real
 * host: every key an owner keeps in the session annex is declared once — its
 * shape, who may see it, and who (if anyone) may set it — and every write and
 * every view is held to that declaration.
 *
 * Pinned:
 *  1. an undeclared key is refused at the publish (`validate()` through
 *     `saveDocument`) and at the write (`set-session-annex`), by name;
 *  2. the audience stored with a value is the declaration's — a step names
 *     no audience of its own;
 *  3. a settable key (`act`) works through the ready-made action; a
 *     pipeline-only key is not offered and a press of it is refused;
 *  4. legacy data — a stored key no declaration covers, even one stored with
 *     an audience — stays in the annex for pipelines, is in no person's or
 *     the AI's view, and survives a `merge: false` write.
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

let db: TestDb
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
vi.mock("$lib/server/sockets/utils/broadcastHelpers", async (importOriginal) => ({
	...(await importOriginal<object>()),
	broadcastToSessionUsers: async () => {},
	emitToUserRedacted: async () => {}
}))

const OWNER = "acme.keep"
const fakeIo = {} as any

let ownerId: number
let guestId: number
let sessionId: number

const FIELDS = () => [
	annexField({ key: "clock", shape: { type: "integer", min: 0 }, see: ["person"] }),
	annexField({ key: "culprit", shape: { type: "string" } }),
	annexField({ key: "hunch", shape: { type: "string" }, see: ["ai"] }),
	annexField({
		key: "last-roll",
		shape: { type: "integer", min: 1, max: 20 },
		see: ["participant"],
		act: ["participant"]
	})
]

const host = async (specId = `${OWNER}:spec/keep`) => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(db as any, {
		sessionId,
		userId: ownerId,
		specId,
		runId: `run-${Math.random().toString(36).slice(2)}`
	} as any)
}
const WRITE = { key: "keep", definitionId: "core:outlet/set-session-annex", definitionVersion: 1 } as any

const annexRow = async () => {
	const [row] = await db
		.select({ annex: schema.sessions.annex, audiences: schema.sessions.annexAudiences })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return { annex: (row!.annex ?? {}) as any, audiences: (row!.audiences ?? {}) as any }
}

beforeAll(async () => {
	process.env.SP_PLUGINS_ENABLED = "1"
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-annex-decl-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "annex-decl-owner")).id
	guestId = (await createTestUser(db, "annex-decl-guest")).id
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: false,
			name: "annex declaration",
			// Legacy data: two keys written before the ruling, one of them
			// stored with an audience everybody could see.
			annex: { [OWNER]: { "old-note": "kept", "old-score": 4 } },
			annexAudiences: { [OWNER]: { "old-note": ["participant"] } }
		} as any)
		.returning()
	sessionId = session.id
	await db.insert(schema.sessionGuests).values({ sessionId, userId: guestId })

	const manifest = { annexFields: FIELDS() }
	await db.insert(schema.plugins).values({
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
})

afterAll(async () => {
	const { withdrawPluginAnnex } = await import("$lib/server/plugins/pluginAnnex")
	withdrawPluginAnnex(OWNER)
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("one annex declaration per owner — writes", () => {
	it("refuses an undeclared key at the publish, by name", async () => {
		const { compile, spec, use } = await import("@serene-pub/sdk")
		const C = await import("@serene-pub/contracts")
		const { saveDocument } = await import("$lib/server/pipelines/boot/store")
		const build = (value: Record<string, unknown>) =>
			compile(
				spec(`${OWNER}:spec/publish-${Object.keys(value).join("-")}`, { version: "1.0.0" })
					.inlet("input", C.userMessage.v1(), {
						genre: use("core:genre/chat"),
						event: "core:event/message-respond@1"
					})
					.outlet("keep", () => C.setSessionAnnex.v1({ value: value as never }))
					.build()
			)
		await expect(saveDocument(db as any, build({ plot: "x" }), { publish: true })).rejects.toThrow(
			/'plot' is not a key 'acme.keep' declares in its annex/
		)
		await expect(saveDocument(db as any, build({ clock: 1 }), { publish: true })).resolves.toBeTruthy()
	})

	it("refuses an undeclared key at the write, by name, and writes nothing", async () => {
		const h = await host()
		await expect(h.commit!({ value: { clock: 1, plot: "x" } }, WRITE)).rejects.toThrow(
			/refused — 'plot' is not a key 'acme.keep' declares in its annex/
		)
		expect((await annexRow()).annex[OWNER].clock).toBeUndefined()
		// Another owner's document, named with sharedAnnex, is held to ITS declaration.
		await expect(
			h.commit!({ value: { x: 1 }, params: { owner: "someone.else", sharedAnnex: true } }, WRITE)
		).rejects.toThrow(/'x' is not a key 'someone.else' declares/)
		// A value its declared shape refuses.
		await expect(h.commit!({ value: { clock: -1 } }, WRITE)).rejects.toThrow(/below the minimum 0/)
	})

	it("stores the declaration's audience", async () => {
		const h = await host()
		const out: any = await h.commit!({ value: { clock: 3, culprit: "the butler", hunch: "the garden" } }, WRITE)
		expect(out.written).toBe(true)
		const { annex, audiences } = await annexRow()
		expect(annex[OWNER]).toMatchObject({ clock: 3, culprit: "the butler", hunch: "the garden" })
		expect(audiences[OWNER].clock).toEqual(["person"])
		expect(audiences[OWNER].hunch).toEqual(["ai"])
		expect(audiences[OWNER].culprit).toBeUndefined()
	})
})

describe("one annex declaration per owner — presses", () => {
	it("a settable key works through the ready-made action", async () => {
		const { fireAction } = await import("$lib/server/pipelines/runtime/fireAction")
		const out = await fireAction(db as any, {
			sessionId,
			action: annexFieldAction(OWNER, "last-roll"),
			payload: { value: 12 },
			actor: { userId: guestId },
			io: fakeIo
		})
		expect(out.kind === "ran" && out.receipt.outcome).toBe("ok")
		const { annex, audiences } = await annexRow()
		expect(annex[OWNER]["last-roll"]).toBe(12)
		expect(audiences[OWNER]["last-roll"]).toEqual(["participant"])
	})

	it("a pipeline-only key is not offered, and a press of it is refused", async () => {
		const { listSessionActions } = await import("$lib/server/pipelines/entities/sessionActions")
		const offered = await listSessionActions(db as any, sessionId, { userId: ownerId })
		const ids = [...offered.widget.primary, ...offered.widget.overflow].map(
			(a: any) => `${a.specSlug}#${a.key}`
		)
		expect(ids).toContain(annexFieldAction(OWNER, "last-roll"))
		expect(ids).not.toContain(annexFieldAction(OWNER, "clock"))
		const { fireAction } = await import("$lib/server/pipelines/runtime/fireAction")
		const out = await fireAction(db as any, {
			sessionId,
			action: annexFieldAction(OWNER, "clock"),
			payload: { value: 9 },
			actor: { userId: ownerId },
			io: fakeIo
		})
		expect(out).toEqual({
			kind: "refused",
			error: expect.stringMatching(/'clock' is set by 'acme.keep''s pipelines only/)
		})
		expect((await annexRow()).annex[OWNER].clock).toBe(3)
	})
})

describe("one annex declaration per owner — legacy data", () => {
	it("stays readable by pipelines, is in nobody's view, and survives a replace", async () => {
		const h = await host()
		const read = (q: Record<string, unknown>) =>
			(h as any).read("session_annex", { sessionId, ...q }, {
				key: "annex",
				definitionId: "core:query/session-annex",
				definitionVersion: 1
			})
		// A pipeline reads it, exactly as before.
		expect(await read({})).toMatchObject({ "old-note": "kept", "old-score": 4 })
		// The AI's view: declared `ai` keys only — never the legacy note, whatever was stored beside it.
		const ai = await read({ view: "ai" })
		expect(ai).toMatchObject({ hunch: "the garden" })
		expect(ai["old-note"]).toBeUndefined()
		// A person's view: the declared `person` and `participant` keys, never legacy.
		const { annexViewFor } = await import("$lib/server/sessions/annexViews")
		expect(await annexViewFor(db as any, sessionId, guestId)).toEqual({
			[OWNER]: { clock: 3, "last-roll": 12 }
		})
		// It cannot be written again…
		await expect(h.commit!({ value: { "old-score": 5 } }, WRITE)).rejects.toThrow(
			/'old-score' is not a key 'acme.keep' declares/
		)
		// …and a replace (merge off) drops the declared keys it leaves out, never the legacy ones.
		await h.commit!({ value: { clock: 6 }, params: { merge: false } }, WRITE)
		const { annex, audiences } = await annexRow()
		expect(annex[OWNER]).toEqual({ clock: 6, "old-note": "kept", "old-score": 4 })
		expect(audiences[OWNER]).toEqual({ clock: ["person"], "old-note": ["participant"] })
	})
})
