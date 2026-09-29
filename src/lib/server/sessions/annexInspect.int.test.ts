/**
 * The session data panel's read (`sessions:annexInspect`, owner-approved
 * 2026-09-26), through the real handler over PGlite:
 *  1. the session's owner and an administrator are answered; a member who
 *     is not the owner is refused by sentence (and so is anyone asking
 *     after a session that does not exist);
 *  2. declared keys are grouped by owner (core first), each with its
 *     declaration and stored value; an unset key says so; another genre's
 *     field is not this session's;
 *  3. stored keys no declaration covers — an undeclared key, an unknown
 *     owner's document — are listed as legacy;
 *  4. a value whose shape holds a secret is never sent, declared or not.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { annexField, type AnnexFieldDecl } from "@serene-pub/sdk"

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

let ownerId: number
let guestId: number
let adminId: number
let sessionId: number

async function install(pluginId: string, fields: unknown[]) {
	await db.insert(schema.plugins).values({
		pluginId,
		name: pluginId,
		version: "1.0.0",
		bundleSource: "// none",
		bundleHash: `hash-${pluginId}`,
		enabled: true,
		manifest: { annexFields: fields }
	} as any)
}

/** Drive the real handler; collect what it emits to the asker. */
async function ask(user: { id: number; isAdmin?: boolean }, sid = sessionId) {
	const { sessionsAnnexInspectHandler } = await import("$lib/server/sockets/sessions")
	const emits: Array<{ event: string; data: any }> = []
	await sessionsAnnexInspectHandler.handler(
		{ user } as any,
		{ sessionId: sid },
		(event: string, data: any) => {
			emits.push({ event, data })
		}
	)
	return emits
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-annex-inspect-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb

	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "annex-inspect-owner")).id
	guestId = (await createTestUser(db, "annex-inspect-guest")).id
	adminId = (await createTestUser(db, "annex-inspect-admin")).id
	await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, adminId))

	await install("acme.dice", [
		annexField({
			key: "last-roll",
			shape: { type: "integer", min: 1, max: 20 },
			see: ["person"],
			act: ["participant"],
			label: "Last roll"
		}),
		annexField({ key: "streak", shape: { type: "integer" } }),
		annexField({ key: "adventure-only", shape: { type: "string" }, genre: "core:genre/adventure" })
	])
	// A stored manifest an SDK check would refuse: a secret-shaped key. The
	// declaration is skipped, so its stored value reads as legacy — withheld.
	await install("acme.vault", [{ __decl: "annex-field", key: "token", shape: { type: "secret" }, see: [] }])

	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: false,
			name: "annex inspect",
			annex: {
				"acme.dice": { "last-roll": 17, "old-key": "from before" },
				"acme.vault": { token: "sk-live-123" },
				"user:gone": { note: "hello" }
			}
		} as any)
		.returning()
	sessionId = session.id
	await db.insert(schema.sessionGuests).values({ sessionId, userId: guestId })
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("sessions:annexInspect — who may read it", () => {
	it("answers the session's owner", async () => {
		const emits = await ask({ id: ownerId })
		expect(emits.map((e) => e.event)).toEqual(["sessions:annexInspect"])
		expect(emits[0]!.data.sessionId).toBe(sessionId)
	})

	it("answers an administrator who is not in the session", async () => {
		const emits = await ask({ id: adminId, isAdmin: true })
		expect(emits.map((e) => e.event)).toEqual(["sessions:annexInspect"])
	})

	it("refuses a member who is not the owner, by sentence, with nothing else", async () => {
		const emits = await ask({ id: guestId })
		expect(emits).toEqual([
			{
				event: "sessions:annexInspect:error",
				data: {
					sessionId,
					error: "Only the session's owner or an administrator can see its stored data."
				}
			}
		])
	})

	it("refuses a session that does not exist with the same sentence", async () => {
		const emits = await ask({ id: guestId }, 999_999)
		expect(emits[0]!.event).toBe("sessions:annexInspect:error")
		expect(emits[0]!.data.error).toMatch(/owner or an administrator/)
	})
})

describe("sessions:annexInspect — what it returns", () => {
	it("groups declared keys by owner, with declaration and stored value", async () => {
		const [{ data }] = await ask({ id: ownerId })
		const dice = data.groups.find((g: any) => g.owner === "acme.dice")
		expect(dice.fields.map((f: any) => f.key)).toEqual(["last-roll", "streak"])
		expect(dice.fields[0]).toMatchObject({
			key: "last-roll",
			label: "Last roll",
			shape: { type: "integer", min: 1, max: 20 },
			see: ["person"],
			act: ["participant"],
			hasValue: true,
			value: 17
		})
		// Pipelines-written only, and nothing stored yet.
		expect(dice.fields[1]).toMatchObject({ key: "streak", see: [], act: null, hasValue: false })
		expect(dice.fields[1]).not.toHaveProperty("value")
		// An owner whose only field was refused declares nothing here.
		expect(data.groups.find((g: any) => g.owner === "acme.vault")).toBeUndefined()
	})

	it("lists every undeclared stored key as legacy, and withholds a secret one", async () => {
		const [{ data }] = await ask({ id: ownerId })
		expect(data.legacy).toEqual([
			{ owner: "acme.dice", key: "old-key", value: "from before" },
			{ owner: "acme.vault", key: "token", withheld: true },
			{ owner: "user:gone", key: "note", value: "hello" }
		])
		expect(JSON.stringify(data)).not.toContain("sk-live-123")
	})
})

describe("groupAnnex — pure", () => {
	it("puts core first and withholds a declared secret-shaped value", async () => {
		const { groupAnnex } = await import("./annexInspect")
		const decl = (key: string, shape: any) =>
			({ __decl: "annex-field", key, shape, see: ["owner"] }) as unknown as AnnexFieldDecl
		const out = groupAnnex(
			{ zeta: { a: 1 }, core: { clock: 3 }, alpha: { pin: "1234" } },
			[
				{ owner: "zeta", identity: "zeta:annex#a", decl: decl("a", { type: "integer" }) },
				{ owner: "alpha", identity: "alpha:annex#pin", decl: decl("pin", { type: "secret" }) },
				{ owner: "core", identity: "core:annex#clock", decl: decl("clock", { type: "integer" }) }
			]
		)
		expect(out.groups.map((g) => g.owner)).toEqual(["core", "alpha", "zeta"])
		const pin = out.groups[1]!.fields[0]!
		expect(pin).toMatchObject({ hasValue: true, withheld: true })
		expect(pin).not.toHaveProperty("value")
		expect(out.legacy).toEqual([])
	})

	it("an owner entry that is not a document is legacy, shown whole", async () => {
		const { groupAnnex } = await import("./annexInspect")
		expect(groupAnnex({ odd: 5 }, []).legacy).toEqual([{ owner: "odd", key: null, value: 5 }])
		expect(groupAnnex(null, [])).toEqual({ groups: [], legacy: [] })
	})
})
