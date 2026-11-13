/**
 * ⏳ Auto's remembered pick is keyed by the seat's member form once the flip
 * is on (`state/memberForm.ts`): written and read under
 * `speechAutoVoice:seated-member:<id>` (or `player-seat:<id>`), and a
 * card-form speaker ref reads the same key.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { TestDb } from "$lib/server/utils/testDb"
import { memberFormSwitch } from "$lib/server/state/memberForm"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		db,
		dbReady: Promise.resolve(),
		getCryptoSecretKey: () => "auto-voice-test-secret"
	}
})

let db: TestDb
let dataDir: string
let seq = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-s4emit-autovoice-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as never)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let was = false
beforeEach(() => {
	was = memberFormSwitch.on
	memberFormSwitch.on = true
})
afterEach(() => {
	memberFormSwitch.on = was
})

/** A filled Narration-like loadout with three voices; bruno is its loadout voice. */
async function world() {
	const n = ++seq
	const [c] = await db
		.insert(schema.connections)
		.values({
			name: `tts ${n}`,
			type: CONNECTION_TYPE.OLLAMA,
			baseUrl: "http://localhost:1",
			modality: "text-gen"
		})
		.returning()
	const [m] = await db
		.insert(schema.connectionModels)
		.values({
			connectionId: c!.id,
			model: `kokoro-${n}`,
			name: `kokoro-${n}`,
			facts: {} as never
		})
		.returning()
	const [loadout] = await db
		.insert(schema.loadouts)
		.values({
			slug: `auto-${n}`,
			name: `Auto ${n}`,
			owner: "pub",
			transform: "text->audio",
			connectionId: c!.id,
			connectionModelId: m!.id
		} as never)
		.returning()
	const voice = async (slug: string, over: Record<string, unknown> = {}) =>
		(
			await db
				.insert(schema.voicebankVoices)
				.values({
					slug: `${slug}-${n}`,
					name: slug,
					voiceId: `vid-${slug}-${n}`,
					loadoutId: loadout!.id,
					...over
				} as never)
				.returning()
		)[0]!
	const bruno = await voice("bruno")
	const mira = await voice("mira")
	const sol = await voice("sol")
	await db
		.update(schema.loadouts)
		.set({ defaultVoiceId: bruno.id } as never)
		.where(eq(schema.loadouts.id, loadout!.id))
	const [user] = await db
		.insert(schema.users)
		.values({ username: `auto-${n}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user!.id,
			isGroup: false,
			genreId: "core:genre/guide",
			genreFields: {}
		} as never)
		.returning()
	const speaker = async () =>
		(
			await db
				.insert(schema.characters)
				.values({
					userId: user!.id,
					name: `npc ${++seq}`,
					description: "",
					extensions: {}
				} as never)
				.returning()
		)[0]!
	return {
		loadout: loadout!,
		bruno,
		mira,
		sol,
		session: session!,
		user: user!,
		speaker,
		n
	}
}
type W = Awaited<ReturnType<typeof world>>

const fields = async (w: W) =>
	((
		await db
			.select({ f: schema.sessions.genreFields })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, w.session.id))
	)[0]!.f ?? {}) as Record<string, unknown>
const keyOf = (ref: string) => `speechAutoVoice:${ref}`

/** A character seat with a cast member for a fresh card; a book is the member's home. */
async function seatedSpeaker(w: W) {
	const card = await w.speaker()
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: w.user.id, name: `Book ${++seq}` } as never)
		.returning()
	const [member] = await db
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: book!.id,
			characterId: card.id,
			binding: `{{char:${++seq}}}`,
			name: "member"
		} as never)
		.returning()
	await db
		.insert(schema.sessionCharacters)
		.values({
			sessionId: w.session.id,
			characterId: card.id,
			castMemberId: member!.id
		} as never)
	return { card, member: member! }
}

describe("resolveVoice — Auto's key is the seat's member form", () => {
	it("a card-form speaker ref writes and reads the member-form key", async () => {
		const { resolveVoice } = await import("./resolveVoice")
		const w = await world()
		const { card, member } = await seatedSpeaker(w)
		const cardRef = `character:${card.id}`
		const memberRef = `seated-member:${member.id}`
		const first = (await resolveVoice(
			{
				speakerRef: cardRef as never,
				sessionId: w.session.id,
				loadoutId: w.loadout.id,
				rememberAuto: true
			},
			db as never
		)) as { ok: boolean; from: string; voicebankSlug: string }
		expect(first).toMatchObject({ ok: true, from: "auto" })
		const stored = await fields(w)
		expect(stored[keyOf(memberRef)]).toBe(first.voicebankSlug)
		expect(keyOf(cardRef) in stored).toBe(false)

		// The member-form ref reads the same pick (sticky), even when moved by hand.
		const other =
			first.voicebankSlug === w.mira.slug ? w.sol.slug : w.mira.slug
		await db
			.update(schema.sessions)
			.set({ genreFields: { [keyOf(memberRef)]: other } })
			.where(eq(schema.sessions.id, w.session.id))
		for (const ref of [memberRef, cardRef]) {
			const again = await resolveVoice(
				{
					speakerRef: ref as never,
					sessionId: w.session.id,
					loadoutId: w.loadout.id,
					rememberAuto: true
				},
				db as never
			)
			expect(again).toMatchObject({
				ok: true,
				from: "auto",
				voicebankSlug: other
			})
		}
		expect(
			Object.keys(await fields(w)).filter((k) =>
				k.startsWith("speechAutoVoice:")
			)
		).toEqual([keyOf(memberRef)])
	})

	it("a player seat is keyed player-seat:<id>, carded or not", async () => {
		const { resolveVoice } = await import("./resolveVoice")
		const w = await world()
		const card = await w.speaker()
		const [seat] = await db
			.insert(schema.sessionPersonas)
			.values({
				sessionId: w.session.id,
				userId: w.user.id,
				personaId: card.id
			} as never)
			.returning()
		const r = (await resolveVoice(
			{
				speakerRef: `character:${card.id}` as never,
				sessionId: w.session.id,
				loadoutId: w.loadout.id,
				rememberAuto: true
			},
			db as never
		)) as { ok: boolean; voicebankSlug: string }
		expect(r.ok).toBe(true)
		expect((await fields(w))[keyOf(`player-seat:${seat!.id}`)]).toBe(
			r.voicebankSlug
		)
	})
})
