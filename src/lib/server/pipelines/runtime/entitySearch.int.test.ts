/**
 * The third mechanism, end to end — annotations on disk, and the node that reads
 * them.
 *
 * Design §13, and three things that are only visible from here.
 *
 * **The storage.** `entry_annotations` and `message_annotations` are derived
 * data over mutable rows, so the whole question is whether staleness is noticed:
 * §13.3 requires that it degrade to *correct-and-verbose*, never to
 * *silently-wrong*. A unit test can prove the extractor's arithmetic and can
 * prove nothing at all about a row that went stale under it, because staleness
 * is a fact about two writes and a hash.
 *
 * **The wiring.** `nodeParams.test.ts` hands a binding its parameters directly
 * and therefore cannot see the seam that actually breaks — the executor resolves
 * only the slots a node's config names, which is how three retrieval controls
 * rendered, validated and stored a value for eight spec versions without ever
 * reaching the scan (bug 12). This starts at a stored row.
 *
 * **The default.** `respond@1.18.0` ships the mechanism inert. That is the property
 * the parity corpus rests on, and asserting it *before* turning the mechanism on is
 * what stops the rest of this file passing vacuously against a node that does
 * nothing.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import {
	setConfigValue,
	type TestDb
} from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import { run } from "@serene-pub/sdk"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { EXTRACTOR_VERSION } from "$lib/server/pipelines/ranking/entities"
import { respondSpec, RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"

// No embedding model, deliberately: this mechanism's whole claim is that it needs
// none (design §11, §13.5).
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "entity-search-secret" }
})

const ENTITY_LANE = "gather.entities.read"
const LORE_NODE = "lore"

let db: TestDb
let sessionId: number
let userId: number
let lorebookId: number
let ashguardId: number
let lanternsId: number
let oldMessageId: number
let respondSpecRow: { id: number }

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-entity-search-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "entities", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Entities", userId })
		.returning()
	lorebookId = lorebook.id

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId })
		.returning()
	sessionId = session.id

	/**
	 * A keyless book, and the mechanism's own version of the design's headline case.
	 *
	 * `The Ashguard Riders` has no keys and its full title is never said. It is
	 * reached because the scene says *"the ashguard"* — lower case, and only
	 * part of the title — which is exactly the reference §13.9 corrected the
	 * gazetteer to see. `Feast of Lanterns` is the control: also keyless, also
	 * unnamed, and about nothing under discussion.
	 */
	const entries = await db
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues([
				{
					lorebookId,
					name: "The Ashguard Riders",
					keys: "",
					content:
						"An order of oathbound riders who patrol the ash wastes. They answer to Commander Vell and take no coin from the city."
				},
				{
					lorebookId,
					name: "Feast of Lanterns",
					keys: "",
					content:
						"a midwinter festival where households hang paper lanterns and the watch looks the other way for one night."
				}
			])
		)
		.returning()
	ashguardId = entries[0]!.id
	lanternsId = entries[1]!.id

	/**
	 * The one message under test is written through the **store**, not straight
	 * into `session_messages`.
	 *
	 * `message_annotations` hangs off `messages` — the message model — and the
	 * store is the single writer that keeps the two tables agreeing on
	 * identity. A fixture inserting only the legacy row would leave the
	 * annotation with no parent, and the message half of this file would pass
	 * by finding nothing.
	 */
	const { insertLegacy } = await import("$lib/server/messages/store")
	const target = await insertLegacy(
		db,
		{
			sessionId,
			role: "user",
			content: "The ashguard turned us back at the third milestone."
		} as any
	)
	oldMessageId = target.id

	/**
	 * ⚠ **The transcript half only has anything to find on a long session, and
	 * that is the design rather than a fixture inconvenience.**
	 *
	 * The prompt already carries the most recent messages verbatim — the same
	 * hundred `core:query/session-history@1` reads — so retrieving one of those
	 * would spend the budget twice on one span. Retrieval starts where the
	 * verbatim window ends. These 110 filler lines are what pushes the message
	 * above out of that window and into the searchable corpus.
	 *
	 * They go straight into the legacy table with no mirror on purpose, and the
	 * pass ignores them for it: the annotation's parent is `messages`, so an
	 * unmirrored row is not part of the model and is not annotated. It is a
	 * second assertion riding on the setup.
	 */
	await db.insert(schema.sessionMessages).values(
		Array.from({ length: 110 }, (_, i) => ({
			sessionId,
			role: i % 2 ? "assistant" : "user",
			content: `We rode on. Day ${i + 1} was much like the last.`
		})) as any
	)
	await db.insert(schema.sessionMessages).values([
		{
			sessionId,
			role: "user",
			content: "Tell me about the road south instead."
		},
		{
			sessionId,
			role: "assistant",
			content: "It is quiet this time of year."
		},
		{
			sessionId,
			role: "user",
			content: "Well met. And you. Have you seen the ashguard?"
		}
	] as any)

	respondSpecRow = (
		await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
			.limit(1)
	)[0]
}, 120_000)

/** Run the shipped reply spec the way a turn does, and report two nodes. */
const turn = async () => {
	const receipt = await run(respondSpec(), {
		input: {
			text: "Well met. And you. Have you seen the ashguard?",
			sessionId,
			characterId: null,
			sessionScope: { sessionId, currentCharacterId: null }
		},
		seed: "seed:entities",
		bindings: coreBindings(),
		world: await buildWorld(db, {
			sessionId,
			specId: RESPOND_SPEC_ID
		}),
		host: createHost(db, { sessionId, userId }),
		// Stops before the provider, which needs a connection this test has no
		// business supplying. Every node under test runs upstream of it.
		preview: true
	} as any)
	const mechanism = (receipt.nodes as any[]).find(
		(n) => n.nodeKey === ENTITY_LANE
	)
	const lore = (receipt.nodes as any[]).find((n) => n.nodeKey === LORE_NODE)
	const prompt = (receipt.nodes as any[]).find((n) => n.nodeKey === "prompt")
	return {
		hits: (mechanism?.output?.hits ?? []) as any[],
		messages: (mechanism?.output?.messages ?? []) as any[],
		diagnostics: mechanism?.output?.diagnostics ?? {},
		loreIds: ((lore?.output?.candidates ?? []) as any[]).map(
			(c) => `${c.source}:${c.id}`
		),
		/** What actually reaches the model, so "can this move a prompt" has an answer. */
		context: JSON.stringify(prompt?.output?.context ?? "")
	}
}

/**
 * The config a run on this session actually resolves to.
 *
 * ⚠ Not the `pipeline-default:` row. `migrateContextTemplates` duplicates the
 * shipped config into a mutable "Default (customized)" and selects that at
 * instance scope, so a fixture writing to the immutable original would change
 * nothing and prove nothing.
 */
const selectedConfigId = async () => {
	const { resolveSelectedConfig } = await import(
		"$lib/server/pipelines/config/named"
	)
	const selected = await resolveSelectedConfig(
		db,
		respondSpecRow.id,
		RESPOND_SPEC_ID,
		{ sessionId }
	)
	expect(selected, "the reply spec resolves to no configuration").toBeTruthy()
	return selected!.configId
}

const setParam = async (path: string, value: unknown) =>
	// ⚠ An upsert, not the `UPDATE` this was. A config stores **deviations**
	// (ruled 2026-09-10), so at an untouched address there is no row to update
	// — the old form matched nothing and the lane stayed at the cap of 0 it
	// ships with, which reads exactly like the mechanism being off.
	await setConfigValue(
		db,
		await selectedConfigId(),
		{ nodeKey: ENTITY_LANE, slot: "params", path },
		value
	)

const annotationsOf = async (entryId: number) =>
	await db
		.select()
		.from(schema.entryAnnotations)
		.where(eq(schema.entryAnnotations.entryId, entryId))

describe("the mechanism ships inert", () => {
	it("declares 0 for both caps in the projected registry row", async () => {
		// Read from the row the panel renders and a config back-fills from, not
		// from a literal: a declaration corrected in the contracts package but
		// never re-projected would still ship the old number.
		const [row] = await db
			.select()
			.from(schema.pipelineDefinitionRegistry)
			.where(
				and(
					eq(
						schema.pipelineDefinitionRegistry.definitionId,
						"core:query/entity-search"
					),
					eq(schema.pipelineDefinitionRegistry.version, 1)
				)
			)
			.limit(1)
		const schemaOf = (row?.slots as any)?.params?.schema
		expect(schemaOf?.maxEntries?.default).toBe(0)
		expect(schemaOf?.maxMessages?.default).toBe(0)
	})

	it("retrieves nothing and writes nothing while it is off", async () => {
		const off = await turn()
		expect(off.hits).toEqual([])
		expect(off.messages).toEqual([])
		expect(off.diagnostics.reason).toMatch(/off/)
		// ⚠ Not just "found nothing" — an install that has not asked for this
		// should not be paying for the index either.
		expect(await annotationsOf(ashguardId)).toEqual([])
	})
})

describe("a stored cap reaches the mechanism, and the mechanism reaches the prompt", () => {
	/**
	 * ⚠ **The assertion the rest of the file is only evidence because of.**
	 *
	 * Design §10.1: a green suite is evidence only if the thing under test can
	 * move it. Two of this corpus's blind spots were found that way — entity
	 * co-occurrence scored 0 on every parity fixture for the project's whole
	 * life, and the RAG corpus gives every candidate a cosine of exactly 1 — so
	 * "parity stayed green" says nothing on its own about a change parity cannot
	 * see. The parity corpus renders through `parityPipeline()`, which has no
	 * entity lane at all, so it is structurally blind to this mechanism; this is
	 * where the change is shown to reach a prompt.
	 */
	it("moves the assembled prompt when it is turned on, and not before", async () => {
		const off = await turn()
		await setParam("maxEntries", 5)
		const on = await turn()

		expect(on.context).not.toBe(off.context)
		expect(off.context).not.toContain("Ashguard Riders")
		expect(on.context).toContain("Ashguard Riders")
	})

	it("finds the keyless entry the scene is naming", async () => {
		await setParam("maxEntries", 5)
		const on = await turn()

		expect(
			on.hits.map((c) => c.id),
			"the entry the conversation names by a fragment of its title"
		).toEqual([ashguardId])
		// The control: keyless too, and about nothing being discussed. A mechanism
		// that cannot say no is not a search.
		expect(on.hits.map((c) => c.id)).not.toContain(lanternsId)
		expect(on.diagnostics.entities).toContain("ashguard")
		expect(on.diagnostics.extractorVersion).toBe(EXTRACTOR_VERSION)
	})

	it("reaches the ranker, and does not displace what the keyword mechanism found", async () => {
		const on = await turn()
		// ⚠ Concatenated **last**, so an entry both mechanisms found keeps the
		// keyword mechanism's full signal set; only rows no key reached are added.
		expect(on.loreIds).toContain(`worldLore:${ashguardId}`)
	})

	it("scores on its own weight rather than the band's", async () => {
		const on = await turn()
		const hit = on.hits[0]!
		// `presetScore` is what `select` ranks by; the signal is the
		// measurement, kept for the receipt. §13.10 is why they differ.
		expect(hit.presetScore).toBeGreaterThan(
			hit.signals.entityCooccurrence * 0.2
		)
		expect(hit.payload.foundBy).toBe("entity-search")
		expect(hit.payload.sharedEntities.length).toBeGreaterThan(0)
	})
})

describe("annotations are written, and staleness is never silent", () => {
	it("stores the freshness triple on every row", async () => {
		const rows = await annotationsOf(ashguardId)
		expect(rows.length).toBeGreaterThan(0)
		for (const row of rows) {
			expect(row.extractorVersion).toBe(EXTRACTOR_VERSION)
			expect(row.sourceHash).toBeTruthy()
			expect(row.gazetteerHash).toBeTruthy()
		}
	})

	it("resolves a gazetteer hit to a real row through a real foreign key", async () => {
		const rows = await annotationsOf(ashguardId)
		const resolved = rows.filter((r) => r.tier === "gazetteer")
		expect(resolved.length).toBeGreaterThan(0)
		// The FK that makes tier one worth having: an entry naming its own
		// title resolves to itself, and the reference is a column a database
		// can enforce rather than a string.
		expect(resolved.some((r) => r.refEntryId === ashguardId)).toBe(true)
	})

	it("records a passage that names nothing, so 'no rows' means 'never looked'", async () => {
		// ⚠ The sentinel. Without it a silent entry is re-extracted forever,
		// because absence would mean both "found nothing" and "not yet done".
		const { annotateLorebook } = await import("$lib/server/annotations")
		const [silent] = await db
			.insert(schema.lorebookEntries)
			.values(
				worldLoreValues([
					{
						lorebookId,
						name: null as any,
						keys: "",
						content: "nothing here is a name at all."
					}
				])
			)
			.returning()
		await annotateLorebook(db, lorebookId)
		const rows = await annotationsOf(silent!.id)
		expect(rows.length).toBe(1)
		expect(rows[0]!.entityKey).toBe("")
		expect(rows[0]!.tier).toBe("none")
	})

	it("re-extracts when the content moves under the annotation", async () => {
		const { annotateLorebook } = await import("$lib/server/annotations")
		const before = (await annotationsOf(lanternsId))[0]!.sourceHash
		await db
			.update(schema.lorebookEntries)
			.set({
				content:
					"a midwinter festival kept in Emberfall, where the watch looks the other way."
			})
			.where(eq(schema.lorebookEntries.id, lanternsId))
		await annotateLorebook(db, lorebookId)
		const after = await annotationsOf(lanternsId)
		expect(after[0]!.sourceHash).not.toBe(before)
		expect(after.map((r) => r.surface)).toContain("Emberfall")
	})

	it("re-extracts when the vocabulary moves, not only the text", async () => {
		// The third identity, and the one specific to this subsystem:
		// extraction is dictionary lookup, so a new name changes what the same
		// sentence yields without the sentence moving. `source_hash` alone
		// would call that fresh.
		const { annotateLorebook } = await import("$lib/server/annotations")
		const before = (await annotationsOf(ashguardId))[0]!.gazetteerHash
		const [character] = await db
			.insert(schema.characters)
			.values({
				userId,
				name: "Vell",
				description: "The Ashguard's commander."
			} as any)
			.returning()
		await db.insert(schema.lorebookBindings).values({
			lorebookId,
			characterId: character!.id,
			binding: "{{char:1}}",
			name: "Vell",
			aliases: [],
			absorbedAliases: ["Commander Vell"]
		} as any)
		await annotateLorebook(db, lorebookId)

		const after = await annotationsOf(ashguardId)
		expect(after[0]!.gazetteerHash).not.toBe(before)
		// ⚠ The alias union, which is why the gap was worth closing:
		// `absorbedAliases` is where a graph merge puts an identity it
		// absorbed, and it is deliberately not `aliases`. Reading one half
		// would resolve the absorbed name and not the name it merged into.
		expect(
			after.some((r) => r.characterId === character!.id),
			"the absorbed alias did not resolve to the character it belongs to"
		).toBe(true)
	})
})

describe("the transcript half", () => {
	it("returns an earlier message naming what the scene names", async () => {
		const { annotateLorebook, loadVocabulary, annotateSessionMessages } =
			await import("$lib/server/annotations")
		await setParam("maxMessages", 5)
		// The corpus is built in the background, so the first turn with the
		// message half on is expected to find nothing — extraction must never
		// block a turn (§13.4). Done explicitly here rather than by taking two
		// turns and hoping the pass landed between them.
		await annotateLorebook(db, lorebookId)
		await annotateSessionMessages(
			db,
			sessionId,
			await loadVocabulary(db, lorebookId)
		)

		const on = await turn()
		expect(on.messages.map((c) => c.id)).toContain(oldMessageId)
		for (const candidate of on.messages)
			expect(candidate.source).toBe("messages")
	})

	it("keeps retrieved transcript out of the ranker", async () => {
		// ⚠ Deliberate, and the reason the port is unwired in `respond.ts`:
		// `assemble` builds the transcript from `lines`, so a retrieved message
		// reaching `rank` would take budget out of the `messages` band — half
		// the window by default — and render nowhere at all.
		// The background message pass is a group on the annotation lane now,
		// not a detached promise, so the wait is for that lane to go idle.
		const { settleAnnotationQueue } = await import(
			"$lib/server/annotations/queue"
		)
		await settleAnnotationQueue()
		const on = await turn()
		expect(on.messages.length).toBeGreaterThan(0)
		expect(on.loreIds.some((id) => id.startsWith("messages:"))).toBe(false)
	})

	it("refuses a message whose text moved under its annotation", async () => {
		// §13.3 on the side that is never repaired inline: a hit justified by a
		// sentence that has since been edited is the silent wrongness, so the
		// reader drops it and the background pass rewrites it later.
		//
		// ⚠ The passes the turns above started are settled first, on purpose.
		// They are fire-and-forget by design — extraction must never block a
		// turn — so one landing between the edit below and the read would
		// repair the very staleness this asserts, and the test would fail on
		// timing rather than on behaviour.
		// The background message pass is a group on the annotation lane now,
		// not a detached promise, so the wait is for that lane to go idle.
		const { settleAnnotationQueue } = await import(
			"$lib/server/annotations/queue"
		)
		await settleAnnotationQueue()
		await db
			.update(schema.sessionMessages)
			.set({ content: "They turned us back at the third milestone." })
			.where(eq(schema.sessionMessages.id, oldMessageId))
		const on = await turn()
		expect(on.messages.map((c) => c.id)).not.toContain(oldMessageId)
	})
})
