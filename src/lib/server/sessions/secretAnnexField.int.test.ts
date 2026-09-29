/**
 * An AI-only annex field a genre's pipelines write once and read back — the
 * Twenty Questions secret (owner ruling 2026-09-27), over the real host.
 *
 * The declaration is the plugin's own (`serene-pub-plugin-twenty-questions`
 * `src/secretAnnex.ts`), copied: an `object`-shaped `secret`, `see: ['ai']`,
 * no `act`, scoped to the genre. Pinned:
 *  1. the create spec's `set-session-annex` writes it (shape checked) under
 *     the declared audience; a later turn's `{}` write changes nothing;
 *  2. the AI view (`view: 'ai'`, with or without a speaker) carries it;
 *  3. no member's view — the owner's, a guest's — carries it;
 *  4. the Session data panel (owner/admin) lists it, as a declared field;
 *  5. a new game's write replaces it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { annexField } from "@serene-pub/sdk"

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

const OWNER = "showcase.twenty-questions"
const GENRE = `${OWNER}:genre/twenty-questions`

const SECRET_FIELD = () =>
	annexField({
		key: "secret",
		shape: {
			type: "object",
			fields: {
				secretEntryId: { type: "integer", min: 0 },
				secretEntryName: { type: "string" },
				secretEntryText: { type: "string" },
				secretEntryAliases: { type: "list", item: { type: "string" } }
			}
		},
		see: ["ai"],
		genre: GENRE
	})

const CLOCKTOWER = {
	secretEntryId: 11,
	secretEntryName: "The Clocktower",
	secretEntryText: "A brass clocktower over the harbour.",
	secretEntryAliases: ["clocktower", "the tower"]
}

let ownerId: number
let guestId: number
let sessionId: number

const host = async (spec: string) => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(db as any, {
		sessionId,
		userId: ownerId,
		specId: `${OWNER}:spec/${spec}`,
		runId: `run-${Math.random().toString(36).slice(2)}`
	} as any)
}
const WRITE = { key: "remember", definitionId: "core:outlet/set-session-annex", definitionVersion: 1 } as any
const READ = { key: "gather.annex.read", definitionId: "core:query/session-annex", definitionVersion: 1 }

const stored = async () => {
	const [row] = await db
		.select({ annex: schema.sessions.annex, audiences: schema.sessions.annexAudiences })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return { annex: (row!.annex ?? {}) as any, audiences: (row!.audiences ?? {}) as any }
}

beforeAll(async () => {
	process.env.SP_PLUGINS_ENABLED = "1"
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-secret-annex-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "secret-annex-owner")).id
	guestId = (await createTestUser(db, "secret-annex-guest")).id
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: ownerId, isGroup: false, name: "twenty questions", genreId: GENRE } as any)
		.returning()
	sessionId = session.id
	await db.insert(schema.sessionGuests).values({ sessionId, userId: guestId })

	const manifest = { annexFields: [SECRET_FIELD()] }
	await db.insert(schema.plugins).values({
		pluginId: OWNER,
		name: OWNER,
		version: "0.1.0",
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

describe("an AI-only secret, written once and read back", () => {
	it("the create run writes it, under the declared audience; a turn's empty write changes nothing", async () => {
		const created: any = await (await host("create-session")).commit!({ value: { secret: CLOCKTOWER } }, WRITE)
		expect(created.written).toBe(true)
		const { annex, audiences } = await stored()
		expect(annex[OWNER]).toEqual({ secret: CLOCKTOWER })
		expect(audiences[OWNER]).toEqual({ secret: ["ai"] })

		const turn: any = await (await host("respond")).commit!({ value: {} }, WRITE)
		expect(turn.written).toBe(false)
		expect((await stored()).annex[OWNER]).toEqual({ secret: CLOCKTOWER })
	})

	it("refuses a value its shape refuses", async () => {
		await expect(
			(await host("respond")).commit!({ value: { secret: { secretEntryId: "eleven" } } }, WRITE)
		).rejects.toThrow(/refused/)
	})

	it("the AI view carries it — the respond speaker's and the referee's", async () => {
		for (const [spec, speaker] of [
			["respond", "character:7"],
			["judge-guess", "envoy:referee"],
			["respond", undefined]
		] as const) {
			const h: any = await host(spec)
			const view = await h.read("session_annex", { sessionId, view: "ai", ...(speaker ? { speaker } : {}) }, READ)
			expect(view).toEqual({ secret: CLOCKTOWER })
		}
	})

	it("no member's view carries it — not the owner's, not a guest's", async () => {
		const { annexViewFor } = await import("$lib/server/sessions/annexViews")
		for (const userId of [ownerId, guestId]) {
			const view = await annexViewFor(db as any, sessionId, userId)
			expect(view).toEqual({})
			expect(JSON.stringify(view)).not.toContain("Clocktower")
		}
	})

	it("the Session data panel lists it for the owner, as a declared field; a guest is refused", async () => {
		const { inspectAnnex } = await import("$lib/server/sessions/annexInspect")
		const mine = await inspectAnnex(db as any, sessionId, { id: ownerId })
		expect(mine.ok).toBe(true)
		expect(JSON.stringify(mine)).toContain("The Clocktower")
		const theirs = await inspectAnnex(db as any, sessionId, { id: guestId })
		expect(theirs.ok).toBe(false)
	})

	it("a new game's create run replaces it", async () => {
		const lighthouse = { ...CLOCKTOWER, secretEntryId: 21, secretEntryName: "The Lighthouse", secretEntryAliases: [] }
		const out: any = await (await host("create-session")).commit!({ value: { secret: lighthouse } }, WRITE)
		expect(out.written).toBe(true)
		expect((await stored()).annex[OWNER]).toEqual({ secret: lighthouse })
	})
})

/**
 * Typed templates P6 (2026-09-27): a template CAN reference the secret —
 * `{{annex.[showcase.twenty-questions].secret.secretEntryName}}`, a Handlebars
 * segment literal for the dotted owner — through the template view on
 * Assemble's `annex` port. Twenty Questions itself does not (its secret still
 * reaches the prompt as the `secretEntry` band); this pins that the road
 * exists and carries only what a declaration covers.
 */
describe("P6 · a template reads the secret through the template view", () => {
	const templateView = async () => {
		const { coreBindings } = await import("$lib/server/pipelines/runtime/bindings")
		const h: any = await host("respond")
		const out: any = await coreBindings()["core:query/session-annex@1"]!(
			{ scope: { sessionId }, view: "template" } as any,
			{ read: (table: string, q: any) => h.read(table, q, READ) } as any
		)
		expect(out.kind).toBe("ok")
		return out.value.main
	}

	it("carries the declared key of an enabled owner in scope — not a legacy key, not a switched-off plugin's", async () => {
		await db.insert(schema.plugins).values({
			pluginId: "acme.off",
			name: "acme.off",
			version: "0.1.0",
			bundleSource: "// none",
			bundleHash: "hash-acme.off",
			enabled: false,
			manifest: { annexFields: [annexField({ key: "note", shape: { type: "string" } })] }
		} as any)
		await db
			.update(schema.sessions)
			.set({
				annex: {
					[OWNER]: { secret: CLOCKTOWER, legacyNote: "stored before any declaration" },
					"acme.off": { note: "its plugin is switched off" },
					"user:my-spec": { anything: "undeclared owner" }
				}
			})
			.where(eq(schema.sessions.id, sessionId))
		expect(await templateView()).toEqual({ [OWNER]: { secret: CLOCKTOWER } })
	})

	it("renders through Assemble's annex port", async () => {
		const { coreBindings } = await import("$lib/server/pipelines/runtime/bindings")
		const { CORE_TEMPLATE_ENGINE } = await import("$lib/server/pipelines/prompt/renderers")
		const result: any = await coreBindings()["core:task/assemble@2"]!(
			{
				template: {
					source: `Thinking of: {{annex.[${OWNER}].secret.secretEntryName}}{{annex.[${OWNER}].legacyNote}}`,
					engine: CORE_TEMPLATE_ENGINE
				},
				decisions: [],
				messages: [{ id: 1, role: "user", content: "is it alive?" }],
				budget: { total: 100 },
				annex: await templateView()
			} as any,
			{ countTokens: (t: string) => t.length } as any
		)
		expect(result.kind).toBe("ok")
		expect(result.value.context.rendered).toBe("Thinking of: The Clocktower")
	})
})
