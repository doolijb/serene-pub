/**
 * The two readers that want only a session's `fields` — `sessionKeepsEveryTurn`
 * and `sessionSpeechSettings` — read them without building the whole settings
 * document: the same answers as before (frozen literals), fewer statements, and
 * the speech reader's fallback to the raw `genre_fields` when the cascade fails.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

const gate = { failPreset: false }

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "fields-readers-test-secret" }
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
vi.mock("$lib/server/sessions/exposure", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/sessions/exposure")>()
	return {
		...actual,
		presetLayerValues: async (...a: Parameters<typeof actual.presetLayerValues>) => {
			if (gate.failPreset) throw new Error("preset layer unreadable")
			return actual.presetLayerValues(...a)
		}
	}
})

const GENRES = {
	story: "core:genre/story",
	lair: "core:genre/lair",
	crawler: "core:genre/dungeon-crawler",
	guide: "core:genre/guide",
	chat: "core:genre/chat"
} as const

const OVERRIDES = {
	keepEveryTurn: false,
	speechReadAloud: "play",
	speechTemplate: "core:template/pipeline-context-template-core-spoken-line-dialogue@1",
	speechNarratorVoice: "  nora  ",
	sessionLanguage: "FR"
}
const PRESET_SETTINGS = {
	keepEveryTurn: false,
	speechReadAloud: "make",
	speechNarratorVoice: "preset-voice",
	sessionLanguage: "De"
}

/** Captured from the code before the change (the whole-document reads): what each reader answers. */
const OFF = { readAloud: "off", template: null, narratorVoice: null, language: null }
const PLAY = {
		readAloud: "play",
		template: "core:template/pipeline-context-template-core-spoken-line-dialogue@1",
		narratorVoice: "nora",
		language: "fr"
	}
const MADE = { readAloud: "make", template: null, narratorVoice: "preset-voice", language: "de" }
const FROZEN: Record<string, { keeps: boolean | undefined; speech: unknown }> = {
	"story/plain": { keeps: undefined, speech: OFF },
	"story/overrides": { keeps: undefined, speech: PLAY },
	"lair/plain": { keeps: undefined, speech: OFF },
	"lair/overrides": { keeps: undefined, speech: PLAY },
	"crawler/plain": { keeps: true, speech: OFF },
	"crawler/overrides": { keeps: false, speech: OFF },
	"guide/plain": { keeps: undefined, speech: OFF },
	"guide/overrides": { keeps: undefined, speech: PLAY },
	"chat/plain": { keeps: undefined, speech: OFF },
	"chat/overrides": { keeps: undefined, speech: OFF },
	"story/preset": { keeps: false, speech: MADE },
	"crawler/preset": { keeps: false, speech: MADE },
	"story/deleted-preset": { keeps: undefined, speech: PLAY },
	"unknown-genre": { keeps: undefined, speech: OFF },
	missing: { keeps: undefined, speech: OFF }
}

const ids: Record<string, number> = {}

async function counting<T>(fn: () => Promise<T>) {
	const client = (testDb as any).$client
	const orig = client.query
	let n = 0
	client.query = function (...a: any[]) {
		n++
		return orig.apply(this, a)
	}
	try {
		return { value: await fn(), statements: n }
	} finally {
		client.query = orig
	}
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-fieldsreaders-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: "fields-readers", isAdmin: false })
		.returning()
	const make = async (genreId: string, genreFields: Record<string, unknown> | null, presetId?: number) => {
		const [s] = await testDb
			.insert(schema.sessions)
			.values({
				userId: user!.id,
				isGroup: false,
				genreId,
				...(genreFields ? { genreFields } : {}),
				...(presetId ? { presetId } : {})
			} as any)
			.returning()
		return s!.id
	}
	for (const [k, g] of Object.entries(GENRES)) {
		ids[`${k}/plain`] = await make(g, null)
		ids[`${k}/overrides`] = await make(g, OVERRIDES)
	}
	for (const k of ["story", "crawler"] as const) {
		const [preset] = await testDb
			.insert(schema.sessionPresets)
			.values({ name: `fields preset ${k}`, genreId: GENRES[k], settings: PRESET_SETTINGS } as any)
			.returning()
		ids[`${k}/preset`] = await make(GENRES[k], null, preset!.id)
	}
	// A preset deleted after the session chose it (the session's preset pointer outlives it).
	const [gone] = await testDb
		.insert(schema.sessionPresets)
		.values({ name: "fields preset gone", genreId: GENRES.story, settings: PRESET_SETTINGS } as any)
		.returning()
	ids["story/deleted-preset"] = await make(GENRES.story, OVERRIDES, gone!.id)
	await testDb.delete(schema.sessionPresets).where(eq(schema.sessionPresets.id, gone!.id))
	// A genre no loaded genre has.
	ids["unknown-genre"] = await make("core:genre/not-loaded", OVERRIDES)
	ids["missing"] = 987654321
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("the fields-only readers", () => {
	test("each answers its frozen literal, in fewer statements than the whole document", async () => {
		const { sessionKeepsEveryTurn, resolveSessionSettings } = await import("./settings")
		const { sessionSpeechSettings } = await import("$lib/server/pipelines/speech/sessionSpeech")
		for (const [name, id] of Object.entries(ids)) {
			const keeps = await counting(() => sessionKeepsEveryTurn(testDb as any, id))
			const speech = await counting(() => sessionSpeechSettings(testDb as any, id))
			const full = await counting(() => resolveSessionSettings(testDb as any, id))
			expect(keeps.value, name).toBe(FROZEN[name]!.keeps)
			expect(speech.value, name).toStrictEqual(FROZEN[name]!.speech)
			if (name !== "missing") {
				expect(keeps.statements, name).toBeLessThan(full.statements)
				expect(speech.statements, name).toBeLessThan(full.statements)
			}
		}
	})

	test("speech falls back to the row's raw genre_fields when the cascade fails", async () => {
		const { sessionSpeechSettings } = await import("$lib/server/pipelines/speech/sessionSpeech")
		gate.failPreset = true
		try {
			expect(await sessionSpeechSettings(testDb as any, ids["story/overrides"]!)).toStrictEqual(PLAY)
			expect(await sessionSpeechSettings(testDb as any, ids["story/preset"]!)).toStrictEqual(OFF)
		} finally {
			gate.failPreset = false
		}
	})
})
