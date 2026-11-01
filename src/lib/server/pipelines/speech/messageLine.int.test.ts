/**
 * `messageLineFor` and `sessionSpeechSettings` against real rows (speech build,
 * lane D follow-up ★1 and S7; verified by lane V).
 */
import { describe, it, expect, beforeAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { insertLegacy } from "$lib/server/messages/store"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { messageLineFor } from "./messageLine"
import { sessionSpeechSettings } from "./sessionSpeech"
import { SPEECH_TEMPLATE_IDS } from "$lib/shared/sessions/speechSettings"

// DB setup under load.
vi.setConfig({ testTimeout: 60_000 })

let db: TestDb
let userId: number
let sessionId: number
let otherSessionId: number
let charId: number
let personaId: number

const row = (over: Record<string, unknown> = {}) =>
	insertLegacy(db, {
		sessionId,
		role: "character",
		content: "A line.",
		...over
	} as any)

beforeAll(async () => {
	db = await createTestDb()
	// The genre declares the speech fields; stored values are read for declared keys only.
	await bootstrapPipelines(db)
	const [u] = await db.insert(schema.users).values({ username: "v3b-line", isAdmin: false }).returning()
	userId = u.id
	sessionId = (await db.insert(schema.sessions).values({ userId, isGroup: false }).returning())[0]!.id
	otherSessionId = (await db.insert(schema.sessions).values({ userId, isGroup: false }).returning())[0]!.id
	charId = (await db.insert(schema.characters).values({ userId, name: "Ada", description: "" }).returning())[0]!.id
	personaId = (
		await db.insert(schema.characters).values({ userId, name: "Pat", description: "", isPersona: true }).returning()
	)[0]!.id
}, 60_000)

describe("messageLineFor", () => {
	it("null for another session's row, a hidden row, a generating row, a missing row", async () => {
		const other = await insertLegacy(db, { sessionId: otherSessionId, role: "character", content: "x", characterId: charId } as any)
		const hidden = await row({ characterId: charId, isHidden: true })
		const generating = await row({ characterId: charId, isGenerating: true })
		expect(await messageLineFor(db, sessionId, other.id)).toBeNull()
		expect(await messageLineFor(db, sessionId, hidden.id)).toBeNull()
		expect(await messageLineFor(db, sessionId, generating.id)).toBeNull()
		expect(await messageLineFor(db, sessionId, 987654321)).toBeNull()
		// the other session reads its own
		expect((await messageLineFor(db, otherSessionId, other.id))?.text).toBe("x")
	})

	it("speaker: envoy ref, persona, character; narration and bare user give null", async () => {
		const envoy = await row({ metadata: { speaker: "envoy:castellan" } })
		expect((await messageLineFor(db, sessionId, envoy.id))?.speakerRef).toBe("envoy:castellan")
		// an envoy ref wins over the card ids on the row
		const envoyOverChar = await row({ characterId: charId, metadata: { speaker: "envoy:castellan" } })
		expect((await messageLineFor(db, sessionId, envoyOverChar.id))?.speakerRef).toBe("envoy:castellan")
		const persona = await row({ role: "user", personaId })
		expect((await messageLineFor(db, sessionId, persona.id))?.speakerRef).toBe(`character:${personaId}`)
		const ch = await row({ characterId: charId })
		expect((await messageLineFor(db, sessionId, ch.id))?.speakerRef).toBe(`character:${charId}`)
		const narr = await row({ role: "narrator", isNarratorResponse: true })
		expect((await messageLineFor(db, sessionId, narr.id))?.speakerRef).toBeNull()
		const user = await row({ role: "user" })
		const line = await messageLineFor(db, sessionId, user.id)
		expect(line?.speakerRef).toBeNull()
		expect(line?.text).toBe("A line.")
	})

	it("a non-envoy metadata.speaker is not trusted", async () => {
		const r = await row({ characterId: charId, metadata: { speaker: "character:999" } })
		expect((await messageLineFor(db, sessionId, r.id))?.speakerRef).toBe(`character:${charId}`)
	})

	it("sprite label from metadata.sprite.label (trimmed); absent or blank is null", async () => {
		const withSprite = await row({ characterId: charId, metadata: { sprite: { label: " joy " } } })
		expect((await messageLineFor(db, sessionId, withSprite.id))?.spriteLabel).toBe("joy")
		const none = await row({ characterId: charId })
		expect((await messageLineFor(db, sessionId, none.id))?.spriteLabel).toBeNull()
		const blank = await row({ characterId: charId, metadata: { sprite: { label: "  " } } })
		expect((await messageLineFor(db, sessionId, blank.id))?.spriteLabel).toBeNull()
	})
})

describe("sessionSpeechSettings (S7)", () => {
	const mk = async (genreFields: Record<string, unknown> | null) => {
		const [s] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false, ...(genreFields ? { genreFields } : {}) } as any)
			.returning()
		return s!.id
	}

	it("defaults when nothing is set: read aloud off, template null", async () => {
		const id = await mk(null)
		const s = await sessionSpeechSettings(db, id)
		expect(s.readAloud).toBe("off")
		expect(s.template).toBeNull()
		expect(s.narratorVoice).toBeNull()
		expect(s.language).toBeNull()
	})

	it("reads speechReadAloud / speechTemplate / speechNarratorVoice / sessionLanguage from genre_fields", async () => {
		const id = await mk({
			speechReadAloud: "make",
			speechTemplate: SPEECH_TEMPLATE_IDS.dialogue,
			speechNarratorVoice: "narrator-1",
			sessionLanguage: "FR"
		})
		const s = await sessionSpeechSettings(db, id)
		expect(s).toEqual({
			readAloud: "make",
			template: SPEECH_TEMPLATE_IDS.dialogue,
			narratorVoice: "narrator-1",
			language: "fr"
		})
	})

	it("play mode; an unknown mode or template falls back to defaults", async () => {
		const play = await sessionSpeechSettings(db, await mk({ speechReadAloud: "play" }))
		expect(play.readAloud).toBe("play")
		const junk = await sessionSpeechSettings(db, await mk({ speechReadAloud: "loud", speechTemplate: "core:template/nope@1" }))
		expect(junk.readAloud).toBe("off")
		expect(junk.template).toBeNull()
	})

	it("a missing session reads as the defaults and does not throw", async () => {
		const s = await sessionSpeechSettings(db, 987654321)
		expect(s.readAloud).toBe("off")
		expect(s.template).toBeNull()
	})
})
