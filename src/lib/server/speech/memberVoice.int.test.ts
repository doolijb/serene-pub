/**
 * 🚧 A seated speaker's voice comes from the cast member, own over card (plan
 * §27 S2; owner ruling 2026-11-05: "members carry voice and sprites, own over
 * card"), against a real database. A seat with no member yet reads its card,
 * exactly as before.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { TestDb } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { insertDatedCardVersion } from "$lib/server/pipelines/testing/fixtures"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		db,
		dbReady: Promise.resolve(),
		getCryptoSecretKey: () => "member-voice-test-secret"
	}
})

let db: TestDb
let dataDir: string
let seq = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-membervoice-")
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

/** A filled loadout with four voices (bruno is its loadout voice), a user, a lorebook and a session on it. */
async function world(storyClockYear?: number) {
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
			slug: `mv-${n}`,
			name: `Member voice ${n}`,
			owner: "pub",
			transform: "text->audio",
			connectionId: c!.id,
			connectionModelId: m!.id
		} as never)
		.returning()
	const voice = async (slug: string) =>
		(
			await db
				.insert(schema.voicebankVoices)
				.values({
					slug: `${slug}-${n}`,
					name: slug,
					voiceId: `vid-${slug}-${n}`,
					loadoutId: loadout!.id
				} as never)
				.returning()
		)[0]!
	const bruno = await voice("bruno")
	const mira = await voice("mira")
	const sol = await voice("sol")
	const kai = await voice("kai")
	await db
		.update(schema.loadouts)
		.set({ defaultVoiceId: bruno.id } as never)
		.where(eq(schema.loadouts.id, loadout!.id))
	const [user] = await db
		.insert(schema.users)
		.values({ username: `mv-${n}` })
		.returning()
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user!.id, name: `Book ${n}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user!.id,
			isGroup: true,
			genreId: "core:genre/guide",
			genreFields: {},
			lorebookId: book!.id,
			...(storyClockYear != null ? { storyClockYear } : {})
		} as never)
		.returning()
	const card = async (name: string, timbre?: Record<string, unknown>) =>
		(
			await db
				.insert(schema.characters)
				.values({
					userId: user!.id,
					name: `${name} ${++seq}`,
					description: "",
					extensions: timbre ? { serenepub: { timbre } } : {}
				} as never)
				.returning()
		)[0]!
	const member = async (
		characterId: number | null,
		extra: Record<string, unknown> = {}
	) =>
		(
			await insertCastMember(db, {
				lorebookId: book!.id,
				binding: `{{char:mv${++seq}}}`,
				characterId,
				name: "",
				...extra
			} as never)
		).member
	const charSeat = async (
		characterId: number,
		castMemberId: number | null,
		position = 0
	) =>
		(
			await db
				.insert(schema.sessionCharacters)
				.values({
					sessionId: session!.id,
					characterId,
					castMemberId,
					position
				} as never)
				.returning()
		)[0]!
	const playerSeat = async (
		personaId: number,
		castMemberId: number | null,
		position = 0
	) =>
		(
			await db
				.insert(schema.sessionPersonas)
				.values({
					sessionId: session!.id,
					personaId,
					castMemberId,
					position
				} as never)
				.returning()
		)[0]!
	return {
		loadout: loadout!,
		bruno,
		mira,
		sol,
		kai,
		session: session!,
		book: book!,
		card,
		member,
		charSeat,
		playerSeat
	}
}

const speak = async (w: Awaited<ReturnType<typeof world>>, ref: string) => {
	const { resolveVoice } = await import("./resolveVoice")
	return resolveVoice(
		{
			speakerRef: ref as never,
			sessionId: w.session.id,
			loadoutId: w.loadout.id
		},
		db as never
	)
}

describe("resolveVoice — a seated speaker reads the cast member, own over card", () => {
	it("a member's own voice beats the card's", async () => {
		const w = await world()
		const c = await w.card("Maren", { voice: w.mira.slug })
		const m = await w.member(c.id, { timbre: { voice: w.sol.slug } })
		await w.charSeat(c.id, m.id)
		expect(await speak(w, `character:${c.id}`)).toMatchObject({
			ok: true,
			from: "timbre",
			voicebankSlug: w.sol.slug
		})
	})

	it("a member with no timbre of its own reads the card's voice", async () => {
		const w = await world()
		const c = await w.card("Maren", { voice: w.mira.slug })
		const m = await w.member(c.id)
		await w.charSeat(c.id, m.id)
		expect(await speak(w, `character:${c.id}`)).toMatchObject({
			ok: true,
			from: "timbre",
			voicebankSlug: w.mira.slug
		})
	})

	it("a seat with no member yet reads the card's voice", async () => {
		const w = await world()
		const c = await w.card("Maren", { voice: w.mira.slug })
		await w.charSeat(c.id, null)
		expect(await speak(w, `character:${c.id}`)).toMatchObject({
			ok: true,
			from: "timbre",
			voicebankSlug: w.mira.slug
		})
	})

	it("a seated-member ref resolves to that member's voice", async () => {
		const w = await world()
		const c = await w.card("Maren", { voice: w.mira.slug })
		const m = await w.member(c.id, { timbre: { voice: w.sol.slug } })
		await w.charSeat(c.id, m.id)
		expect(await speak(w, `seated-member:${m.id}`)).toMatchObject({
			ok: true,
			from: "timbre",
			voicebankSlug: w.sol.slug
		})
	})

	it("a player seat whose member has its own voice speaks with it", async () => {
		const w = await world()
		const persona = await w.card("Pip", { voice: w.mira.slug })
		const m = await w.member(persona.id, { timbre: { voice: w.kai.slug } })
		const seat = await w.playerSeat(persona.id, m.id)
		expect(await speak(w, `player-seat:${seat.id}`)).toMatchObject({
			ok: true,
			from: "timbre",
			voicebankSlug: w.kai.slug
		})
	})

	// Owner ruling 2026-11-05: "Everything in session is cast -> active card."
	it("a seat holding a card the story clock has moved on from voices the member's active (dated) card", async () => {
		const w = await world(30)
		const old = await w.card("Verity old", { voice: w.mira.slug })
		const young = await w.card("Verity young", { voice: w.sol.slug })
		const m = await w.member(old.id, { name: "Verity" })
		await insertDatedCardVersion(db, m.id, young.id, 20)
		await w.charSeat(old.id, m.id)
		expect(await speak(w, `character:${old.id}`)).toMatchObject({
			ok: true,
			from: "timbre",
			voicebankSlug: w.sol.slug
		})
	})

	// Owner ruling 2026-11-05: two seats on one member read the same thing.
	it("two seats on one member voice the member's active card", async () => {
		const w = await world()
		const a = await w.card("Twin A", { voice: w.mira.slug })
		const b = await w.card("Twin B", { voice: w.sol.slug })
		const m = await w.member(a.id)
		await w.charSeat(a.id, m.id, 0)
		await w.charSeat(b.id, m.id, 1)
		expect(await speak(w, `character:${a.id}`)).toMatchObject({
			ok: true,
			voicebankSlug: w.mira.slug
		})
		expect(await speak(w, `character:${b.id}`)).toMatchObject({
			ok: true,
			voicebankSlug: w.mira.slug
		})
	})

	it("a member's own silent timbre silences a card that is not silent", async () => {
		const { speakerSilent } = await import("./resolveVoice")
		const w = await world()
		const c = await w.card("Maren", { voice: w.mira.slug })
		const m = await w.member(c.id, { timbre: { silent: true } })
		await w.charSeat(c.id, m.id)
		const plain = await w.card("Plain", { voice: w.mira.slug })
		await w.charSeat(plain.id, null, 1)
		expect(
			await speakerSilent(
				db as never,
				`character:${c.id}` as never,
				w.session.id
			)
		).toBe(true)
		expect(
			await speakerSilent(
				db as never,
				`character:${plain.id}` as never,
				w.session.id
			)
		).toBe(false)
		// Without a session there is no seat to read: the card.
		expect(
			await speakerSilent(db as never, `character:${c.id}` as never)
		).toBe(false)
	})

	it("a card-less member voices with its own timbre, and its own silent, over the card its seat holds", async () => {
		const { speakerSilent } = await import("./resolveVoice")
		const w = await world()
		const held = await w.card("Held", { voice: w.mira.slug })
		const m = await w.member(null, {
			timbre: { voice: w.kai.slug, silent: true }
		})
		await w.charSeat(held.id, m.id)
		expect(await speak(w, `character:${held.id}`)).toMatchObject({
			ok: true,
			from: "timbre",
			voicebankSlug: w.kai.slug
		})
		expect(
			await speakerSilent(
				db as never,
				`character:${held.id}` as never,
				w.session.id
			)
		).toBe(true)
	})

	it("voices in use: a member's own voice counts, so Auto for another speaker avoids it", async () => {
		const w = await world()
		const c = await w.card("Maren")
		const m = await w.member(c.id, { timbre: { voice: w.mira.slug } })
		await w.charSeat(c.id, m.id)
		// Candidates other than the narrator's bruno: mira (taken), sol, kai. Several speakers, so a
		// pick that ignored the member's voice would very likely land on mira.
		for (let i = 0; i < 6; i++) {
			const npc = await w.card("npc")
			const r = await speak(w, `character:${npc.id}`)
			expect(r).toMatchObject({ ok: true, from: "auto" })
			expect((r as { voicebankSlug: string }).voicebankSlug).not.toBe(
				w.mira.slug
			)
		}
	})

	// Plan §34.2 (S4): a card-less seat is a member and no card.
	it("a seated-member ref of a card-less seat (no card at all) reads that member's timbre", async () => {
		const w = await world()
		const m = await w.member(null, { timbre: { voice: w.kai.slug } })
		await db.insert(schema.sessionCharacters).values({
			sessionId: w.session.id,
			characterId: null,
			castMemberId: m.id
		} as never)
		expect(await speak(w, `seated-member:${m.id}`)).toMatchObject({
			ok: true,
			from: "timbre",
			voicebankSlug: w.kai.slug
		})
	})

	it("voices in use: a card-less seat's member voice counts", async () => {
		const w = await world()
		const m = await w.member(null, { timbre: { voice: w.mira.slug } })
		await db.insert(schema.sessionCharacters).values({
			sessionId: w.session.id,
			characterId: null,
			castMemberId: m.id
		} as never)
		for (let i = 0; i < 6; i++) {
			const npc = await w.card("npc")
			const r = await speak(w, `character:${npc.id}`)
			expect(r).toMatchObject({ ok: true, from: "auto" })
			expect((r as { voicebankSlug: string }).voicebankSlug).not.toBe(
				w.mira.slug
			)
		}
	})
})
