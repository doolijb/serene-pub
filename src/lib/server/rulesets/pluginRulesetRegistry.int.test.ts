/**
 * 🚧 A package's rulesets in the registry (M0 E-fix, supervisor T): the rows `publishPluginRulesets` writes
 * (owned by the plugin's slug, `created_by` NULL) are registered through the plugin door — the ruleset AND its own
 * attribute slots, so a session's values land — at boot (`registerPubRulesets`) and at install
 * (`registerPluginRulesets(db, pluginId)`); a retired row (uninstall) is withdrawn, slots and all. A session that starts
 * on such a ruleset is pinned to its published version (`publishedRulesetVersion`).
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import { _withdrawRuleset, defineRuleset, getAttributeSlot, getRuleset, rulesetAttributeSlotId, rulesetDocumentOf, rulesetEntryTypeId } from "@serene-pub/sdk"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { publishPluginRulesets, retirePluginRulesets } from "$lib/server/plugins/pluginRulesets"
import { keepCurrentRulesetVersions } from "./versions"
import { publishedRulesetVersion, registerPluginRulesets, registerPubRulesets } from "./pubRulesets"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const SLUG = "acme.reg"
const ID = `${SLUG}:ruleset/life@1`
const CASH = rulesetAttributeSlotId(ID, "cash")
let db: TestDb

// A package's ruleset document with one attribute of its own — declared, turned into a document, taken back out.
const doc = (version: string) => {
	const decl = defineRuleset(ID, {
		name: { en: "Life" },
		attributes: [{ id: "cash", name: { en: "Cash" }, kind: "number", bounds: { min: 0 }, start: 0, owner: "player", scope: "session", prose: "Cash: what the player has to spend." }]
	})
	const d = rulesetDocumentOf(decl, version)
	_withdrawRuleset(ID)
	return d
}

beforeAll(async () => {
	db = await createTestDb()
	await db.insert(schema.plugins).values({ pluginId: SLUG, name: SLUG, version: "1.0.0", bundleSource: "module.exports = {}", bundleHash: `hash-${SLUG}`, enabled: true } as any)
	const r = await publishPluginRulesets(db as never, SLUG, { rulesets: [doc("1.2.0")] })
	expect(r.refused).toEqual([])
}, 60_000)

describe("a package's rulesets in the registry", () => {
	test("install registers the ruleset and its own slots", async () => {
		expect(getRuleset(ID)).toBeUndefined()
		expect(getAttributeSlot(CASH)).toBeUndefined()
		expect(await registerPluginRulesets(db as never, SLUG)).toEqual([])
		expect(getRuleset(ID)).toBeDefined()
		expect(getAttributeSlot(CASH)).toBeDefined()
	})
	test("boot registers it too, and does not call the package's row a claimed owner", async () => {
		_withdrawRuleset(ID)
		expect(getAttributeSlot(CASH)).toBeUndefined()
		const lines = await registerPubRulesets(db as never)
		expect(lines.filter((l) => l.startsWith(ID))).toEqual([])
		expect(getAttributeSlot(CASH)).toBeDefined()
	})
	test("a session starting on it is pinned to the published version; a code ruleset is not", async () => {
		expect(await publishedRulesetVersion(db as never, ID)).toBe("1.2.0")
		expect(await publishedRulesetVersion(db as never, "core:ruleset/freeform@1")).toBeNull()
	})
	test("uninstall retires the row and withdraws the ruleset and its slots", async () => {
		await retirePluginRulesets(db as never, SLUG)
		await registerPluginRulesets(db as never, SLUG)
		expect(getRuleset(ID)).toBeUndefined()
		expect(getAttributeSlot(CASH)).toBeUndefined()
		expect(await publishedRulesetVersion(db as never, ID)).toBeNull()
	})
})

// needs ruleset_versions (M2b migration)
describe("every published version is kept (M2b a7)", () => {
	const KID = "acme.reg:ruleset/kept@1"
	const OLDONLY = rulesetAttributeSlotId(KID, "old-only")
	const mk = (version: string, attrs: string[], prose = "a number.") => {
		// the registry may hold the published one (registerPluginRulesets): a document is built beside it, never over it
		_withdrawRuleset(KID)
		const decl = defineRuleset(KID, {
			name: { en: "Kept" },
			attributes: attrs.map((id) => ({ id, name: { en: id }, kind: "number" as const, bounds: { min: 0 }, start: 0, owner: "player" as const, scope: "session" as const, prose: `${id}: ${prose}` }))
		})
		const d = rulesetDocumentOf(decl, version)
		_withdrawRuleset(KID)
		return d
	}
	const kept = async () =>
		(await db.select().from(schema.rulesetVersions).where(eq(schema.rulesetVersions.rulesetId, KID))).map((r) => r.version).sort()

	test("1.0.0 then 1.1.0 keep two rows; the slot only the old one declares stays registered", async () => {
		expect((await publishPluginRulesets(db as never, SLUG, { rulesets: [mk("1.0.0", ["old-only", "shared"])] })).refused).toEqual([])
		await registerPluginRulesets(db as never, SLUG)
		expect(getAttributeSlot(OLDONLY)).toBeDefined()
		expect((await publishPluginRulesets(db as never, SLUG, { rulesets: [mk("1.1.0", ["shared"])] })).refused).toEqual([])
		await registerPluginRulesets(db as never, SLUG)
		expect(await kept()).toEqual(["1.0.0", "1.1.0"])
		expect(getAttributeSlot(OLDONLY)).toBeDefined()
	})
	test("the same version again with different content replaces it, and warns", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		await publishPluginRulesets(db as never, SLUG, { rulesets: [mk("1.1.0", ["shared"], "a changed sentence.")] })
		expect(warn).toHaveBeenCalledTimes(1)
		warn.mockRestore()
		expect(await kept()).toEqual(["1.0.0", "1.1.0"])
		const { keptRulesetDocument, _clearKeptRulesetCache } = await import("./versions")
		_clearKeptRulesetCache()
		expect(JSON.stringify(await keptRulesetDocument(db as never, KID, "1.1.0"))).toContain("a changed sentence.")
	})
	test("…but once a session plays that version, a different re-publish is refused and the kept copy stays (ruling 2026-10-31)", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(db, "kept-pin")
		await db.insert(schema.sessions).values({ userId: user.id, isGroup: false, name: "Pinned", primaryRuleset: KID, rulesetVersion: "1.1.0" })
		const out = await publishPluginRulesets(db as never, SLUG, { rulesets: [mk("1.1.0", ["shared"], "a third sentence.")] })
		expect(out.refused).toEqual([`Version 1.1.0 of '${KID}' is played by 1 session; publish it as a new version.`])
		const { keptRulesetDocument, _clearKeptRulesetCache } = await import("./versions")
		_clearKeptRulesetCache()
		expect(JSON.stringify(await keptRulesetDocument(db as never, KID, "1.1.0"))).toContain("a changed sentence.")
		// a new version is always fine
		expect((await publishPluginRulesets(db as never, SLUG, { rulesets: [mk("1.2.0", ["shared"], "a third sentence.")] })).refused).toEqual([])
	})
	test("the boot backfill is idempotent", async () => {
		await keepCurrentRulesetVersions(db as never)
		await keepCurrentRulesetVersions(db as never)
		expect(await kept()).toEqual(["1.0.0", "1.1.0", "1.2.0"])
	})
})

describe("a package ruleset's entry types are in the definition registry with no provided book (M2c fix)", () => {
	test("registering the package writes each derived type's row, so an entry of it can be made by hand", async () => {
		const RID = `${SLUG}:ruleset/notes@1`
		const notes = defineRuleset(RID, {
			name: { en: "Notes" },
			entryTypes: [{ id: "clue", name: { en: "Clue" }, holders: ["cast"], fields: { detail: { type: "text", label: { en: "Detail" } } }, prose: "Clue: something someone noticed." }]
		} as never)
		const d = rulesetDocumentOf(notes, "1.0.0")
		_withdrawRuleset(RID)
		const published = await publishPluginRulesets(db as never, SLUG, { rulesets: [d] })
		expect(published.refused).toEqual([])
		expect(await registerPluginRulesets(db as never, SLUG)).toEqual([])
		const typeId = rulesetEntryTypeId(RID as never, "clue").replace(/@\d+$/, "")
		const rows = await db.select().from(schema.pipelineDefinitionRegistry).where(eq(schema.pipelineDefinitionRegistry.definitionId, typeId))
		expect(rows.map((r) => r.version)).toEqual([1])
		// the row `lorebook_entries_type_fk` points at exists: an entry of the type lands (what `entries:create` inserts)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(db, "entry-type-owner")
		const [book] = await db.insert(schema.lorebooks).values({ userId: user.id, name: "Clues" }).returning()
		const { entryInsert } = await import("$lib/server/utils/lorebookEntries")
		const [entry] = await db
			.insert(schema.lorebookEntries)
			.values(entryInsert({ typeId, lorebookId: book!.id, name: "A torn ticket", content: "", position: 0 } as never))
			.returning()
		expect(entry!.typeId).toBe(typeId)
		// idempotent: a second pass writes no new row
		await registerPluginRulesets(db as never, SLUG)
		expect((await db.select().from(schema.pipelineDefinitionRegistry).where(eq(schema.pipelineDefinitionRegistry.definitionId, typeId))).length).toBe(1)
	})
})

