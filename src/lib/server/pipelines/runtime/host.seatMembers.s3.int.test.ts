/**
 * 🚧 The host's gates take `seated-member:<memberId>` and store the card form
 * (plan §27 S3, lane s27-S3C, worker w1): an annex audience, the AI's view of
 * the annex, a line's `metadata.speaker`, a form's addressee (written and
 * answered), and the stat-configuration halt sentence. Nothing stored changes
 * form in S3: `character:<cardId>` for a seat holding a card,
 * `player-seat:<seatId>` for a card-less player seat; a member nobody is
 * seated as is refused, dropped or left unmatched — never stored raw.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
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
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { defineAttributeSlot } from "@serene-pub/sdk"
import { genreKeeping } from "$lib/server/utils/testGenre"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-hostseats3-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

// ⏳ (S4) These tests pin the card form — the member-form switch OFF; the same
// paths in member form are `host.seatForm.int.test.ts`'s.
import { memberFormSwitch } from "$lib/server/state/memberForm"
let switchWas = false
beforeEach(() => {
	switchWas = memberFormSwitch.on
	memberFormSwitch.on = false
})
afterEach(() => {
	memberFormSwitch.on = switchWas
})

const db = () => testDb as unknown as Db
let n = 0

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `hostseats3-${++n}`)
}

async function card(userId: number, name: string, isPersona = false) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: `${name}.`, isPersona } as any)
		.returning()
	return row!
}

async function book(userId: number) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${++n}` } as any)
		.returning()
	return row!
}

async function member(lorebookId: number, characterId: number | null) {
	const [row] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId,
			characterId,
			binding: `{{char:${++n}}}`,
			name: "member"
		} as any)
		.returning()
	return row!
}

async function session(
	userId: number,
	lorebookId: number,
	over: Partial<typeof schema.sessions.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `Run ${++n}`,
			lorebookId,
			...over
		} as any)
		.returning()
	return row!
}

/** A session with a seat holding a card (and its member) and a card-less player seat (and its member). */
async function world() {
	const u = await user()
	const c = await card(u.id, "Verity")
	const b = await book(u.id)
	const m = await member(b.id, c.id)
	const pm = await member(b.id, null)
	const s = await session(u.id, b.id)
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: s.id,
		characterId: c.id,
		castMemberId: m.id
	} as any)
	const [ps] = await testDb
		.insert(schema.sessionPersonas)
		.values({
			sessionId: s.id,
			personaId: null,
			userId: u.id,
			seatName: "Wren",
			castMemberId: pm.id
		} as any)
		.returning()
	return { u, c, b, m, pm, s, ps: ps! }
}

/** An installed plugin declaring annex fields, the way the host reads declarations. */
async function declareAnnex(pluginId: string, annexFields: unknown[]) {
	await testDb.insert(schema.plugins).values({
		pluginId,
		name: pluginId,
		version: "1.0.0",
		bundleSource: "// none",
		bundleHash: `hash-${pluginId}`,
		enabled: true,
		manifest: { annexFields }
	} as any)
}

const createMessage = {
	key: "reply",
	definitionId: "core:outlet/create-message"
} as any

describe("an annex audience is stored in the card form", () => {
	test("set-session-annex stores a seated-member audience as its seat's card form, drops one nobody is seated as; the AI's view meets the translated speaker", async () => {
		const w = await world()
		const { annexField } = await import("@serene-pub/sdk")
		const owner = `s3a${++n}.rp`
		await declareAnnex(owner, [
			annexField({
				key: "carded",
				shape: { type: "string" },
				see: [
					`seated-member:${w.m.id}`,
					`seated-member:${w.m.id + 9999}`
				]
			}),
			annexField({
				key: "cardless",
				shape: { type: "string" },
				see: [`seated-member:${w.pm.id}`]
			}),
			annexField({
				key: "plain",
				shape: { type: "string" },
				see: [`character:${w.c.id}`, "participant"]
			})
		])
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(db(), {
			sessionId: w.s.id,
			userId: w.u.id,
			specId: `${owner}:spec/keep`,
			runId: "run-s3-annex"
		} as any)
		const node = {
			key: "keep",
			definitionId: "core:outlet/set-session-annex",
			definitionVersion: 1
		} as any
		await host.commit!({ value: { carded: "c" } }, node)
		await host.commit!({ value: { cardless: "p" } }, node)
		await host.commit!({ value: { plain: "x" } }, node)
		const [row] = await testDb
			.select({ audiences: schema.sessions.annexAudiences })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, w.s.id))
		const stored = (row!.audiences as any)[owner]
		// A member is stored as the card its seat holds; the unseated one is dropped.
		expect(stored.carded).toEqual([`character:${w.c.id}`])
		expect(stored.cardless).toEqual([`player-seat:${w.ps.id}`])
		// Today's card-form audience is stored exactly as before.
		expect(stored.plain).toEqual(
			["participant", `character:${w.c.id}`].sort()
		)
		expect(JSON.stringify(stored)).not.toContain("seated-member")

		const read = (speaker: string | null) =>
			(host as any).read(
				"session_annex",
				{
					sessionId: w.s.id,
					view: "ai",
					...(speaker ? { speaker } : {})
				},
				{
					key: "annex",
					definitionId: "core:query/session-annex",
					definitionVersion: 1
				}
			)
		// The declared audience names the member; the speaker may name the member or the card.
		for (const speaker of [
			`seated-member:${w.m.id}`,
			`character:${w.c.id}`
		])
			expect(await read(speaker)).toMatchObject({
				carded: "c",
				plain: "x"
			})
		// A speaker nobody is seated as holds only what everyone may see.
		expect(await read(`seated-member:${w.m.id + 9999}`)).toEqual({
			plain: "x"
		})
		expect(await read(null)).toEqual({ plain: "x" })
	})
})

describe("a line's speaker is stored in the card form", () => {
	test("create-message stores metadata.speaker as character:<cardId> / player-seat:<seatId>, and refuses a member nobody is seated as", async () => {
		const w = await world()
		const { createHost, HostScopeError } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(db(), {
			sessionId: w.s.id,
			userId: w.u.id
		} as any)
		const speakerOf = async (id: number) => {
			const [row] = await testDb
				.select({ metadata: schema.sessionMessages.metadata })
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.id, id))
			return (row!.metadata as any).speaker
		}
		const viaMember: any = await host.commit!(
			{ text: "Hello.", speaker: `seated-member:${w.m.id}` },
			createMessage
		)
		expect(await speakerOf(viaMember.id)).toBe(`character:${w.c.id}`)
		const viaSeat: any = await host.commit!(
			{ text: "Hello.", speaker: `seated-member:${w.pm.id}` },
			createMessage
		)
		expect(await speakerOf(viaSeat.id)).toBe(`player-seat:${w.ps.id}`)
		// Today's card form is stored as it always was.
		const viaCard: any = await host.commit!(
			{ text: "Hello.", speaker: `character:${w.c.id}` },
			createMessage
		)
		expect(await speakerOf(viaCard.id)).toBe(`character:${w.c.id}`)
		await expect(
			host.commit!(
				{ text: "Hello.", speaker: `seated-member:${w.m.id + 9999}` },
				createMessage
			)
		).rejects.toThrow(HostScopeError)
	})

	test("a person's message spoken as their persona's seated member is written as that persona", async () => {
		const u = await user()
		const persona = await card(u.id, "Elara", true)
		const b = await book(u.id)
		const pm = await member(b.id, persona.id)
		const s = await session(u.id, b.id)
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: s.id,
			personaId: persona.id,
			userId: u.id,
			castMemberId: pm.id
		} as any)
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(db(), { sessionId: s.id, userId: u.id } as any)
		const out: any = await host.commit!(
			{
				text: "I step in.",
				role: "user",
				speaker: `seated-member:${pm.id}`
			},
			createMessage
		)
		const [row] = await testDb
			.select({ personaId: schema.sessionMessages.personaId })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, out.id))
		expect(row!.personaId).toBe(persona.id)
	})
})

describe("a form's addressee is the card form", () => {
	const choices = (addressee: string) => [
		{
			kind: "choices",
			id: "door",
			question: "Is there a room here?",
			addressee,
			actions: [{ fn: "room", label: "Build it", choice: "build" }]
		}
	]

	test("a block written to a seated-member is addressed as its card (the refusal names the card form); one nobody is seated as is refused by name", async () => {
		const w = await world()
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(db(), {
			sessionId: w.s.id,
			userId: w.u.id
		} as any)
		await expect(
			host.commit!(
				{ text: "Ask.", blocks: choices(`seated-member:${w.m.id}`) },
				createMessage
			)
		).rejects.toThrow(`addressed to character:${w.c.id} but`)
		await expect(
			host.commit!(
				{
					text: "Ask.",
					blocks: choices(`seated-member:${w.m.id + 9999}`)
				},
				createMessage
			)
		).rejects.toThrow(/who is not seated in this session/)
	})

	test("answer-form compares a seated-member addressee as the stored card form", async () => {
		const w = await world()
		const { insertLegacy, appendParts } = await import(
			"$lib/server/messages/store"
		)
		const msg = await insertLegacy(db(), {
			sessionId: w.s.id,
			role: "assistant",
			content: "Is there a room here?"
		})
		await appendParts(db(), msg.id, [
			{
				type: "core:blocks",
				data: {
					blocks: [
						{
							kind: "choices",
							id: "door",
							head: msg.id,
							question: "Is there a room here?",
							addressee: `character:${w.c.id}`,
							actions: [
								{
									fn: "room",
									action: "x#room",
									label: "Build it",
									choice: "build"
								}
							]
						}
					]
				}
			}
		] as any)
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(db(), {
			sessionId: w.s.id,
			userId: w.u.id,
			specId: "test:spec/answer",
			runId: "run-s3-answer"
		} as any)
		const node = {
			key: "answer",
			definitionId: "core:outlet/answer-form",
			definitionVersion: 1
		} as any
		const ask = (addressee: string) =>
			host.commit!(
				{
					messageId: msg.id,
					blockId: "door",
					addressee,
					answer: { choice: "build" }
				},
				node
			) as Promise<any>
		const wrong: any = await ask(`seated-member:${w.m.id + 9999}`)
		expect(wrong.halt).toContain(
			`is addressed to character:${w.c.id}, not seated-member:${w.m.id + 9999}`
		)
		// The member who sits in the addressee's seat is the addressee: the form is not refused as another's.
		const right: any = await ask(`seated-member:${w.m.id}`)
		expect(String(right.halt ?? "")).not.toContain("is addressed to")
		const viaCard: any = await ask(`character:${w.c.id}`)
		expect(String(viaCard.halt ?? "")).not.toContain("is addressed to")
	})
})

describe("set-stat-config names the new form in its halt sentence (★S3-1)", () => {
	test("an owner nobody is seated as halts naming player-seat, seated-member and character; a member and a card configure alike", async () => {
		const w = await world()
		const slot = "test:slot/s3-stat-config@1"
		const stat = defineAttributeSlot(slot, {
			type: "integer",
			descriptor: "How much a seat can take.",
			appliesTo: ["cast"],
			config: { min: 0, max: 20 },
			default: 20
		})
		genreKeeping("test:genre/s3-stat-config", {
			name: { en: "S3 stat config" },
			family: "test",
			slots: [stat],
			events: {}
		})
		await testDb
			.update(schema.sessions)
			.set({ genreId: "test:genre/s3-stat-config" } as any)
			.where(eq(schema.sessions.id, w.s.id))
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(db(), {
			sessionId: w.s.id,
			specId: "test:spec/s3-stat-config",
			runId: "run-s3-stat-config"
		} as any)
		const node = {
			key: "configure",
			definitionId: "core:outlet/set-stat-config",
			definitionVersion: 1
		} as any
		const viaMember: any = await host.commit!(
			{ owner: `seated-member:${w.m.id}`, slot, config: { max: 9 } },
			node
		)
		expect(viaMember.halt, viaMember.halt).toBeUndefined()
		const unseated = `seated-member:${w.m.id + 9999}`
		const out: any = await host.commit!(
			{ owner: unseated, slot, config: { max: 5 } },
			node
		)
		expect(out).toEqual({
			halt: `${JSON.stringify(unseated)} is not an owner here — name a seat (player-seat:<id>, seated-member:<id>, character:<id>) or world`
		})
	})
})
