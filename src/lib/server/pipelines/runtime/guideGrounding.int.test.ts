/**
 * The guide is grounded in the real docs (2026-09-27).
 *
 * The owner asked the guide "How do I start writing a plugin?" and got a
 * Python plugin system with `manifest.json`, `on_load()` and a
 * `/docs/plugins/creating-your-first-plugin` page — none of which exist —
 * then a fabricated quote defending it. The docs-search node had run, but
 * ranked the wrong sections (the SDK's *Your first plugin* guide was not
 * among them), laid them out as anonymous world lore, and the mascot's
 * prompt told the model to "say what you know" when excerpts fell short.
 *
 * These drive a real guide turn through `runReply` against the SHIPPED
 * `core:spec/guide-respond` with a fake model, and read what reached the
 * wire:
 *
 *  1. "how do I write a plugin" retrieves the SDK's your-first-plugin guide,
 *     and the prompt carries its excerpt and its real path.
 *  2. Every `/docs/…` path in the prompt is a page the compiled docs serve.
 *  3. A question the docs do not cover retrieves nothing, and the prompt
 *     says so in so many words.
 *
 * 1 and 2 read the compiled docs-dist (`src/lib/generated/docs`, written by
 * `npm run docs:build` and by the dev server); a checkout that never compiled
 * it has no docs to ground in and skips them. 3 holds either way.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { docsManifest, loadSearchIndex } from "$lib/shared/utils/docsIndex"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
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
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	broadcastToSessionUsers: async () => {}
}))

/** Every compiled prompt the adapter was handed — the wire's side. */
const compiledPrompts: any[] = []

class FakeAdapter {
	aborted = false
	abort() {
		this.aborted = true
	}
	async preflight() {}
	withStops() {
		return this
	}
	withCompiledPrompt(p: any) {
		compiledPrompts.push(p)
		return this
	}
	withStreaming() {
		return this
	}
	async generateText() {
		return {
			compiledPrompt: { prompt: "p", messages: undefined, meta: {} as any },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent("See the docs.")
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

const GUIDE = "core:genre/guide"
let userId: number

const fakeSocket = (uid: number) => ({ user: { id: uid }, io: {} }) as any
const emit = () => {}

/** Is the docs-dist compiled here? Decided once, before the suite. */
const compiled = (await loadSearchIndex()).length > 0

async function createGuideSession(name: string, lorebookId?: number) {
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(userId),
		{
			session: { name, genreId: GUIDE },
			characterIds: [],
			personaIds: [],
			characterPositions: {},
			tags: []
		} as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	if (lorebookId !== undefined) {
		const { eq } = await import("drizzle-orm")
		await db
			.update(schema.sessions)
			.set({ lorebookId })
			.where(eq(schema.sessions.id, res.session.id))
	}
	return res.session.id as number
}

/** One guide turn on a fresh session; the whole prompt text and the receipt. */
async function askGuide(question: string, lorebookId?: number) {
	const sessionId = await createGuideSession(question.slice(0, 40), lorebookId)
	await db.insert(schema.sessionMessages).values({
		sessionId,
		userId,
		role: "user",
		content: question
	} as any)
	compiledPrompts.length = 0
	const { runReply } = await import("$lib/server/utils/runReply")
	const outcome = await runReply({
		socket: fakeSocket(userId),
		emitToUser: emit,
		sessionId,
		userId,
		turn: { kind: "respond", speaker: "envoy:mascot" }
	})
	expect(outcome.error, outcome.error).toBeUndefined()
	expect(compiledPrompts.length).toBe(1)
	const compiledPrompt = compiledPrompts[0]
	const text = Array.isArray(compiledPrompt?.messages)
		? (compiledPrompt.messages as Array<{ content: string }>)
				.map((m) => m.content)
				.join("\n")
		: String(compiledPrompt?.prompt ?? "")
	const docs = outcome.receipt!.nodes.find((n) => n.nodeKey === "gather.docs.read")!
	return { text, docs, receipt: outcome.receipt! }
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-guide-grounding-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "guide-grounding")).id

	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn.id, "guide-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Default",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn.id,
		connectionModelId: modelId,
		samplingConfigId: sampling.id
	})
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe.skipIf(!compiled)("a guide turn with the docs compiled", () => {
	it("'how do I write a plugin' retrieves the SDK's your-first-plugin guide, and the prompt carries its excerpt and path", async () => {
		const { text, docs } = await askGuide("how do I write a plugin")

		expect(docs.result).toBe("ok")
		const main = (docs.output as any).main as Array<Record<string, any>>
		// Its own declared band, not a story's world lore.
		expect(main[0]).toMatchObject({ band: "docsExcerpts" })
		const hits = main.slice(1)
		expect(hits.every((h) => h.source === "docsExcerpts")).toBe(true)
		const first = hits.find((h) =>
			String(h.payload?.link).startsWith("/docs/sdk/guides/your-first-plugin")
		)
		expect(first, JSON.stringify(hits.map((h) => h.payload?.link))).toBeDefined()

		// On the wire: framed as the only documentation, with the path and
		// the excerpt's own words.
		expect(text).toContain("These are the only Serene Pub documentation you have")
		expect(text).toContain(`Path: ${first!.payload.link}`)
		const excerpt = String(first!.payload.content).split("\n").slice(1).join(" ")
		expect(text).toContain(excerpt.slice(0, 60))
		// The mascot's instructions: excerpts or nothing.
		expect(text).toContain("I couldn't find that in the docs.")
		expect(text).not.toContain("say what you know")
	})

	it("every /docs/ path in the prompt is a page the compiled docs serve — no invented paths", async () => {
		const { text } = await askGuide("How do I start writing a plugin?")
		const paths = [...text.matchAll(/\/docs\/[a-z0-9_./-]+(?:#[a-z0-9_-]+)?/gi)].map((m) => m[0])
		expect(paths.length).toBeGreaterThan(0)
		const sections = await loadSearchIndex()
		const anchors = new Set(sections.map((s) => `${s.slug}#${s.anchor}`))
		for (const p of paths) {
			const [slugPart, anchor] = p.slice("/docs/".length).split("#")
			expect(Object.hasOwn(docsManifest.pages, slugPart!), p).toBe(true)
			if (anchor) expect(anchors.has(`${slugPart}#${anchor}`), p).toBe(true)
		}
		expect(text).not.toMatch(/creating-your-first-plugin|on_load|manifest\.json/)
	})
})

describe("a question the docs do not cover", () => {
	it("retrieves nothing, and the prompt says plainly that nothing matched", async () => {
		const { text, docs } = await askGuide("What is the best sourdough bread recipe?")
		expect(docs.result).toBe("ok")
		const main = (docs.output as any).main as Array<Record<string, any>>
		expect(main).toHaveLength(1)
		expect(main[0]).toMatchObject({ band: "docsExcerpts" })
		expect(text).toContain("No documentation excerpts matched the person's latest question.")
		expect(text).toContain("I couldn't find that in the docs.")
		expect(text).not.toContain("Documentation excerpts retrieved for the person's latest question.")
	})
})

/**
 * **The guide's lorebook is read every turn** (plan A28, 2026-09-30).
 *
 * The genre declares a lorebook — "the documentation it answers out of … a
 * reference, read every turn and never added to" — and `guide-respond` read
 * none, so a book a person attached to a guide session never reached a
 * prompt. The guide's reply now reads its world lore by keyword, and its
 * template places what matched beside the docs excerpts.
 */
describe("a lorebook attached to a guide session", () => {
	async function bookWith(entry: { name: string; keys: string; content: string }) {
		const { worldLoreValues } = await import("$lib/server/pipelines/testing/fixtures")
		const [book] = await db
			.insert(schema.lorebooks)
			.values({ userId, name: `Reference ${entry.name}` })
			.returning()
		await db
			.insert(schema.lorebookEntries)
			.values(worldLoreValues([{ lorebookId: book!.id, ...entry }]))
		return book!.id
	}

	it("an entry the question names reaches the prompt, as the book's own words", async () => {
		const lorebookId = await bookWith({
			name: "Studio backups",
			keys: "backup rota",
			content: "Our studio's backup rota: the night shift copies the data folder to the blue drive."
		})
		const { text, receipt } = await askGuide("Who runs the backup rota for the studio?", lorebookId)
		expect(text).toContain("the night shift copies the data folder to the blue drive")
		const lore = receipt.nodes.find((n) => n.nodeKey === "gather.worldLore.read")
		expect(lore?.result).toBe("ok")
		// Framed as the person's own reference, not as docs it cannot cite.
		expect(text).toContain("From the lorebook attached to this session")
		expect(text).not.toContain("{{")
	})

	it("an entry the question does not name stays out, and a session with no book reads none", async () => {
		const lorebookId = await bookWith({
			name: "Unrelated",
			keys: "zeppelin",
			content: "The zeppelin hangar is closed on Sundays."
		})
		const withBook = await askGuide("How do I add a character?", lorebookId)
		expect(withBook.text).not.toContain("zeppelin hangar")
		expect(withBook.text).not.toContain("From the lorebook attached to this session")
		const without = await askGuide("How do I add a character to a session?")
		expect(without.text).not.toContain("From the lorebook attached to this session")
	})
})
