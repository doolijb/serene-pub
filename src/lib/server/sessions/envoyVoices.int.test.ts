/**
 * Speech follow-ups B6: the envoy voices family (`speechEnvoyVoice:<slug>` …)
 * through `sessions:updateSetting` and the settings form's `speechEnvoys`.
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

// DB setup under load.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		db,
		dbReady: Promise.resolve(),
		getCryptoSecretKey: () => "envoy-voice-test-secret"
	}
})

let db: TestDb
let dataDir: string
const GUIDE = "core:genre/guide"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-envoy-voice-")
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

const fakeSocket = (userId: number) =>
	({
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	}) as never

let seq = 0
async function voice(slug: string, enabled = true) {
	await db
		.insert(schema.voicebankVoices)
		.values({ slug, name: slug, voiceId: `vid-${slug}`, enabled })
}
beforeEach(async () => {
	await db.delete(schema.voicebankVoices)
})

async function makeSession() {
	const [user] = await db
		.insert(schema.users)
		.values({ username: `envoy-voice-${++seq}` })
		.returning()
	const [p] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-story-living"))
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: `Envoy Book ${seq}`, userId: user!.id })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user!.id,
			isGroup: false,
			lorebookId: lorebook!.id,
			genreId: GUIDE,
			presetId: p!.id,
			primaryRuleset: "core:ruleset/freeform@1",
			rigour: "prose",
			genreFields: {}
		} as never)
		.returning()
	const { seatEnvoy } = await import("$lib/server/pipelines/entities/envoys")
	await seatEnvoy(db as never, session!.id, "mascot")
	return { user: user!, session: session! }
}

const stored = async (sessionId: number) =>
	((
		await db
			.select({ f: schema.sessions.genreFields })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
	)[0]!.f ?? {}) as Record<string, unknown>

async function set(
	w: Awaited<ReturnType<typeof makeSession>>,
	key: string,
	value: unknown
) {
	const { sessionsUpdateSettingHandler } = await import(
		"$lib/server/sockets/sessionSettings"
	)
	const out: Array<{ event: string; data: any }> = []
	await sessionsUpdateSettingHandler.handler(
		fakeSocket(w.user.id),
		{
			sessionId: w.session.id,
			address: { kind: "genre", key },
			value
		} as never,
		(event: string, data: any) => void out.push({ event, data })
	)
	return out.find((o) => o.event === "sessions:updateSetting")!.data as {
		error?: string
		form?: any
	}
}

describe("envoy voices through sessions:updateSetting", () => {
	test("the form lists the seated envoy with blank fields; saves land and come back in the form", async () => {
		const w = await makeSession()
		await voice("mira")
		const ok = await set(w, "speechEnvoyVoice:mascot", "mira")
		expect(ok.error).toBeUndefined()
		expect((await stored(w.session.id))["speechEnvoyVoice:mascot"]).toBe(
			"mira"
		)
		const e = ok.form.speechEnvoys.find((x: any) => x.slug === "mascot")
		expect(e.voice.value).toBe("mira")
		expect(e.description).toBeUndefined()
		expect(e.narrationDescription).toBeUndefined()
		expect(
			(await set(w, "speechEnvoyNarrationVoice:mascot", "mira")).error
		).toBeUndefined()
	})

	test("rows carry the fallback; the narrator line hides loadouts from a member", async () => {
		const w = await makeSession()
		const ok = await set(w, "speechEnvoyVoice:mascot", null)
		const e = ok.form.speechEnvoys.find((x: any) => x.slug === "mascot")
		expect(["other-speakers", "auto", "narrator"]).toContain(
			e.fallback.kind
		)
		expect(e.fallback).toHaveProperty("voiceName")
		expect(e.fallback.slug).toBeUndefined()
		expect(ok.form.speechNarrator).toBeDefined()
		expect(ok.form.speechNarrator.loadoutName).toBeUndefined()
		const [lo] = await db
			.insert(schema.loadouts)
			.values({
				slug: "narration-test",
				name: "Narration",
				transform: "text->audio",
				seedKey: "core:loadout/tts@1"
			} as never)
			.returning()
		const { settingsForm } = await import(
			"$lib/server/sessions/settingsForm"
		)
		const asAdmin = await settingsForm(db as never, w.session.id, {
			userId: w.user.id,
			isAdmin: true
		})
		expect(asAdmin.speechNarrator).toBeDefined()
		expect(asAdmin.speechNarrator!.loadoutName).toBe("Narration")
		const asMember = await settingsForm(db as never, w.session.id, {
			userId: w.user.id,
			isAdmin: false
		})
		expect(asMember.speechNarrator!.loadoutName).toBeUndefined()
		await db.delete(schema.loadouts).where(eq(schema.loadouts.id, lo!.id))
	})

	test("two voices on the speaking loadout: the narrator gets the default, an envoy gets the other, said so", async () => {
		const w = await makeSession()
		await db.delete(schema.voicebankVoices)
		const [conn] = await db
			.insert(schema.connections)
			.values({
				name: "KCPP tts",
				type: "ollama",
				baseUrl: "http://localhost:5001",
				modality: "text-gen"
			} as never)
			.returning()
		const [model] = await db
			.insert(schema.connectionModels)
			.values({
				connectionId: conn!.id,
				model: "kokoro",
				name: "kokoro",
				facts: {}
			} as never)
			.returning()
		const [lo] = await db
			.insert(schema.loadouts)
			.values({
				slug: "narration-two",
				name: "Narration",
				transform: "text->audio",
				seedKey: "core:loadout/tts@1",
				connectionId: conn!.id,
				connectionModelId: model!.id
			} as never)
			.returning()
		const [bruno, mira] = await db
			.insert(schema.voicebankVoices)
			.values([
				{
					slug: "bruno",
					name: "Bruno",
					voiceId: "vid-bruno",
					loadoutId: lo!.id
				},
				{
					slug: "mira",
					name: "Mira",
					voiceId: "vid-mira",
					loadoutId: lo!.id
				}
			] as never)
			.returning()
		await db
			.update(schema.loadouts)
			.set({ defaultVoiceId: bruno!.id } as never)
			.where(eq(schema.loadouts.id, lo!.id))
		const ok = await set(w, "speechEnvoyVoice:mascot", null)
		expect(ok.form.speechNarrator.voiceName).toBe("Bruno")
		const e = ok.form.speechEnvoys.find((x: any) => x.slug === "mascot")
		expect(e.fallback).toEqual({
			kind: "auto",
			voiceName: "Mira",
			reason: "avoids-narrator"
		})
		void mira
		await db.delete(schema.voicebankVoices)
		await db.delete(schema.loadouts).where(eq(schema.loadouts.id, lo!.id))
		await db
			.delete(schema.connections)
			.where(eq(schema.connections.id, conn!.id))
	})

	test("the description fields are retired: writes are refused like any unknown setting, stored values ignored", async () => {
		const w = await makeSession()
		for (const key of [
			"speechEnvoyDescription:mascot",
			"speechEnvoyNarrationDescription:mascot"
		]) {
			expect((await set(w, key, "bright and quick")).error).toBeTruthy()
			expect(key in (await stored(w.session.id))).toBe(false)
		}
	})

	test("blank or null clears the key", async () => {
		const w = await makeSession()
		await voice("mira")
		await set(w, "speechEnvoyVoice:mascot", "mira")
		expect(
			(await set(w, "speechEnvoyVoice:mascot", null)).error
		).toBeUndefined()
		expect("speechEnvoyVoice:mascot" in (await stored(w.session.id))).toBe(
			false
		)
	})

	test("an unknown envoy slug is refused, nothing stored", async () => {
		const w = await makeSession()
		await voice("mira")
		const r = await set(w, "speechEnvoyVoice:nobody", "mira")
		expect(r.error).toBe(
			'No envoy named "nobody" speaks in this session. Nothing was saved.'
		)
		expect("speechEnvoyVoice:nobody" in (await stored(w.session.id))).toBe(
			false
		)
	})

	test("an unknown or disabled voice is refused, for the voice and the narration voice", async () => {
		const w = await makeSession()
		await voice("off", false)
		for (const key of [
			"speechEnvoyVoice:mascot",
			"speechEnvoyNarrationVoice:mascot"
		]) {
			expect((await set(w, key, "ghost")).error).toBe(
				'No voice in the voicebank is named "ghost". Nothing was saved.'
			)
			expect((await set(w, key, "off")).error).toBe(
				'The voice "off" is turned off — pick another or turn it back on in the voicebank. Nothing was saved.'
			)
			expect(key in (await stored(w.session.id))).toBe(false)
		}
	})

	test("sessions:update cannot write the family around the check (only declared keys pass)", async () => {
		const w = await makeSession()
		const { sessionsUpdateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		await sessionsUpdateHandler
			.handler(
				fakeSocket(w.user.id),
				{
					session: {
						id: w.session.id,
						genreFields: { "speechEnvoyVoice:mascot": "ghost" }
					}
				} as never,
				() => {}
			)
			.catch(() => {})
		expect(
			(await stored(w.session.id))["speechEnvoyVoice:mascot"]
		).toBeUndefined()
	})
})
