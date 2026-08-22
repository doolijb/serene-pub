/**
 * The parity corpus, semantic arm.
 *
 * Separate from `parity.int.test.ts` because the two arms need opposite worlds:
 * that file asserts no embedding model is loaded, this one asserts there is one.
 * Mocking is per-file, and a corpus that flipped the model mid-run would be
 * comparing two different code paths under one name.
 *
 * **What is faked, and only what is faked.** The embedding model — a deterministic
 * three-axis toy — and the candidate fetch, because pgvector is not available in
 * the test database. Both paths call the *same* fakes, which is the point: what
 * is under test is the nine ranking stages and the assembly, not whether a model
 * embeds well.
 *
 * Four fixtures, all green: a single semantic hit, a crowded pool where the
 * threshold and MMR decide, a query that matches nothing, and an author's
 * priority tier competing with a better match.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { type ParityFixture, type RenderConfigs } from "./parity"
import { renderParity, parityGate, checkParity } from "@serene-pub/sdk"
import { wrapFor } from "./variableLayouts"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"

/**
 * A toy embedding: one axis per subject, so similarity is readable by eye.
 *
 * Deliberately not random and not a real model — a fixture whose expected output
 * depends on a downloaded model is a fixture nobody can reason about.
 */
function vectorFor(text: string): number[] {
	const t = text.toLowerCase()
	return [
		t.includes("ashguard") ? 1 : 0,
		t.includes("siege") ? 1 : 0,
		t.includes("forest") ? 1 : 0
	]
}

/**
 * The application database, pointed at the test one.
 *
 * Needed because `PromptBuilder`'s RAG gate reads `systemSettings.vectorizationEnabled`
 * from the **global** `db` rather than from the chat it was handed. Without this
 * mock that read finds nothing, the gate closes, and the legacy path quietly
 * runs the *keyword* engine instead — so a RAG fixture would compare the
 * pipeline's semantic arm against legacy's keyword arm and report a divergence
 * that is really a misconfiguration. See §18.
 */
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => true,
	getLoadedModelId: () => "parity-toy-model",
	embed: async (text: string) => vectorFor(text),
	batchEmbed: async (texts: string[]) => texts.map(vectorFor),
	loadConfiguredEmbeddingModelOpportunistically: async () => {},
	// Needed by MMR, and *only* by MMR — so it goes unmissed until a fixture
	// retrieves two candidates. Leaving it out made the legacy engine throw,
	// swallow the throw, and continue with no RAG results at all; the fixture
	// then read as a pipeline divergence. The real one, verbatim.
	cosineSimilarity: (a: number[], b: number[]) => {
		if (a.length !== b.length) return 0
		let dot = 0
		let normA = 0
		let normB = 0
		for (let i = 0; i < a.length; i++) {
			dot += a[i]! * b[i]!
			normA += a[i]! * a[i]!
			normB += b[i]! * b[i]!
		}
		if (normA === 0 || normB === 0) return 0
		return dot / (Math.sqrt(normA) * Math.sqrt(normB))
	}
}))

/** The candidate pool, shared by both paths — the same rows, the same order. */
let poolRows: any[] = []

vi.mock("$lib/server/embedding/ragContext", () => ({
	getChatRagContext: async () => ({ lorebookId: 1, allLorebookIds: [1] }),
	fetchScopedCandidates: async () => poolRows,
	rankScopedCandidates: (
		candidates: any[],
		query: number[],
		topK?: number
	) => {
		const dot = (a: number[], b: number[]) =>
			a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0)
		return candidates
			.map((c) => ({ ...c, score: dot(c.embedding ?? [], query) }))
			.filter((c) => c.score > 0)
			.sort((a, b) => b.score - a.score || a.id - b.id)
			.slice(0, topK ?? candidates.length)
	}
}))

let db: TestDb
let configs: RenderConfigs

/**
 * The corpus template, in both releases' terms — same split as the keyword
 * corpus, for the same reason.
 *
 * 0.6 moved the headings and fences out of the context template and into the
 * variable layouts. The pipeline renders a template that writes none and gets
 * values that carry them; 0.5's builder does the reverse. See
 * `parity.int.test.ts` for the longer note; the `{{#if}}` guards are there
 * because core's template guards and an unguarded one would compare a state no
 * install can reach.
 */
const corpusTemplate = (wrappers: "template" | "layouts") => {
	const v = (key: string) => {
		const expr = `{{{${key}}}}`
		const wrap = wrapFor(key)
		if (!wrap) return expr
		const body = wrappers === "template" ? wrap(expr) : expr
		return `{{#if ${key}}}${body}{{/if}}`
	}
	return [
		v("instructions"),
		`WORLDLORE:${v("worldLore")}`,
		"{{#each chatMessages}}{{this.name}}: {{this.message}}",
		"{{/each}}"
	].join("\n")
}

/** What the pipeline renders: structure only, wrappers supplied by layouts. */
const TEMPLATE = corpusTemplate("layouts")
/** What 0.5 rendered: the same prompt, with the wrappers typed in. */
const LEGACY_TEMPLATE = corpusTemplate("template")

beforeAll(async () => {
	// The *same* instance the mock returns, so the legacy gate, the legacy
	// builder and the pipeline all read one database. Two databases that agree
	// is not the same test.
	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb

	const [contextConfig] = await db
		.insert(schema.contextConfigs)
		.values({ name: "RAG Parity Context", template: LEGACY_TEMPLATE })
		.returning()
	const [promptConfig] = await db
		.insert(schema.promptConfigs)
		.values({
			name: "RAG Parity Prompt",
			systemPrompt: "You are {{char}}."
		})
		.returning()
	await db.insert(schema.systemSettings).values({
		id: 1,
		defaultContextConfigId: contextConfig.id,
		defaultPromptConfigId: promptConfig.id,
		vectorizationEnabled: true
	})

	configs = {
		connection: { id: 1, promptFormat: "vicuna", extraJson: {} },
		sampling: { contextTokensEnabled: false },
		contextConfig,
		promptConfig
	}
}, 60_000)

/**
 * Rows for one semantic fixture.
 *
 * Keys are deliberately unmatchable across every fixture: a result can only have
 * come from the semantic arm, so a fixture that quietly started matching keys
 * would be a keyword test wearing a RAG name.
 */
async function seedRag(
	db: any,
	lore: Array<{ name: string; content: string; priority?: number }>,
	text = "Tell me about the ashguard."
) {
	const [user] = await db
		.insert(schema.users)
		.values({ username: `rag-parity-${Date.now()}`, isAdmin: false })
		.returning()
	const [alice] = await db
		.insert(schema.characters)
		.values({
			userId: user.id,
			name: "Alice",
			description: "A knight."
		})
		.returning()
	const [bob] = await db
		.insert(schema.personas)
		.values({
			userId: user.id,
			name: "Bob",
			description: "A traveller.",
			isDefault: false
		})
		.returning()
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "RAG Lore", userId: user.id })
		.returning()

	await db.insert(schema.worldLoreEntries).values(
		lore.map((l) => ({
			lorebookId: lorebook.id,
			retrievalStrategy: "rag",
			keys: "zzz-no-match",
			...l
		}))
	)
	const rows = await db
		.select()
		.from(schema.worldLoreEntries)
		.where(eq(schema.worldLoreEntries.lorebookId, lorebook.id))
	poolRows = rows.map((r: any) => ({
		source: "worldLore",
		id: r.id,
		name: r.name,
		content: r.content,
		priority: r.priority ?? 1,
		lorebookId: r.lorebookId,
		embedding: vectorFor(r.content)
	}))

	const [chat] = await db
		.insert(schema.chats)
		.values({
			userId: user.id,
			isGroup: false,
			lorebookId: lorebook.id
		})
		.returning()
	await db.insert(schema.chatCharacters).values({
		chatId: chat.id,
		characterId: alice.id,
		isActive: true,
		visibility: "visible"
	})
	await db
		.insert(schema.chatPersonas)
		.values({ chatId: chat.id, personaId: bob.id })
	await db.insert(schema.chatMessages).values([
		{
			chatId: chat.id,
			role: "user",
			content: text,
			personaId: bob.id
		}
	])

	return {
		chatId: chat.id,
		userId: user.id,
		currentCharacterId: alice.id,
		text
	}
}

/** Lore retrieved by meaning rather than by key. */
const semanticLore: ParityFixture = {
	name: "rag/world-lore",
	seed: (db: any) =>
		seedRag(db, [
			{ name: "The Ashguard", content: "ashguard riders patrol" },
			{ name: "Silverwood", content: "a forest of pale trees" }
		])
}

/**
 * More entries than the threshold will admit.
 *
 * Exercises the stages a single-hit fixture cannot: normalisation against the
 * top result, the adaptive threshold, MMR's preference for a novel entry over a
 * near-duplicate, and the per-source cap.
 */
const semanticCrowd: ParityFixture = {
	name: "rag/crowded",
	async seed(db: any) {
		const scope = await seedRag(db, [
			{ name: "Ashguard Riders", content: "ashguard riders patrol" },
			{ name: "Ashguard Oath", content: "ashguard oath of the wastes" },
			{ name: "Ashguard Banner", content: "ashguard banner of grey" },
			{ name: "Silverwood", content: "a forest of pale trees" },
			{ name: "The Siege", content: "the siege broke at dawn" }
		])
		return scope
	}
}

/**
 * A query that matches nothing.
 *
 * The threshold's floor is what should fire here — every candidate is weak, so
 * "70% of the top score" is still weak. Both paths should render no lore at all
 * rather than the least-bad entry.
 */
const semanticMiss: ParityFixture = {
	name: "rag/no-match",
	async seed(db: any) {
		return await seedRag(
			db,
			[
				{ name: "Silverwood", content: "a forest of pale trees" },
				{ name: "The Siege", content: "the siege broke at dawn" }
			],
			"Tell me about the weather."
		)
	}
}

/**
 * An author's priority tier, against a better semantic match.
 *
 * The one stage nothing else here exercises. Pure similarity ranking would
 * ignore the tier entirely, which would make "High" mean something in keyword
 * mode and nothing in RAG mode — indistinguishable, to the author, from broken.
 */
const semanticPriority: ParityFixture = {
	name: "rag/priority",
	async seed(db: any) {
		return await seedRag(db, [
			{ name: "Ashguard Riders", content: "ashguard riders patrol" },
			{
				name: "Ashguard Oath",
				content: "ashguard oath of the wastes",
				priority: 3
			}
		])
	}
}

const CORPUS = [semanticLore, semanticCrowd, semanticMiss, semanticPriority]

describe("the semantic parity corpus", () => {
	it("retrieves by meaning, with keys that cannot match", async () => {
		// The fixture's own precondition. If a key ever started matching, this
		// would quietly become a keyword test wearing a RAG name.
		const rows = await db.select().from(schema.worldLoreEntries)
		for (const r of rows) expect(r.keys?.includes("ashguard")).toBeFalsy()
	})

	it("reports where the paths diverge", async () => {
		const { goldenPathFor, ragParityPipeline } = await import("./parity")
		const { readFileSync } = await import("node:fs")
		const { createHost } = await import("./host")
		const { buildWorld } = await import("./world")
		const { coreBindings } = await import("./bindings")
		const { run } = await import("@serene-pub/sdk")

		const results = []
		for (const fixture of CORPUS) {
			const scope = await fixture.seed(db as any)
			// The legacy row holds 0.5's template; the pipeline is handed 0.6's.
			// The deliberate asymmetry `FixtureScope.pipelineTemplate`
			// documents — two tables, two releases. This corpus builds its own
			// world rather than going through `pipelinePreview`, so it layers
			// the pipeline's side itself.
			// Frozen 0.5 output, not a live legacy render — see `resolveGolden`.
			// The builder these came from is deleted; freezing them first is
			// what lets this corpus outlive it.
			const legacy = readFileSync(goldenPathFor(fixture.name), "utf8")
			const world = await buildWorld(db as any, {
				chatId: scope.chatId,
				userId: scope.userId
			})
			world.overrides.push({
				nodeKey: "prompt",
				slot: "template",
				path: "source",
				value: TEMPLATE,
				scopeKind: "defaults"
			} as any)
			const preview: any = await run(ragParityPipeline(), {
				world,
				input: {
					text: scope.text,
					chatScope: {
						chatId: scope.chatId,
						currentCharacterId: scope.currentCharacterId
					}
				},
				seed: `rag:${scope.chatId}`,
				triggerSource: "ui",
				preview: true,
				bindings: coreBindings(),
				host: createHost(db as any, {
					chatId: scope.chatId,
					userId: scope.userId
				})
			})

			if (!preview.preview)
				throw new Error(
					`fixture '${fixture.name}' never reached the provider: ` +
						`${preview.outcome}` +
						(preview.haltNodeKey
							? ` at '${preview.haltNodeKey}'`
							: "") +
						(preview.haltReason ? ` — ${preview.haltReason}` : "")
				)

			results.push(checkParity(fixture.name, legacy, preview))
		}

		for (const r of results) console.log(renderParity(r))
		const gate = parityGate(results, CORPUS.length)

		// Green, and asserted as green — the same rule the keyword corpus runs
		// under. The gate going red is the point of the file.
		expect(gate.reason ?? "green").toBe("green")
		expect(gate.pass).toBe(true)
	})
})
