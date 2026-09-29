/**
 * Annex fields over the real door (2026-09-26): a plugin declares
 * `annexField({ key, shape, see, act })` in its manifest, the host lists it
 * as `<owner>:annex#<key>` at the `widget` venue, and a press — what a
 * widget's `invoke(id, { payload: { value } })` sends — runs core's one
 * pipeline, `core:spec/set-annex-field`, which writes through the same annex
 * write as `set-session-annex`.
 *
 * Pinned, every one through `fireAction` (the `sessions:fireAction`
 * door) and the run it starts:
 *  1. a declared field saves, the run is receipted, `annex-changed` is
 *     recorded, and each member's annex view is re-sent with the value;
 *  2. the declared audience is respected — an AI-only field is in nobody's
 *     person view;
 *  3. a value its shape refuses is refused with the validator's sentence;
 *  4. a presser outside `act` is refused (and not offered the action);
 *  5. an undeclared key — or another package's — is refused by name;
 *  6. plugins off (the flag, or the plugin switched off) refuses the press;
 *  7. the outlet judges the payload again rather than trusting it.
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

/** Every per-member push, resolved — what each member's tab would be sent. */
const pushes: Array<{ userId: number; event: string; data: any }> = []
vi.mock("$lib/server/sockets/utils/broadcastHelpers", async (importOriginal) => ({
	...(await importOriginal<object>()),
	broadcastToSessionUsers: async () => {},
	emitToUserRedacted: async (_io: unknown, userId: number, event: string, data: unknown) => {
		pushes.push({
			userId,
			event,
			data: typeof data === "function" ? await (data as () => Promise<unknown>)() : data
		})
	}
}))

const OWNER = "acme.dice"
const fakeIo = {} as any

let ownerId: number
let guestId: number
let sessionId: number

async function install(pluginId: string, fields: unknown[], enabled = true) {
	await db.insert(schema.plugins).values({
		pluginId,
		name: pluginId,
		version: "1.0.0",
		bundleSource: "// none",
		bundleHash: `hash-${pluginId}`,
		enabled,
		manifest: { annexFields: fields }
	} as any)
}

const press = async (
	userId: number,
	action: string,
	payload: Record<string, unknown> | undefined
) => {
	const { fireAction } = await import("$lib/server/pipelines/runtime/fireAction")
	return fireAction(db as any, { sessionId, action, payload, actor: { userId }, io: fakeIo })
}

const annexRow = async () => {
	const [row] = await db
		.select({ annex: schema.sessions.annex, audiences: schema.sessions.annexAudiences })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return { annex: (row!.annex ?? {}) as any, audiences: (row!.audiences ?? {}) as any }
}

beforeAll(async () => {
	process.env.SP_PLUGINS_ENABLED = "1"
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-annex-fields-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "annex-fields-owner")).id
	guestId = (await createTestUser(db, "annex-fields-guest")).id
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: ownerId, isGroup: false, name: "annex fields" })
		.returning()
	sessionId = session.id
	await db.insert(schema.sessionGuests).values({ sessionId, userId: guestId })

	await install(OWNER, [
		annexField({
			key: "last-roll",
			shape: { type: "integer", min: 1, max: 20 },
			see: ["person"],
			act: ["participant"]
		}),
		annexField({ key: "mood", shape: { type: "enum", of: ["calm", "tense"] }, see: ["ai"], act: ["owner"] }),
		annexField({ key: "tally", shape: { type: "integer" }, see: ["person"], act: ["owner"] }),
		annexField({
			key: "adventure-only",
			shape: { type: "string" },
			genre: "core:genre/adventure"
		})
	])
	await install(
		"acme.off",
		[annexField({ key: "note", shape: { type: "string" }, see: ["person"], act: ["owner"] })],
		false
	)
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("annex fields — a widget sets a declared value through core's one pipeline", () => {
	it("is listed at the widget venue for whoever may set it", async () => {
		const { listSessionActions } = await import("$lib/server/pipelines/entities/sessionActions")
		const ids = (v: any) =>
			[...v.widget.primary, ...v.widget.overflow].map((a: any) => `${a.specSlug}#${a.key}`)
		const forOwner = ids(await listSessionActions(db as any, sessionId, { userId: ownerId }))
		expect(forOwner).toContain(annexFieldAction(OWNER, "last-roll"))
		expect(forOwner).toContain(annexFieldAction(OWNER, "tally"))
		// Another genre's field is not this session's.
		expect(forOwner).not.toContain(annexFieldAction(OWNER, "adventure-only"))
		const forGuest = ids(await listSessionActions(db as any, sessionId, { userId: guestId }))
		expect(forGuest).toContain(annexFieldAction(OWNER, "last-roll"))
		// `tally` is set by the owner only (its `act`).
		expect(forGuest).not.toContain(annexFieldAction(OWNER, "tally"))
	})

	it("saves a declared field: receipted, annex-changed recorded, every member's view re-sent", async () => {
		pushes.length = 0
		const out = await press(guestId, annexFieldAction(OWNER, "last-roll"), { value: 17 })
		expect(out.kind).toBe("ran")
		if (out.kind !== "ran") return
		expect(out.specId).toBe("core:spec/set-annex-field")
		expect(out.receipt.outcome).toBe("ok")

		const { annex, audiences } = await annexRow()
		expect(annex[OWNER]).toEqual({ "last-roll": 17 })
		expect(audiences[OWNER]).toEqual({ "last-roll": ["person"] })

		const { settleSessionEvents } = await import("$lib/server/pipelines/runtime/sessionEvents")
		await settleSessionEvents()
		const changes = await db
			.select()
			.from(schema.sessionChanges)
			.where(eq(schema.sessionChanges.sessionId, sessionId))
		expect(
			changes.some(
				(c) => c.event === "core:event/annex-changed@1" && (c.payload as any)?.owner === OWNER
			)
		).toBe(true)

		// The viewer's view updated — pushed to each member, their own view.
		const views = pushes.filter((p) => p.event === "sessions:annex")
		expect(views.map((p) => p.userId).sort()).toEqual([ownerId, guestId].sort())
		for (const v of views) expect(v.data).toEqual({ sessionId, annex: { [OWNER]: { "last-roll": 17 } } })
	})

	it("respects the declared audience: an AI-only field is in nobody's person view", async () => {
		const out = await press(ownerId, annexFieldAction(OWNER, "mood"), { value: "tense" })
		expect(out.kind === "ran" && out.receipt.outcome).toBe("ok")
		const { annex, audiences } = await annexRow()
		expect(annex[OWNER].mood).toBe("tense")
		expect(audiences[OWNER].mood).toEqual(["ai"])
		const { annexViewFor } = await import("$lib/server/sessions/annexViews")
		for (const uid of [ownerId, guestId]) {
			const view = await annexViewFor(db as any, sessionId, uid)
			expect(view?.[OWNER]).toEqual({ "last-roll": 17 })
		}
	})

	it("refuses a value its shape refuses, with the validator's sentence", async () => {
		const wrongType = await press(ownerId, annexFieldAction(OWNER, "last-roll"), { value: "seven" })
		expect(wrongType).toEqual({ kind: "refused", error: expect.stringMatching(/should be a number/) })
		const tooHigh = await press(ownerId, annexFieldAction(OWNER, "last-roll"), { value: 21 })
		expect(tooHigh).toEqual({ kind: "refused", error: expect.stringMatching(/above the maximum 20/) })
		const noValue = await press(ownerId, annexFieldAction(OWNER, "last-roll"), {})
		expect(noValue).toEqual({ kind: "refused", error: expect.stringMatching(/payload: \{ value \}/) })
		expect((await annexRow()).annex[OWNER]["last-roll"]).toBe(17)
	})

	it("refuses a presser outside `act`", async () => {
		const out = await press(guestId, annexFieldAction(OWNER, "tally"), { value: 3 })
		expect(out.kind).toBe("refused")
		expect((await annexRow()).annex[OWNER].tally).toBeUndefined()
		// The owner may.
		const mine = await press(ownerId, annexFieldAction(OWNER, "tally"), { value: 3 })
		expect(mine.kind === "ran" && mine.receipt.outcome).toBe("ok")
	})

	it("refuses an undeclared key, another package's namespace, and another genre's field", async () => {
		const undeclared = await press(ownerId, annexFieldAction(OWNER, "nope"), { value: 1 })
		expect(undeclared).toEqual({
			kind: "refused",
			error: expect.stringMatching(/'nope' is not an annex field 'acme.dice' declares/)
		})
		const foreign = await press(ownerId, annexFieldAction("other.pkg", "last-roll"), { value: 1 })
		expect(foreign).toEqual({
			kind: "refused",
			error: expect.stringMatching(/'last-roll' is not an annex field 'other.pkg' declares/)
		})
		const otherGenre = await press(ownerId, annexFieldAction(OWNER, "adventure-only"), { value: "x" })
		expect(otherGenre.kind).toBe("refused")
	})

	it("refuses every press while plugins are off — the flag, or the plugin switched off", async () => {
		const switchedOff = await press(ownerId, annexFieldAction("acme.off", "note"), { value: "hi" })
		expect(switchedOff).toEqual({
			kind: "refused",
			error: expect.stringMatching(/not available while its plugin is turned off/)
		})
		delete process.env.SP_PLUGINS_ENABLED
		try {
			const flagOff = await press(ownerId, annexFieldAction(OWNER, "last-roll"), { value: 5 })
			expect(flagOff).toEqual({
				kind: "refused",
				error: expect.stringMatching(/not available while its plugin is turned off/)
			})
		} finally {
			process.env.SP_PLUGINS_ENABLED = "1"
		}
		expect((await annexRow()).annex[OWNER]["last-roll"]).toBe(17)
		expect((await annexRow()).annex["acme.off"]).toBeUndefined()
	})

	it("the outlet judges the payload again — an undeclared field or a bad value halts the write", async () => {
		const { createHost, HostScopeError } = await import("$lib/server/pipelines/runtime/host")
		const host = createHost(db as any, {
			sessionId,
			userId: ownerId,
			specId: "core:spec/set-annex-field",
			runId: "run-annex-field-direct"
		} as any)
		const node = { key: "write", definitionId: "core:outlet/set-annex-field", definitionVersion: 1 } as any
		await expect(
			host.commit!({ payload: { field: annexFieldAction(OWNER, "nope"), value: 1 } }, node)
		).rejects.toThrow(HostScopeError)
		await expect(
			host.commit!({ payload: { field: annexFieldAction(OWNER, "last-roll"), value: 99 } }, node)
		).rejects.toThrow(/above the maximum 20/)
		await expect(host.commit!({ payload: { field: "acme.dice:spec/x#y", value: 1 } }, node)).rejects.toThrow(
			/not an annex field's identity/
		)
		expect((await annexRow()).annex[OWNER]["last-roll"]).toBe(17)
	})
})
