/**
 * The reading rule (PLAN-composer-attachments §3.2, phase 3; owner D1/D3).
 *
 *  - the standard reply on an Anthropic pair reads images and PDFs;
 *  - on a KoboldCPP pair with vision unproven, images are refused with the
 *    capability sentence, which names no connection;
 *  - an Adventure reply: each reading call answers for itself and the union
 *    decides (D1);
 *  - a session whose reply nothing reads (no genre) refuses images and PDFs
 *    and still takes text files;
 *  - a Lair reply lists every voice of the reply as its own reading call;
 *  - a pair on the completion wire is told to switch to chat.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb(), getCryptoSecretKey: () => "readers-secret" }
})

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })
const T = 60_000

let db: TestDb
let dataDir: string
let userId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-attachment-readers-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const [user] = await db
		.insert(schema.users)
		.values({ username: "readers-user", isAdmin: false })
		.returning()
	userId = user.id
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function pair(type: string, model: string, extra: Record<string, unknown> = {}) {
	const [connection] = await db
		.insert(schema.connections)
		.values({ name: `${type} endpoint`, type, ...extra } as any)
		.returning()
	const [row] = await db
		.insert(schema.connectionModels)
		.values({ connectionId: connection.id, model, name: model })
		.returning()
	return { connectionId: connection.id, connectionModelId: row.id }
}

async function useDefault(p: { connectionId: number; connectionModelId: number }) {
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", p)
}

async function session(genreId: string | null) {
	const [row] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, ...(genreId ? { genreId } : {}) } as any)
		.returning()
	return row.id
}

async function readers(sessionId: number) {
	const { attachmentReaders } = await import("./readers")
	return attachmentReaders(db as any, { sessionId, userId })
}

describe("attachmentReaders (PGlite integration)", () => {
	test(
		"the standard reply on an Anthropic pair reads images, PDFs and text",
		async () => {
			await useDefault(await pair("anthropic", "claude-sonnet-4-5"))
			const r = await readers(await session("core:genre/story"))
			expect(r.calls.length).toBeGreaterThan(0)
			expect(r.kinds.image).toEqual({ allowed: true })
			expect(r.kinds.pdf).toEqual({ allowed: true })
			expect(r.kinds.text).toEqual({ allowed: true })
			expect(r.calls[0].reads).toEqual(["image", "text", "pdf"])
			// 🚧 O4: the Messages API sends no sound or video — those are
			// named, and with no Transcription model set up, not heard either.
			expect(r.calls[0].placeholderFor).toEqual(["audio", "video"])
			expect(r.calls[0].transcribes).toBeUndefined()
			expect(r.kinds.audio.allowed).toBe(false)
			expect(r.kinds.audio.reason).toMatch(/^No model in this reply can read audio files\./)
			expect(r.calls[0].connection?.type).toBe("anthropic")
			expect(r.accepts.image).toContain("image/png")
			expect(r.accepts.pdf).toContain("application/pdf")
			expect(r.limits.filesPerMessage).toBe(10)
		},
		T
	)

	test(
		"a KoboldCPP pair with vision unproven refuses images, naming no connection",
		async () => {
			await useDefault(await pair("koboldcpp", "nemo-12b"))
			const r = await readers(await session("core:genre/story"))
			expect(r.kinds.image.allowed).toBe(false)
			expect(r.kinds.image.reason).toMatch(/^No model in this reply can read images\./)
			expect(r.kinds.image.reason).not.toContain("koboldcpp endpoint")
			expect(r.kinds.pdf.allowed).toBe(false)
			expect(r.kinds.text).toEqual({ allowed: true })
			expect(r.accepts.image).toEqual([])
			expect(r.calls[0].reads).toEqual(["text"])
			expect(r.calls[0].placeholderFor).toEqual(["image", "pdf", "audio", "video"])
			expect(r.calls[0].reasons.image).toBeTruthy()
		},
		T
	)

	test(
		"a planner's reply: every reading call answers, and the union decides (D1)",
		async () => {
			// The Lair's reply, as Adventure's was until 2026-10-19: a planner
			// that answers JSON and narration somebody reads.
			await useDefault(await pair("anthropic", "claude-opus"))
			const r = await readers(await session("core:genre/lair"))
			// The planner answers JSON and is not a reading call; the
			// narration is.
			expect(r.calls.length).toBeGreaterThan(0)
			expect(r.calls.every((c) => c.label.length > 0)).toBe(true)
			expect(r.kinds.image.allowed).toBe(true)
			expect(new Set(r.calls.map((c) => c.key)).size).toBe(r.calls.length)
			const keys = r.calls.map((c) => c.key)
			expect(keys).toContain("via.narrate.say")
			expect(keys).not.toContain("via.turn.channel.story.pick.planned.planWrite")
			expect(r.calls.find((c) => c.key === "via.narrate.say")?.label).toBe("Castellan's narration")
		},
		T
	)

	test(
		"a session whose reply nothing reads refuses images and PDFs, and takes text",
		async () => {
			// A genre nothing declares: no reply spec, so no reading call.
			const r = await readers(await session("test:genre/unheard-of"))
			expect(r.calls).toEqual([])
			expect(r.kinds.image.allowed).toBe(false)
			expect(r.kinds.image.reason).toMatch(/Nothing in this session's reply reads images/)
			expect(r.kinds.pdf.allowed).toBe(false)
			expect(r.kinds.text.allowed).toBe(true)
		},
		T
	)

	test(
		"a Lair reply: every voice of the reply is a reading call, each with its own heading",
		async () => {
			await useDefault(await pair("anthropic", "claude-haiku"))
			const r = await readers(await session("core:genre/lair"))
			const labels = r.calls.map((c) => c.label)
			expect(labels).toContain("Character turn")
			expect(new Set(labels).size).toBe(labels.length)
			expect(r.calls.every((c) => c.reads.includes("image"))).toBe(true)
		},
		T
	)

	test(
		"the action specs read the transcript too: each is its own reading call (2026-10-03)",
		async () => {
			await useDefault(await pair("anthropic", "claude-opus-4"))
			const r = await readers(await session("core:genre/story"))
			const byKey = new Map(r.calls.map((c) => [c.key, c]))
			// The reply's calls keep their node keys and headings, first.
			expect(r.calls[0].key).not.toContain("#")
			// Look, Ask and the form answer, keyed by spec and node, headed by name.
			expect(byKey.get("core:spec/story-look#write")?.label).toBe("Look")
			expect(byKey.get("core:spec/story-ask#write")?.label).toBe("Ask")
			expect(byKey.get("core:spec/story-answer-form#generate")?.label).toBe("Form answers")
			expect(byKey.get("core:spec/story-look#write")?.reads).toEqual(["image", "text", "pdf"])
			expect(new Set(r.calls.map((c) => c.key)).size).toBe(r.calls.length)
			expect(new Set(r.calls.map((c) => c.label)).size).toBe(r.calls.length)
		},
		T
	)

	test("a pair on the completion wire is told to switch to chat", async () => {
		const { pairReads, COMPLETION_WIRE, NOT_SENT_BY_TYPE } = await import("./readers")
		// A type whose code sends files on chat, asked on completion.
		const { ADAPTER_MANIFEST } = await import("$lib/shared/connectionAdapters/manifest")
		const prior = ADAPTER_MANIFEST.koboldcpp.sendsAttachments
		ADAPTER_MANIFEST.koboldcpp.sendsAttachments = { chat: true, completion: false }
		try {
			const verdict = await pairReads({
				type: "koboldcpp",
				capabilities: { overrides: { "text+image->text": true } },
				wireMode: "completion"
			})
			expect(verdict.image).toBe(COMPLETION_WIRE("image"))
		} finally {
			ADAPTER_MANIFEST.koboldcpp.sendsAttachments = prior
		}
		// A type whose code sends no files at all says so, whatever the model can
		// do. Every text type sends on chat since phase 4, so one is made mute.
		const priorOllama = ADAPTER_MANIFEST.ollama.sendsAttachments
		ADAPTER_MANIFEST.ollama.sendsAttachments = undefined
		try {
			const none = await pairReads({
				type: "ollama",
				capabilities: { overrides: { "text+image->text": true } },
				wireMode: "chat"
			})
			expect(none.image).toBe(NOT_SENT_BY_TYPE("image"))
		} finally {
			ADAPTER_MANIFEST.ollama.sendsAttachments = priorOllama
		}
	})
})

// ── 🚧 Sounds (O2, O4, O9) ───────────────────────────────────────────────────
describe("attachmentReaders — sounds", () => {
	test(
		"a pair that hears takes audio files; a format the wire takes is offered",
		async () => {
			// OpenAI's own preset asserts hearing (`openai-official`).
			const p = await pair("openai", "gpt-4o-audio-preview", { preset: "openai-official" })
			await useDefault(p)
			const r = await readers(await session("core:genre/story"))
			expect(r.kinds.audio).toEqual({ allowed: true })
			expect(r.calls[0].reads).toContain("audio")
			expect(r.accepts.audio).toContain("audio/mpeg")
			// Video stays named: no adapter sends one.
			expect(r.kinds.video.allowed).toBe(false)
		},
		T
	)

	test(
		"a pair that cannot hear, with a Transcription model set up, has audio heard for it",
		async () => {
			const hearer = await pair("openai", "whisper-1", { preset: "openai-official" })
			const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
			await setCapabilityDefault(db, "audio->text", hearer)
			await useDefault(await pair("anthropic", "claude-sonnet-4-5"))
			const r = await readers(await session("core:genre/story"))
			expect(r.kinds.audio).toEqual({ allowed: true })
			expect(r.calls[0].reads).not.toContain("audio")
			expect(r.calls[0].transcribes).toEqual(["audio"])
			expect(r.calls[0].reasons.audio).toMatch(/transcribe step hears it first/)
		},
		T
	)
})
