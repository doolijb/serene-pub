/**
 * 🚧 A next chapter's carried annex keys are stored under the card form of a
 * declared `seated-member:<memberId>` audience (plan §27 S3, lane s27-S3C,
 * worker w1): the door (`storedSeatRef`) runs before the audience is stored,
 * a member no seat of the new session holds is dropped, and today's card-form
 * and role audiences are stored as before.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { annexField } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import { insertLegacy } from "$lib/server/messages/store"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { memberFormSwitch } from "$lib/server/state/memberForm"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
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
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-creation-seated-audience-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const switchWas = memberFormSwitch.on
afterEach(() => {
	memberFormSwitch.on = switchWas
})

let runs = 0

/** One next chapter seeded from a chapter whose annex fields declare audiences. */
async function scenario() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(
		testDb,
		`creation-seated-audience-${++runs}`
	)
	const [card] = await testDb
		.insert(schema.characters)
		.values({
			userId: owner.id,
			name: "Verity",
			description: "A card."
		} as any)
		.returning()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: "Book" } as any)
		.returning()
	const [member] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: book!.id,
			characterId: card!.id,
			binding: "{{char:1}}",
			name: "member"
		} as any)
		.returning()
	const pluginId = `s3audience${runs}.rp`
	await testDb.insert(schema.plugins).values({
		pluginId,
		name: pluginId,
		version: "1.0.0",
		bundleSource: "// none",
		bundleHash: `hash-${pluginId}`,
		enabled: true,
		manifest: {
			annexFields: [
				annexField({
					key: "oath",
					shape: { type: "string" },
					see: [
						`seated-member:${member!.id}`,
						`seated-member:${member!.id + 9999}`
					],
					nextChapter: true
				}),
				annexField({
					key: "vow",
					shape: { type: "string" },
					see: [`character:${card!.id}`, "participant"],
					nextChapter: true
				})
			]
		}
	} as any)
	const sessionOf = async (annex: Record<string, unknown>) =>
		(
			await testDb
				.insert(schema.sessions)
				.values({
					userId: owner.id,
					isGroup: false,
					genreId: "core:genre/story",
					lorebookId: book!.id,
					annex
				} as any)
				.returning()
		)[0]!
	const old = await sessionOf({
		[pluginId]: { oath: "to the ford", vow: "to the keep" }
	})
	const next = await sessionOf({})
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: next.id,
		characterId: card!.id,
		castMemberId: member!.id
	} as any)
	const first = await insertLegacy(testDb as unknown as Db, {
		sessionId: next.id,
		role: "user",
		content: "line",
		channel: "main"
	})
	const { seedNextChapter } = await import("./creationModes")
	await seedNextChapter(testDb as unknown as Db, {
		fromSessionId: old.id,
		sessionId: next.id,
		userId: owner.id,
		anchorMessageId: first.id
	})
	const [row] = await testDb
		.select({
			annex: schema.sessions.annex,
			audiences: schema.sessions.annexAudiences
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, next.id))
	expect((row!.annex as any)[pluginId]).toEqual({
		oath: "to the ford",
		vow: "to the keep"
	})
	return {
		stored: (row!.audiences as any)[pluginId],
		card: card!,
		member: member!
	}
}

describe("seedNextChapter stores a declared audience", () => {
	test("switch off: a seated-member audience becomes character:<cardId>, one nobody is seated as is dropped, a card form and a role are stored as before", async () => {
		memberFormSwitch.on = false
		const { stored, card } = await scenario()
		expect(stored.oath).toEqual([`character:${card.id}`])
		expect(stored.vow).toEqual(
			["participant", `character:${card.id}`].sort()
		)
		expect(JSON.stringify(stored)).not.toContain("seated-member")
	})

	test("switch on: a seated-member audience is stored as seated-member:<memberId>, one nobody is seated as is dropped", async () => {
		memberFormSwitch.on = true
		const { stored, member } = await scenario()
		expect(stored.oath).toEqual([`seated-member:${member.id}`])
		expect(stored.vow).toEqual(
			["participant", `seated-member:${member.id}`].sort()
		)
		expect(JSON.stringify(stored)).not.toContain("character:")
	})
})
