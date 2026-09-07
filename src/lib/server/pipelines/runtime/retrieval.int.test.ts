/**
 * Lore retrieval end to end: real lorebook rows, through the keyword Query and
 * the ranker, inside a running pipeline.
 *
 * The claim being tested is the one the decomposition exists for — that the
 * three stages give three separate, attributable answers:
 *
 *   the Query says **what matched**
 *   the ranker says **what won**
 *   the selection says **what fit**
 *
 * Today all three collapse into one pass, so a missing lore entry has exactly
 * one diagnosis available: read the code.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { spec, compile, run, slot } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import {
	characterLoreValues,
	worldLoreValues
} from "$lib/server/pipelines/testing/fixtures"

// Embedding readiness is instance state the host reads, so the mechanism-selection
// tests toggle it here rather than passing a flag along a data edge.
let modelReady = false
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => modelReady,
	getLoadedModelId: () => (modelReady ? "test-embed-model" : null)
}))

let db: TestDb
let sessionId: number
let userId: number
let lorebookId: number

const retrieval = () =>
	compile(
		spec("core:spec/lore-turn", { version: "1.0.0" })
			.input("input", C.userMessage.v1())
			.query("lore", ($) => C.lorebookTriggers.v1({ text: $.input.text }))
			.build()
	)

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "retrieval-test", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Test Lore", userId })
		.returning()
	lorebookId = lorebook.id

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId })
		.returning()
	sessionId = session.id

	await db.insert(schema.lorebookEntries).values(
		worldLoreValues([
			{
				lorebookId,
				name: "The Ashguard",
				keys: "ashguard, banner",
				content: "An order of oathbound riders."
			},
			{
				lorebookId,
				name: "Silverwood",
				keys: "silverwood",
				content: "A forest nobody has mentioned."
			},
			{
				lorebookId,
				name: "Standing Orders",
				keys: "",
				constant: true,
				content: "Always remember the oath."
			},
			{
				lorebookId,
				name: "Retired Fact",
				keys: "ashguard",
				enabled: false,
				content: "Something switched off."
			},
			{
				lorebookId,
				// ⚠ The name is historical: it was seeded
				// `retrievalStrategy: "rag"` — *findable by meaning* — and the
				// column is gone (migration 0204). It is kept because the two
				// assertions below are about this entry surviving, and renaming
				// it would hide which entry they are about.
				name: "Vector Only",
				keys: "ashguard",
				content: "Belongs to the other mechanism."
			}
		])
	)

	await db.insert(schema.sessionMessages).values([
		{
			sessionId,
			role: "user",
			content: "The ashguard rode under a torn banner."
		}
	])
}, 60_000)

const execute = (input: Record<string, unknown> = {}) =>
	run(retrieval(), {
		input: {
			text: "tell me about the ashguard",
			sessionScope: { sessionId },
			...input
		},
		seed: "seed:lore",
		bindings: coreBindings(),
		host: createHost(db as any, { sessionId, userId })
	})

describe("lore retrieval in a pipeline", () => {
	it("surfaces entries whose keys matched real messages", async () => {
		const receipt = await execute()
		expect(receipt.outcome).toBe("ok")

		const lore = receipt.nodes.find((n) => n.nodeKey === "lore")!
		const names = (lore.output as any).hits.map((h: any) => h.payload.name)
		expect(names).toContain("The Ashguard")
	})

	it("includes a constant entry that matched nothing", async () => {
		const lore = (await execute()).nodes.find((n) => n.nodeKey === "lore")!
		const pinned = (lore.output as any).hits.find(
			(h: any) => h.payload.name === "Standing Orders"
		)
		expect(pinned.pinned).toBe(true)
	})

	it("says why each entry it declined was declined", async () => {
		// The assertion this whole file exists for: three different reasons, each
		// pointing at a different fix, where today all three read as absent lore.
		const lore = (await execute()).nodes.find((n) => n.nodeKey === "lore")!
		const skipped = (lore.output as any).skipped as any[]
		const reasons = skipped.map((s) => s.reason).join(" | ")

		expect(reasons).toMatch(/disabled/)
		expect(reasons).toMatch(/no key matched in the last 10 messages/)
	})

	it("finds an entry the vector mechanism would want, with no model loaded", async () => {
		// This read "a rag entry falls back to keyword", and the fallback it
		// named is gone with the column that asked for it (migration 0204).
		// What it was really guarding is unchanged and is why it stays: the
		// level-0 install, with nothing configured, must still find everything
		// a level-1 install would — the plan's §4 structural property, that
		// discovery degrades with setup and selection never does.
		const lore = (await execute()).nodes.find((n) => n.nodeKey === "lore")!
		const names = (lore.output as any).hits.map((h: any) => h.payload.name)
		expect(names).toContain("Vector Only")
	})

	/**
	 * ⚠ **This asserted that the entry left, and its leaving was the incident.**
	 *
	 * It read *"the same entry is handled by the other mechanism once embeddings
	 * exist"*, and checked that "Vector Only" stopped appearing here. There was
	 * no other mechanism: `core:query/vector-search@1` was wired into no shipped spec
	 * until respond 1.19.0 and ships off even now, so what the entry was handed
	 * to was nothing at all. And `rag` is what nearly every entry was — the
	 * default for an undecided one, and the default of the lore nodes'
	 * `retrievalMode` besides — so this was lore disappearing from prompts the
	 * moment somebody loaded an embedding model. Neither of those defaults
	 * exists now: 0203 culled the node mode and 0204 the per-entry column, so
	 * there is one behaviour for every entry and this is what it must be.
	 *
	 * The plan's second governing rule is written about that: *an unavailable
	 * mechanism subtracts a signal; it never reroutes, disables a path, or
	 * excludes a candidate. Adding a model may only add matches.* So the same
	 * fixture now asserts the opposite, which is the property rather than the
	 * symptom.
	 */
	it("keeps every entry it found when embeddings become available", async () => {
		const before = (await execute()).nodes.find((n) => n.nodeKey === "lore")!
		const found = (before.output as any).hits.map(
			(h: any) => h.payload.name
		)
		expect(found).toContain("Vector Only")

		modelReady = true
		try {
			const after = (await execute()).nodes.find(
				(n) => n.nodeKey === "lore"
			)!
			const names = (after.output as any).hits.map(
				(h: any) => h.payload.name
			)
			for (const name of found)
				expect(
					names,
					`loading an embedding model removed "${name}" from the ` +
						`keyword mechanism's results`
				).toContain(name)
		} finally {
			// ⚠ Restored in `finally`, because a failure here used to leave the
			// flag on and take the next two tests down with it — a cascade that
			// hides which assertion actually broke.
			modelReady = false
		}
	})

	it("says why vector search did not run, in the run's own diagnostics", async () => {
		// So "why is RAG not working" is answerable from the receipt rather than
		// from the embedding settings screen.
		const lore = (await execute()).nodes.find((n) => n.nodeKey === "lore")!
		expect((lore.output as any).diagnostics.vectorSearch).toMatch(
			/no embedding model is loaded/
		)
	})

	it("reports how far it looked, so an empty result is diagnosable", async () => {
		const lore = (await execute()).nodes.find((n) => n.nodeKey === "lore")!
		const d = (lore.output as any).diagnostics
		expect(d.scanDepth).toBe(10)
		expect(d.considered).toBe(5)
		expect(d.windowChars).toBeGreaterThan(0)
	})

	it("a session with no lorebook retrieves nothing rather than failing", async () => {
		const [bare] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false })
			.returning()

		const receipt = await run(retrieval(), {
			input: { text: "anything", sessionScope: { sessionId: bare.id } },
			seed: "seed:lore",
			bindings: coreBindings(),
			host: createHost(db as any, { sessionId: bare.id, userId })
		})
		expect(receipt.outcome).toBe("ok")
		const lore = receipt.nodes.find((n) => n.nodeKey === "lore")!
		expect((lore.output as any).hits).toEqual([])
	})

	it("lore from another session's lorebook is refused, not filtered", async () => {
		const host = createHost(db as any, { sessionId, userId })
		await expect(
			host.read!(
				"lorebook_entries",
				{ sessionId: sessionId + 999 },
				{
					key: "lore",
					typeId: "core:query/lorebook-triggers",
					typeVersion: 1,
					kind: "query"
				}
			)
		).rejects.toThrow(/may only read the session it was triggered in/)
	})
})

/**
 * Character lore is private self-knowledge, and the pipeline never enforced it.
 *
 * `isCharacterLoreEntryVisible` has gated this on the legacy path since it was
 * written; nothing under `pipelines/` called it, so every character's private
 * lore competed for the same ranking budget as world lore on every turn — and
 * would have leaked outright the moment character lore was wired into the cast
 * cards. The gate now runs at the host read, next to the decorator stripping,
 * for the reason the file already gives for `isHidden`: a new Query type cannot
 * forget what the read applies for it.
 */
describe("character lore is only visible to whoever it belongs to", () => {
	let ash: number
	let bran: number
	let loreSession: number

	const node = {
		key: "lore",
		typeId: "core:query/lorebook-triggers",
		typeVersion: 1,
		kind: "query" as const
	}

	beforeAll(async () => {
		const [a] = await db
			.insert(schema.characters)
			.values({ userId, name: "Ash", description: "A rider." })
			.returning()
		const [b] = await db
			.insert(schema.characters)
			.values({ userId, name: "Brannoc", description: "A smith." })
			.returning()
		ash = a.id
		bran = b.id

		const [session] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: true, lorebookId })
			.returning()
		loreSession = session.id

		const [binding] = await db
			.insert(schema.lorebookBindings)
			.values({ lorebookId, characterId: ash, binding: "{{char:1}}" })
			.returning()
		// Bound to nothing: a background/NPC row, which the rule reserves for
		// the omniscient narrator.
		const [npc] = await db
			.insert(schema.lorebookBindings)
			.values({ lorebookId, binding: "{{char:2}}" })
			.returning()

		await db.insert(schema.lorebookEntries).values(
			characterLoreValues([
				{
					lorebookId,
					lorebookBindingId: binding.id,
					name: "Ash's secret",
					keys: "secret",
					content: "Ash opened the lower gate."
				},
				{
					lorebookId,
					lorebookBindingId: npc.id,
					name: "The gatekeeper",
					keys: "gate",
					content: "Nobody remembers who hired them."
				}
			])
		)
	})

	const readAs = async (currentCharacterId: number | null) => {
		const host = createHost(db as any, { sessionId: loreSession, userId })
		const rows = (await host.read!(
			"lorebook_entries",
			{ sessionId: loreSession, currentCharacterId },
			node
		)) as any[]
		return rows
			.filter((r) => r.source === "characterLore")
			.map((r) => r.name)
	}

	it("shows a character their own lore", async () => {
		expect(await readAs(ash)).toContain("Ash's secret")
	})

	it("hides it from everyone else", async () => {
		// The failure this prevents: Brannoc's reply is budgeted against — and
		// would eventually be written from — knowledge only Ash has.
		expect(await readAs(bran)).not.toContain("Ash's secret")
	})

	it("reserves an unbound entry for the narrator", async () => {
		expect(await readAs(null)).toContain("The gatekeeper")
		expect(await readAs(ash)).not.toContain("The gatekeeper")
	})

	it("never gates world lore, which has no binding to gate on", async () => {
		const host = createHost(db as any, { sessionId: loreSession, userId })
		const rows = (await host.read!(
			"lorebook_entries",
			{ sessionId: loreSession, currentCharacterId: bran },
			node
		)) as any[]
		expect(
			rows.filter((r) => r.source === "worldLore").length
		).toBeGreaterThan(0)
	})
})

/**
 * What a candidate says it was, so a receipt can be read months later.
 *
 * A receipt records decisions and never content, so the explanation panel reads
 * the entry rows **live** for titles and keys. Rename an entry after its run and
 * the panel put the new title against the old decision with nothing saying so.
 * The fix is a fingerprint of the scored row on each candidate — `entrySourceHash`,
 * the annotation lane's own `source_hash` recipe, borrowed rather than reinvented.
 *
 * ⚠ This is the half the projection's unit tests cannot reach. There both sides
 * of the comparison are computed from one literal, so they agree by
 * construction; here the run computes it from a row the **host read** produced
 * and the check computes it from the **stored columns** the socket reads, which
 * is the pairing that has to hold in production. `keys` is `text[]` in the
 * database and a comma-joined string by the time a candidate carries it, and a
 * fingerprint taken on the wrong side of that would have called every entry
 * edited, forever, on the first panel open.
 */
describe("a candidate records what it was, not just that it was", () => {
	let book: number
	let scoped: number
	let ashguardId: number

	const stored = () =>
		db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, ashguardId))
			.limit(1)
			.then((r: any[]) => r[0])

	const liveHash = async () => {
		const { entrySourceHash } = await import("$lib/server/annotations")
		return entrySourceHash(await stored())
	}

	const lore = async () => {
		const receipt = await run(retrieval(), {
			input: {
				text: "tell me about the ashguard",
				sessionScope: { sessionId: scoped }
			},
			seed: "seed:fingerprint",
			bindings: coreBindings(),
			host: createHost(db as any, { sessionId: scoped, userId })
		})
		expect(receipt.outcome).toBe("ok")
		return (receipt.nodes.find((n) => n.nodeKey === "lore")!.output ??
			{}) as any
	}

	beforeAll(async () => {
		// Its own book and session: the suite above asserts an exact
		// `considered` of 5 and these tests edit rows, so sharing either would
		// make one file's assertions depend on another's mutations.
		const [lorebook] = await db
			.insert(schema.lorebooks)
			.values({ name: "Fingerprint Lore", userId })
			.returning()
		book = lorebook.id

		const [session] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false, lorebookId: book })
			.returning()
		scoped = session.id

		const rows = await db
			.insert(schema.lorebookEntries)
			.values(
				worldLoreValues([
					{
						lorebookId: book,
						name: "The Ashguard",
						keys: "ashguard, banner",
						content: "An order of oathbound riders."
					},
					{
						lorebookId: book,
						name: "Silverwood",
						keys: "silverwood",
						content: "A forest nobody has mentioned."
					}
				])
			)
			.returning()
		ashguardId = rows.find((r: any) => r.title === "The Ashguard")!.id

		await db.insert(schema.sessionMessages).values([
			{
				sessionId: scoped,
				role: "user",
				content: "The ashguard rode under a torn banner."
			}
		])
	}, 60_000)

	it("carries a fingerprint on every candidate it publishes", async () => {
		const out = await lore()
		const hit = out.hits.find((h: any) => h.payload.name === "The Ashguard")
		expect(hit.payload.fingerprint).toEqual(expect.any(String))
		// The annotation lane's short digest, not a full sha256 — one recipe.
		expect(hit.payload.fingerprint).toHaveLength(16)
	})

	it("agrees with the hash a later reader computes from the stored row", async () => {
		// ⚠ The load-bearing one. The run hashes what the host read handed it;
		// the panel hashes the columns. If those two ever disagree — about how
		// keys are spelled, about which column is the title — every row reads
		// as edited and the states stop meaning anything.
		const out = await lore()
		const hit = out.hits.find((h: any) => h.payload.name === "The Ashguard")
		expect(hit.payload.fingerprint).toBe(await liveHash())
	})

	it("gives the entries it declined one too", async () => {
		// The rows a reader most often asks about — "why did this not come in"
		// — travel as three fields and would otherwise be the only ones the
		// explanation could not date.
		const out = await lore()
		const skip = out.skipped.find((s: any) => s.id !== ashguardId)
		expect(skip.fingerprint).toEqual(expect.any(String))
		expect(skip.reason).toBeTruthy()
	})

	it("does the same on the lane the shipped pipeline actually runs", async () => {
		// ⚠ `lorebook-triggers` is the node the tests above use and **not** the
		// one a reply runs: `respond` wires `world-lore`, `character-lore` and
		// `history-entries`, which filter one shared scan to their own source.
		// Both go through the same helper, and pinning only the unshipped one
		// would leave the path every user is on uncovered.
		const receipt = await run(
			compile(
				spec("core:spec/world-lore-turn", { version: "1.0.0" })
					.input("input", C.userMessage.v1())
					.query("world", ($) =>
						C.worldLore.v1({ scope: $.input.sessionScope })
					)
					.build()
			),
			{
				input: {
					text: "tell me about the ashguard",
					sessionScope: { sessionId: scoped }
				},
				seed: "seed:fingerprint-world",
				bindings: coreBindings(),
				host: createHost(db as any, { sessionId: scoped, userId })
			}
		)
		expect(receipt.outcome).toBe("ok")
		const out = receipt.nodes.find((n) => n.nodeKey === "world")!
			.output as any
		const hit = out.hits.find((h: any) => h.id === ashguardId)
		expect(hit.payload.fingerprint).toBe(await liveHash())
		const skip = out.skipped.find((s: any) => s.id !== ashguardId)
		expect(skip.fingerprint).toEqual(expect.any(String))
	})

	it.each([
		["a retitled entry", { title: "The Ashguard Gate" }],
		["a rekeyed entry", { keys: ["ashguard", "portcullis"] }],
		["a rewritten entry", { content: "An order of oathbound riders, once." }]
	])("stops matching the record for %s", async (_what, edit) => {
		const before = await lore()
		const recorded = before.hits.find(
			(h: any) => h.id === ashguardId
		).payload.fingerprint
		expect(recorded).toBe(await liveHash())

		const original = await stored()
		await db
			.update(schema.lorebookEntries)
			.set(edit as any)
			.where(eq(schema.lorebookEntries.id, ashguardId))
		try {
			// The receipt is untouched by an edit made after it — which is the
			// point — so the drift shows up as the live hash moving away from
			// the one the run wrote down.
			expect(await liveHash()).not.toBe(recorded)
		} finally {
			await db
				.update(schema.lorebookEntries)
				.set({
					title: original.title,
					keys: original.keys,
					content: original.content
				})
				.where(eq(schema.lorebookEntries.id, ashguardId))
		}
		expect(await liveHash()).toBe(recorded)
	})
})
