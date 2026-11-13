/**
 * 🚧 A `Name:` cue maps to a seat by the cast member as read (plan §27 S2): the
 * member's own name wins, a member with no names of its own reads the card's
 * name and nickname exactly as before, and the ref stays `character:<cardId>`.
 * The connection, adapter and voice resolver are stubbed; the DB is real.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { insertCastMember } from "$lib/server/characters/versions"
import { memberFormOn, memberFormSwitch } from "$lib/server/state/memberForm"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const synth = vi.hoisted(() => vi.fn())
const resolveSpy = vi.hoisted(() => vi.fn())

function wav(seed: number): Buffer {
	const samples = 80
	const data = Buffer.alloc(samples * 2)
	for (let i = 0; i < samples; i++)
		data.writeInt16LE(((i * 37 + seed * 101) % 2000) - 1000, i * 2)
	const h = Buffer.alloc(44)
	h.write("RIFF", 0)
	h.writeUInt32LE(36 + data.length, 4)
	h.write("WAVEfmt ", 8)
	h.writeUInt32LE(16, 16)
	h.writeUInt16LE(1, 20)
	h.writeUInt16LE(1, 22)
	h.writeUInt32LE(8000, 24)
	h.writeUInt32LE(16000, 28)
	h.writeUInt16LE(2, 32)
	h.writeUInt16LE(16, 34)
	h.write("data", 36)
	h.writeUInt32LE(data.length, 40)
	return Buffer.concat([h, data])
}

vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
	const real =
		await importOriginal<
			typeof import("$lib/server/connections/capabilityTarget")
		>()
	return {
		...real,
		resolveCapabilityTarget: async () => ({
			ok: true,
			connection: {
				id: 1,
				name: "Fake TTS",
				type: "openai-compatible",
				model: "tts-1",
				connectionModelId: null
			},
			sampling: null
		})
	}
})
vi.mock("$lib/server/connectionAdapters/speech/getSpeechAdapter", () => ({
	getSpeechAdapter: async () => ({
		Adapter: class {
			async synthesizeSpeech(req: any) {
				synth(req)
				return {
					isAborted: false,
					applied: ["voice"],
					ignored: [],
					spokenAs: { voice: req.voice ?? "v", model: "tts-1" },
					media: [
						{
							kind: "audio",
							mime: "audio/wav",
							base64: wav(synth.mock.calls.length).toString(
								"base64"
							)
						}
					]
				}
			}
		}
	})
}))
vi.mock("$lib/server/speech/resolveVoice", () => ({
	speakerSilent: async () => false,
	resolveVoice: async (input: unknown) => ({
		...(resolveSpy(input), {}),
		ok: true,
		voiceId: "voice-a",
		language: "en",
		settings: null,
		description: null,
		skipped: [],
		from: "default"
	}),
	sessionSpeechSetting: async () => null
}))

let db: TestDb
let dataDir: string
let ownerId: number
let seq = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-speakmembers-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	ownerId = (
		await db
			.insert(schema.users)
			.values({ username: "spk-members", isAdmin: false })
			.returning()
	)[0]!.id
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** A session on its own lorebook with one seated card and its member. */
async function seated(
	cardExtra: Partial<typeof schema.characters.$inferInsert>,
	memberExtra: Partial<typeof schema.lorebookBindings.$inferInsert>
) {
	const n = ++seq
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: ownerId, name: `Book ${n}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: ownerId, isGroup: true, lorebookId: book!.id } as any)
		.returning()
	const [card] = await db
		.insert(schema.characters)
		.values({
			userId: ownerId,
			name: `Card ${n}`,
			description: "",
			...cardExtra
		} as any)
		.returning()
	const member = (
		await insertCastMember(db, {
			lorebookId: book!.id,
			binding: `{{char:sm${n}}}`,
			characterId: card!.id,
			name: "",
			...memberExtra
		} as any)
	).member
	await db.insert(schema.sessionCharacters).values({
		sessionId: session!.id,
		characterId: card!.id,
		castMemberId: member!.id,
		position: 0
	} as any)
	return { sessionId: session!.id, card: card!, member: member! }
}

const speakAs = async (sessionId: number, speaker: string) => {
	resolveSpy.mockClear()
	const { dispatchSpeech } = await import("./dispatchSpeech")
	await dispatchSpeech(db, {
		sessionId,
		userId: ownerId,
		cues: [
			{ text: "Hello there", kind: "dialogue", voice: "speaker", speaker }
		]
	} as any)
	return resolveSpy.mock.calls.map(
		(c) => c[0] as { speakerRef: string | null }
	)
}

describe("dispatchSpeech — a Name: cue maps to a seat by the cast member as read", () => {
	it("a cue naming the member's own name maps to the seat's character ref", async () => {
		const { sessionId, card, member } = await seated(
			{ nickname: "Mare" },
			{ ownName: "Marenne" }
		)
		const calls = await speakAs(sessionId, "Marenne")
		// ⏳ The seat's own ref (`hostSeatRefOf`): the member form once the flip is on.
		expect(calls.map((c) => c.speakerRef)).toEqual([
			memberFormOn() ? `seated-member:${member.id}` : `character:${card.id}`
		])
	})

	it("a member with no names of its own: the card's name and its nickname map as before", async () => {
		const { sessionId, card, member } = await seated({ nickname: "Ren" }, {})
		for (const cue of [card.name, "Ren"]) {
			const calls = await speakAs(sessionId, cue)
			expect(calls.map((c) => c.speakerRef)).toEqual([
				memberFormOn() ? `seated-member:${member.id}` : `character:${card.id}`
			])
		}
	})
})

describe("dispatchSpeech — a Name: cue maps a card-less seat to its member's ref", () => {
	let switchWas = false
	beforeAll(() => {
		switchWas = memberFormSwitch.on
		memberFormSwitch.on = true
	})
	afterAll(() => {
		memberFormSwitch.on = switchWas
	})

	it("the member's name maps to seated-member:<memberId>, never character:<undefined>", async () => {
		const { sessionId, member } = await (async () => {
			const n = ++seq
			const [book] = await db
				.insert(schema.lorebooks)
				.values({ userId: ownerId, name: `Cardless Book ${n}` })
				.returning()
			const [session] = await db
				.insert(schema.sessions)
				.values({ userId: ownerId, isGroup: true, lorebookId: book!.id } as any)
				.returning()
			const member = (
				await insertCastMember(db, {
					lorebookId: book!.id,
					binding: `{{char:cl${n}}}`,
					characterId: null,
					name: "Wren",
					ownName: "Wren"
				} as any)
			).member
			await db.insert(schema.sessionCharacters).values({
				sessionId: session!.id,
				characterId: null,
				castMemberId: member!.id,
				position: 0
			} as any)
			// An envoy seat is never a cast name.
			await db.insert(schema.sessionCharacters).values({
				sessionId: session!.id,
				characterId: null,
				envoySlug: "castellan",
				position: 1
			} as any)
			return { sessionId: session!.id, member: member! }
		})()
		const calls = await speakAs(sessionId, "Wren")
		expect(calls.map((c) => c.speakerRef)).toEqual([
			`seated-member:${member.id}`
		])
	})
})
