/**
 * Speech build, lane V3a: the write-time check of the session narrator voice
 * (`speechNarratorVoice`, `narratorVoiceRefusal`) through `sessions:updateSetting`,
 * and whether the OTHER writers of `sessions.genre_fields` (session create, a
 * preset's pins, `sessions:update`) can store an invalid one around it.
 *
 * The bypass tests assert the INTENDED behaviour (an unknown voice is never stored);
 * each now passes (lane V V-3 fixed 2026-10-28 by the lead).
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
		getCryptoSecretKey: () => "narrator-voice-test-secret"
	}
})

let db: TestDb
let dataDir: string
const STORY = "core:genre/story"
const KEY = "speechNarratorVoice"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-narrator-voice-")
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

const noEmit = () => {}
const fakeSocket = (userId: number) =>
	({
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	}) as never

let seq = 0
async function makeUser() {
	const [u] = await db
		.insert(schema.users)
		.values({ username: `narr-voice-${++seq}` })
		.returning()
	return u!
}

async function voice(slug: string, enabled = true) {
	const [r] = await db
		.insert(schema.voicebankVoices)
		.values({ slug, name: slug, voiceId: `vid-${slug}`, enabled })
		.returning()
	return r!
}

beforeEach(async () => {
	await db.delete(schema.voicebankVoices)
})

async function presetId(seedKey = "core-story-living") {
	const [p] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, seedKey))
	return p!.id
}

/** A story session born the way the other int tests make one (a row, with the preset). */
async function makeSession(genreFields: Record<string, unknown> = {}) {
	const user = await makeUser()
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: `Narr Book ${seq}`, userId: user.id })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			lorebookId: lorebook!.id,
			genreId: STORY,
			presetId: await presetId(),
			primaryRuleset: "core:ruleset/freeform@1",
			rigour: "prose",
			genreFields
		} as never)
		.returning()
	return { user, session: session! }
}

const stored = async (sessionId: number) =>
	((
		await db
			.select({ f: schema.sessions.genreFields })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
	)[0]!.f ?? {}) as Record<string, unknown>

async function setNarrator(
	w: Awaited<ReturnType<typeof makeSession>>,
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
			address: { kind: "genre", key: KEY },
			value
		} as never,
		(event: string, data: any) => void out.push({ event, data })
	)
	return out.find((o) => o.event === "sessions:updateSetting")!.data as {
		error?: string
	}
}

describe("narratorVoiceRefusal", () => {
	test("blank, whitespace, null, undefined and non-strings are 'none' and accepted", async () => {
		const { narratorVoiceRefusal } = await import(
			"$lib/server/speech/narratorVoiceCheck"
		)
		for (const v of ["", "   ", null, undefined, 3, {}])
			expect(
				await narratorVoiceRefusal(db as never, v),
				String(v)
			).toBeNull()
	})

	test("unknown slug and disabled slug get the exact sentences; an enabled one passes", async () => {
		const { narratorVoiceRefusal } = await import(
			"$lib/server/speech/narratorVoiceCheck"
		)
		await voice("on")
		await voice("off", false)
		expect(await narratorVoiceRefusal(db as never, "ghost")).toBe(
			'No voice in the voicebank is named "ghost".'
		)
		expect(await narratorVoiceRefusal(db as never, "off")).toBe(
			'The voice "off" is turned off — pick another or turn it back on in the voicebank.'
		)
		expect(await narratorVoiceRefusal(db as never, "on")).toBeNull()
		expect(await narratorVoiceRefusal(db as never, "  on  ")).toBeNull()
	})
})

describe("sessions:updateSetting on the narrator voice", () => {
	test("an enabled slug saves; null resets (deletes the key); unknown and disabled are refused with nothing stored", async () => {
		const w = await makeSession()
		await voice("on")
		await voice("off", false)

		const ok = await setNarrator(w, "on")
		expect(ok.error).toBeUndefined()
		expect((await stored(w.session.id))[KEY]).toBe("on")

		const ghost = await setNarrator(w, "ghost")
		expect(ghost.error).toBe(
			'No voice in the voicebank is named "ghost". Nothing was saved.'
		)
		expect((await stored(w.session.id))[KEY]).toBe("on")

		const off = await setNarrator(w, "off")
		expect(off.error).toBe(
			'The voice "off" is turned off — pick another or turn it back on in the voicebank. Nothing was saved.'
		)
		expect((await stored(w.session.id))[KEY]).toBe("on")

		const cleared = await setNarrator(w, null)
		expect(cleared.error).toBeUndefined()
		expect(KEY in (await stored(w.session.id))).toBe(false)
	})

	test("a blank string saves (no refusal) and does not leave a stray voice behind", async () => {
		const w = await makeSession()
		await voice("on")
		await setNarrator(w, "on")
		const res = await setNarrator(w, "")
		expect(res.error).toBeUndefined()
		const after = (await stored(w.session.id))[KEY]
		expect(after === undefined || after === "" || after === null).toBe(true)
	})
})

describe("do the other writers bypass the check?", () => {
	it("sessions:create with a genreFields.speechNarratorVoice naming no voice is refused", async () => {
		const { sessionsCreateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const user = await makeUser()
		const res: any = await sessionsCreateHandler
			.handler(
				fakeSocket(user.id),
				{
					session: {
						name: "Bypass",
						genreId: STORY,
						genreFields: { [KEY]: "ghost-voice" }
					},
					characterIds: [],
					personaIds: []
				} as never,
				noEmit
			)
			.catch((e: Error) => ({ error: e.message }))
		// Refused, like the settings form and update: no session is made.
		expect(res.error).toMatch(
			/No voice in the voicebank is named "ghost-voice"/
		)
		expect(res.session).toBeUndefined()
	})

	it("sessions:create with a DISABLED voice is refused", async () => {
		await voice("muted", false)
		const { sessionsCreateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const user = await makeUser()
		const res: any = await sessionsCreateHandler
			.handler(
				fakeSocket(user.id),
				{
					session: {
						name: "Bypass2",
						genreId: STORY,
						genreFields: { [KEY]: "muted" }
					},
					characterIds: [],
					personaIds: []
				} as never,
				noEmit
			)
			.catch((e: Error) => ({ error: e.message }))
		expect(res.error).toMatch(/turned off/)
		expect(res.session).toBeUndefined()
	})

	it("sessions:update with genreFields.speechNarratorVoice naming no voice does not store it", async () => {
		const w = await makeSession()
		const { sessionsUpdateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res: any = await sessionsUpdateHandler
			.handler(
				fakeSocket(w.user.id),
				{
					session: {
						id: w.session.id,
						genreFields: { [KEY]: "ghost-voice" }
					}
				} as never,
				noEmit
			)
			.catch((e: Error) => ({ error: e.message }))
		console.log(
			"[V3a] update result:",
			JSON.stringify(res?.error ?? "ok"),
			"stored:",
			JSON.stringify(await stored(w.session.id))
		)
		expect((await stored(w.session.id))[KEY]).toBeUndefined()
	})

	test("a preset that pins a narrator voice naming no voice: create from it does not store the pin", async () => {
		const [p] = await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, "core-story-living"))
		const before = p!.settings
		await db
			.update(schema.sessionPresets)
			.set({
				settings: { ...(before ?? {}), [KEY]: "ghost-pinned" } as never
			})
			.where(eq(schema.sessionPresets.id, p!.id))
		try {
			const { sessionsCreateHandler } = await import(
				"$lib/server/sockets/sessions"
			)
			const user = await makeUser()
			const created: any = await sessionsCreateHandler.handler(
				fakeSocket(user.id),
				{
					session: { name: "Pinned", presetId: p!.id },
					characterIds: [],
					personaIds: []
				} as never,
				noEmit
			)
			expect(
				created.error ?? null,
				"the preset create must succeed for this test to mean anything"
			).toBeNull()
			const fields = await stored(created.session.id)
			console.log(
				"[V3a] preset create stored genre_fields:",
				JSON.stringify(fields)
			)
			expect(fields[KEY]).toBeUndefined()
		} finally {
			await db
				.update(schema.sessionPresets)
				.set({ settings: before })
				.where(eq(schema.sessionPresets.id, p!.id))
		}
	})
})
