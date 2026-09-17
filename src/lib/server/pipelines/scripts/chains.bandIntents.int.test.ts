import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { bandIntent, splitCandidates } from "@serene-pub/sdk"
import { makeScriptApplier } from "./chains"

/**
 * Band intents (R-7 P5) and the script seam.
 *
 * A candidates list opens with each source's intent — an element with no id,
 * no tokens and no signals — and a `candidates/filter` written against
 * candidates would drop it with everything else that "did not score". So the
 * applier lifts the intents off before the fold and puts them back on
 * whatever comes out (`chains.ts`). Two laws, pinned:
 *
 *  - a chain never sees an intent, cannot drop one, and gets them all back;
 *  - when the fold hands back something that is NOT a list — a shape no
 *    candidates link is allowed to return, so only a hook misdeclared to
 *    accept a text transform can produce it — the value the chain was handed
 *    goes on, intents and all, and the receipt carries a note (U3b review
 *    S2). Before that fix the non-list went on alone and every band's
 *    declaration went with it, silently.
 */

let db: TestDb

const FILTER = "core:script:candidates/filter"
const TEXT = "core:script:text/transform"

async function scriptRow(
	typeId: string,
	name: string,
	source: string,
	subject: string
): Promise<number> {
	const [row] = await db
		.insert(schema.pipelineScripts)
		.values({
			typeId: `${typeId}@1`,
			name,
			enabled: true,
			source,
			varsIn: [subject],
			varsOut: [subject]
		})
		.returning()
	return row.id
}

const site = (accepts: string[]) =>
	({
		nodeKey: "rank",
		slot: "scripts",
		phase: "before",
		port: "candidates",
		accepts,
		extras: [],
		origin: "substrate"
	}) as any

const pool = () => [
	bandIntent("worldLore", { share: 0.3, maxEntries: 20, priority: "normal" }),
	bandIntent("messages", { share: 0.5, minEntries: 6 }),
	{ id: 1, source: "worldLore", tokens: 10, signals: { keyword: 1 } },
	{ id: 2, source: "worldLore", tokens: 10, signals: { keyword: 0 } }
]

beforeAll(async () => {
	db = await createTestDb()
	// Registry rows inserted directly: this test targets the applier, not
	// the projection (`registrySync.int.test.ts` owns that half).
	await db.insert(schema.pipelineDefinitionRegistry).values([
		{
			definitionId: FILTER,
			version: 1,
			kind: "script",
			transport: "node",
			status: "live",
			ports: { in: { candidates: {} }, out: { candidates: {} } },
			semantics: "transform"
		},
		{
			definitionId: TEXT,
			version: 1,
			kind: "script",
			transport: "node",
			status: "live",
			ports: { in: { text: {} }, out: { text: {} } },
			semantics: "transform"
		}
	])
}, 60_000)

describe("band intents through a script chain", () => {
	it("a filter never sees them and gets every one of them back, ahead of what it kept", async () => {
		const id = await scriptRow(
			FILTER,
			"keep what scored",
			// Would drop both intents if it saw them: neither has `signals`.
			`return candidates.filter((c) => c.signals && c.signals.keyword > 0)`,
			"candidates"
		)
		const apply = makeScriptApplier(db, { seed: "seed", nowMs: 1_000_000 })
		const r = await apply(site([`${FILTER}@1`]), [id], pool())
		const { intents, items } = splitCandidates<any>(r.value as unknown[])
		expect(intents.map((i) => i.band)).toEqual(["worldLore", "messages"])
		expect(intents[0]!.intent).toEqual({ share: 0.3, maxEntries: 20, priority: "normal" })
		expect(items.map((c) => c.id)).toEqual([1])
		expect(r.applications).toMatchObject([{ scriptId: id, result: "ok", changed: true }])
		expect(r.notes).toBeUndefined()
	})

	it("a fold that hands back a non-list keeps the value it was handed, intents and all, and says so (S2)", async () => {
		// A hook misdeclared to accept a text transform on a candidates port:
		// the text link is handed the list as `text`, returns a string, and
		// `validShape` for `text` is satisfied — so the fold's value is a
		// string where a list went in.
		const id = await scriptRow(TEXT, "returns prose", `return "not a list"`, "text")
		const apply = makeScriptApplier(db, { seed: "seed", nowMs: 1_000_000 })
		const before = pool()
		const r = await apply(site([`${TEXT}@1`]), [id], before)
		expect(r.value).toEqual(before)
		expect(splitCandidates(r.value as unknown[]).intents.map((i) => i.band)).toEqual([
			"worldLore",
			"messages"
		])
		// The link itself did nothing wrong by its own contract and is
		// recorded as such; the chain-level verdict is a note.
		expect(r.applications).toMatchObject([{ scriptId: id, result: "ok" }])
		expect(r.notes).toEqual([
			"scripts: the scripts chain on candidates returned a non-list where candidates were expected — value kept, band intents kept"
		])
	})

	it("a list with no intents is folded and returned as the chain left it", async () => {
		const id = await scriptRow(TEXT, "returns prose again", `return "still not a list"`, "text")
		const apply = makeScriptApplier(db, { seed: "seed", nowMs: 1_000_000 })
		const r = await apply(site([`${TEXT}@1`]), [id], [{ id: 1, source: "worldLore" }])
		// Nothing to protect: no intent was lifted, so the fold's word stands.
		expect(r.value).toBe("still not a list")
		expect(r.notes).toBeUndefined()
	})
})
