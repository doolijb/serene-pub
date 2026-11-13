/**
 * 🚧 ⏳ S4 wave 3: Forward lands a turn's annex imprints in member form. A turn
 * taken Back **before** the flip holds card form in its record; with the
 * switch on, Forward puts each `annex` imprint's values and audiences (the
 * `core` progress key's fates and the audiences) through the boot pass's
 * translator, with no pass run. A second Back and Forward change nothing more.
 * (Runtime keys — turn order, tally — are columns now, in no annex document,
 * so this case no longer carries a `turnTally` in the annex.)
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { memberFormSwitch } from "$lib/server/state/memberForm"
import { annexImprintKey, fileSessionImprint } from "$lib/server/sessions/sessionImprints"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string
let ownerId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-annexMF-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(testDb, "annex-mf-owner")).id
}, 180_000)

afterAll(async () => {
	memberFormSwitch.on = false
	await releaseDataDir(dataDir)
})

const made: number[] = []
afterEach(async () => {
	memberFormSwitch.on = false
	if (made.length) await testDb.delete(schema.sessions).where(inArray(schema.sessions.id, made))
	made.length = 0
})

let n = 0
const card = async (name: string) =>
	(await testDb.insert(schema.characters).values({ userId: ownerId, name: `${name} ${++n}`, description: "" }).returning())[0]!

describe("Forward after a Back taken before the flip", () => {
	test("the restored core annex keys and audiences land in member form; a second Back and Forward change nothing more", async () => {
		const hero = await card("Hero")
		const persona = await card("Persona")
		const [book] = await testDb.insert(schema.lorebooks).values({ userId: ownerId, name: `Book ${++n}` }).returning()
		const mHero = (await insertCastMember(testDb, { lorebookId: book!.id, binding: `{{char:${n}}}`, characterId: hero.id, name: "" })).member!
		const mPersona = (await insertCastMember(testDb, { lorebookId: book!.id, binding: `{{char:${++n}}}`, characterId: persona.id, name: "" })).member!
		const cr = (id: number) => `character:${id}`
		const [s] = await testDb
			.insert(schema.sessions)
			.values({ userId: ownerId, isGroup: true, name: `Run ${++n}`, lorebookId: book!.id, })
			.returning()
		made.push(s!.id)
		await testDb.insert(schema.sessionCharacters).values({ sessionId: s!.id, characterId: hero.id, castMemberId: mHero.id })
		const [ps] = await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId: s!.id, personaId: persona.id, castMemberId: mPersona.id })
			.returning()

		const { insertLegacy } = await import("$lib/server/messages/store")
		await insertLegacy(testDb as any, { sessionId: s!.id, role: "user", userId: ownerId, characterId: null, content: "Hello." } as never)
		const reply = await insertLegacy(testDb as any, {
			sessionId: s!.id,
			role: "assistant",
			userId: ownerId,
			characterId: hero.id,
			content: "Hero nods."
		} as never)
		const PROGRESS = "dungeon-crawler-progress"
		const progress = (fate: string) => ({ fates: { [cr(hero.id)]: fate, "user:1": { made: true } } })
		const goalsSee = [cr(hero.id), "user:2"]
		await testDb.transaction(async (tx) => {
			await tx
				.update(schema.sessions)
				.set({
					annex: { core: { [PROGRESS]: progress("dead"), goals: "find the key" } } as never,
					annexAudiences: { core: { goals: goalsSee } } as never
				})
				.where(inArray(schema.sessions.id, [s!.id]))
			const at = { sessionId: s!.id, messageId: reply.id, runId: null }
			const none = { ownerVersion: null, audienceBefore: null, audienceAfter: null }
			await fileSessionImprint(tx as unknown as Db, at, { kind: "annex", key: annexImprintKey("core", PROGRESS) }, progress("alive"), progress("dead"), none)
			await fileSessionImprint(tx as unknown as Db, at, { kind: "annex", key: annexImprintKey("core", "goals") }, undefined, "find the key", { ownerVersion: null, audienceBefore: null, audienceAfter: goalsSee })
		})

		// Back, switch off: the record holds card form.
		const { rewindTurn, forwardTurn } = await import("$lib/server/sessions/rewind")
		expect(await rewindTurn(testDb as any, { sessionId: s!.id, userId: ownerId })).toMatchObject({ ok: true })
		const annexOf = async () =>
			(await testDb.select({ a: schema.sessions.annex, au: schema.sessions.annexAudiences }).from(schema.sessions).where(inArray(schema.sessions.id, [s!.id])))[0]!
		const deltas = async () => (await testDb.select().from(schema.sessionImprints)).filter((d) => d.sessionId === s!.id)
		expect(JSON.stringify(await annexOf())).toContain(cr(hero.id))

		// The flip, no pass: Forward lands member form.
		memberFormSwitch.on = true
		expect(await forwardTurn(testDb as any, { sessionId: s!.id, userId: ownerId })).toMatchObject({ ok: true })
		const fates = (d: any) => d.core["dungeon-crawler-progress"].fates
		const afterForward = await annexOf()
		expect(fates(afterForward.a)).toEqual({ [`seated-member:${mHero.id}`]: "dead", "user:1": { made: true } })
		expect((afterForward.au as any).core).toEqual({ goals: [`seated-member:${mHero.id}`, "user:2"] })
		const rows = await deltas()
		expect(rows).toHaveLength(2)
		expect(JSON.stringify(rows)).not.toContain(cr(hero.id))
		expect(rows.find((r) => r.subjectKey === "core/goals")!.audienceAfter).toEqual([`seated-member:${mHero.id}`, "user:2"])

		// Back and Forward again: nothing more moves.
		const settled = JSON.stringify([await annexOf(), await deltas()])
		expect(await rewindTurn(testDb as any, { sessionId: s!.id, userId: ownerId })).toMatchObject({ ok: true })
		expect(await forwardTurn(testDb as any, { sessionId: s!.id, userId: ownerId })).toMatchObject({ ok: true })
		expect(JSON.stringify([await annexOf(), await deltas()])).toBe(settled)
		expect(ps!.castMemberId).toBe(mPersona.id)
	}, 120_000)
})
