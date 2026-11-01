/**
 * Narration-fallback lane: Auto's persistence and the resolver's arms against
 * a real database. The pure pick has its own tests (`autoVoice.test.ts`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve(), getCryptoSecretKey: () => "auto-voice-test-secret" }
})

let db: TestDb
let dataDir: string
let seq = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-autovoice-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db as never)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** A filled Narration-like loadout with three voices; bruno is its loadout voice. */
async function world() {
	const n = ++seq
	const [c] = await db
		.insert(schema.connections)
		.values({ name: `tts ${n}`, type: CONNECTION_TYPE.OLLAMA, baseUrl: "http://localhost:1", modality: "text-gen" })
		.returning()
	const [m] = await db
		.insert(schema.connectionModels)
		.values({ connectionId: c!.id, model: `kokoro-${n}`, name: `kokoro-${n}`, facts: {} as never })
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
				.values({ slug: `${slug}-${n}`, name: slug, voiceId: `vid-${slug}-${n}`, loadoutId: loadout!.id, ...over } as never)
				.returning()
		)[0]!
	const bruno = await voice("bruno")
	const mira = await voice("mira")
	const sol = await voice("sol")
	await db.update(schema.loadouts).set({ defaultVoiceId: bruno.id } as never).where(eq(schema.loadouts.id, loadout!.id))
	const [user] = await db.insert(schema.users).values({ username: `auto-${n}` }).returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user!.id, isGroup: false, genreId: "core:genre/guide", genreFields: {} } as never)
		.returning()
	const speaker = async () =>
		(await db.insert(schema.characters).values({ userId: user!.id, name: `npc ${++seq}`, description: "", extensions: {} } as never).returning())[0]!
	return { loadout: loadout!, bruno, mira, sol, session: session!, user: user!, speaker, n }
}
type W = Awaited<ReturnType<typeof world>>

const fields = async (w: W) =>
	((await db.select({ f: schema.sessions.genreFields }).from(schema.sessions).where(eq(schema.sessions.id, w.session.id)))[0]!.f ?? {}) as Record<string, unknown>
const keyOf = (ref: string) => `speechAutoVoice:${ref}`

describe("resolveVoice — Auto and the fallback arms", () => {
	it("narration speaks the loadout voice; a voiceless speaker gets Auto (not the narrator's) and it sticks", async () => {
		const { resolveVoice } = await import("./resolveVoice")
		const w = await world()
		const npc = await w.speaker()
		const ref = `character:${npc.id}`
		const narr = await resolveVoice({ speakerRef: null, cueVoice: "narrator", sessionId: w.session.id, loadoutId: w.loadout.id }, db as never)
		expect(narr).toMatchObject({ ok: true, from: "loadout-voice", voicebankSlug: w.bruno.slug })

		const first = await resolveVoice({ speakerRef: ref as never, sessionId: w.session.id, loadoutId: w.loadout.id, rememberAuto: true }, db as never)
		expect(first).toMatchObject({ ok: true, from: "auto" })
		const picked = (first as { voicebankSlug: string }).voicebankSlug
		expect([w.mira.slug, w.sol.slug]).toContain(picked)
		expect((await fields(w))[keyOf(ref)]).toBe(picked)

		// Second line reuses the stored pick; even a hand-moved valid pick is honoured (sticky).
		const other = picked === w.mira.slug ? w.sol.slug : w.mira.slug
		await db.update(schema.sessions).set({ genreFields: { [keyOf(ref)]: other } }).where(eq(schema.sessions.id, w.session.id))
		const second = await resolveVoice({ speakerRef: ref as never, sessionId: w.session.id, loadoutId: w.loadout.id, rememberAuto: true }, db as never)
		expect(second).toMatchObject({ ok: true, from: "auto", voicebankSlug: other })
		expect((await fields(w))[keyOf(ref)]).toBe(other)
	})

	it("a preview resolution (no rememberAuto) writes nothing", async () => {
		const { resolveVoice } = await import("./resolveVoice")
		const w = await world()
		const npc = await w.speaker()
		const ref = `character:${npc.id}`
		const r = await resolveVoice({ speakerRef: ref as never, sessionId: w.session.id, loadoutId: w.loadout.id }, db as never)
		expect(r).toMatchObject({ ok: true, from: "auto" })
		expect(await fields(w)).toEqual({})
	})

	it("a disabled picked entry is dropped and re-picked", async () => {
		const { resolveVoice } = await import("./resolveVoice")
		const w = await world()
		const npc = await w.speaker()
		const ref = `character:${npc.id}`
		const a = (await resolveVoice({ speakerRef: ref as never, sessionId: w.session.id, loadoutId: w.loadout.id, rememberAuto: true }, db as never)) as { voicebankSlug: string }
		const row = a.voicebankSlug === w.mira.slug ? w.mira : w.sol
		await db.update(schema.voicebankVoices).set({ enabled: false } as never).where(eq(schema.voicebankVoices.id, row.id))
		const b = (await resolveVoice({ speakerRef: ref as never, sessionId: w.session.id, loadoutId: w.loadout.id, rememberAuto: true }, db as never)) as { from: string; voicebankSlug: string }
		expect(b.from).toBe("auto")
		expect(b.voicebankSlug).not.toBe(a.voicebankSlug)
		expect(b.voicebankSlug).not.toBe(w.bruno.slug)
		expect((await fields(w))[keyOf(ref)]).toBe(b.voicebankSlug)
		// Only the narrator left: Auto has nothing; the narrator speaks and the stale key is gone.
		const left = b.voicebankSlug === w.mira.slug ? w.mira : w.sol
		await db.update(schema.voicebankVoices).set({ enabled: false } as never).where(eq(schema.voicebankVoices.id, left.id))
		const c = await resolveVoice({ speakerRef: ref as never, sessionId: w.session.id, loadoutId: w.loadout.id, rememberAuto: true }, db as never)
		expect(c).toMatchObject({ ok: true, from: "loadout-voice", voicebankSlug: w.bruno.slug })
		expect(keyOf(ref) in (await fields(w))).toBe(false)
	})

	it("a pinned other-speakers voice beats Auto, and an off pin falls through to Auto", async () => {
		const { resolveVoice, speakerFallbackVoice } = await import("./resolveVoice")
		const w = await world()
		const npc = await w.speaker()
		const ref = `character:${npc.id}`
		await db.update(schema.loadouts).set({ otherSpeakersVoiceId: w.sol.id } as never).where(eq(schema.loadouts.id, w.loadout.id))
		const input = { speakerRef: ref as never, sessionId: w.session.id, loadoutId: w.loadout.id, rememberAuto: true }
		expect(await resolveVoice(input, db as never)).toMatchObject({ ok: true, from: "other-speakers", voicebankSlug: w.sol.slug })
		expect(await fields(w)).toEqual({})
		expect(await speakerFallbackVoice(db as never, { sessionId: w.session.id, speakerRef: ref, loadoutId: w.loadout.id })).toMatchObject({ kind: "other-speakers", slug: w.sol.slug })
		await db.update(schema.voicebankVoices).set({ enabled: false } as never).where(eq(schema.voicebankVoices.id, w.sol.id))
		const r = await resolveVoice(input, db as never)
		expect(r).toMatchObject({ ok: true, from: "auto", voicebankSlug: w.mira.slug })
		if (r.ok) expect(r.skipped[0]).toMatchObject({ from: "other-speakers", slug: w.sol.slug })
	})

	it("a session narrator override wins the narrator chain; the loadout's first entry covers a missing loadout voice", async () => {
		const { resolveVoice } = await import("./resolveVoice")
		const w = await world()
		await db.update(schema.sessions).set({ genreFields: { speechNarratorVoice: w.sol.slug } }).where(eq(schema.sessions.id, w.session.id))
		const base = { speakerRef: null, cueVoice: "narrator" as const, sessionId: w.session.id, loadoutId: w.loadout.id }
		expect(await resolveVoice(base, db as never)).toMatchObject({ ok: true, from: "session", voicebankSlug: w.sol.slug })
		await db.update(schema.sessions).set({ genreFields: {} }).where(eq(schema.sessions.id, w.session.id))
		await db.update(schema.voicebankVoices).set({ enabled: false } as never).where(eq(schema.voicebankVoices.id, w.bruno.id))
		const r = await resolveVoice(base, db as never)
		expect(r).toMatchObject({ ok: true, from: "loadout-first", voicebankSlug: w.mira.slug })
		if (r.ok) expect(r.skipped[0]).toMatchObject({ from: "loadout-voice" })
	})

	it("the auto key survives a settings-form write and a preset-free update", async () => {
		const w = await world()
		const ref = "character:99"
		await db.update(schema.sessions).set({ genreFields: { [keyOf(ref)]: w.mira.slug } }).where(eq(schema.sessions.id, w.session.id))
		const { sessionsUpdateSettingHandler } = await import("$lib/server/sockets/sessionSettings")
		const sock = { user: { id: w.user.id, isAdmin: false }, io: { to: () => ({ emit: () => {} }) } } as never
		await sessionsUpdateSettingHandler.handler(
			sock,
			{ sessionId: w.session.id, address: { kind: "genre", key: "speechEnvoyVoice:mascot" }, value: "" } as never,
			() => {}
		)
		await sessionsUpdateSettingHandler.handler(
			sock,
			{ sessionId: w.session.id, address: { kind: "genre", key: "speechNarratorVoice" }, value: "" } as never,
			() => {}
		)
		expect((await fields(w))[keyOf(ref)]).toBe(w.mira.slug)
	})
})
