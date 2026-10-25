/**
 * 🚧 Every archetype, copied (RF fix 2, item 8, 2026-10-23): a copy made
 * from New ruleset reads with no findings, and so does the same copy after
 * the editor has read it into its form and written it back untouched —
 * `rulesetSectionsForm` is the copy/paste path a person's Save takes. The
 * owner saw `bond.affection` refused on a copy of Romance; this pins that a
 * copy's entry types keep their field map through both paths.
 */
import { beforeAll, describe, expect, it } from "vitest"
import { ARCHETYPE_TEMPLATES } from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { removeEntryType, removeZoneType, sectionsDocument, sectionsFormOf } from "$lib/client/admin/sections/rulesets/rulesetSectionsForm"
import { createPubRuleset, deletePubRuleset, publishPubRuleset, rulesetDetail, saveRulesetDraft } from "./pubRulesets"

let db: TestDb
let userId: number

beforeAll(async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
	const [u] = await db
		.insert(schema.users)
		.values({ username: "admin-archetypes", password: "x", isAdmin: true } as any)
		.returning({ id: schema.users.id })
	userId = u!.id
}, 60_000)

describe("archetype copies", () => {
	it("every archetype copies with no findings, and saves back through the editor's form with none", async () => {
		expect(ARCHETYPE_TEMPLATES.length).toBeGreaterThanOrEqual(4)
		for (const t of ARCHETYPE_TEMPLATES) {
			const name = `copy-${t.id.split("/")[1]!.split("@")[0]!.replace(/^template-/, "")}`
			const { rulesetId } = await createPubRuleset(db as any, { ownerSlug: "acme.arch", name, label: name, from: t.id, userId })
			const detail = (await rulesetDetail(db as any, rulesetId))!
			expect({ id: t.id, findings: detail.findings }).toEqual({ id: t.id, findings: [] })
			// The copy's entry types keep their own fields (a tie's affection is a number field).
			const source = t.ruleset as unknown as { entryTypes?: { id: string; fields?: Record<string, unknown> }[] }
			const copied = (detail.draft as unknown as { entryTypes?: { id: string; fields?: Record<string, unknown> }[] }).entryTypes ?? []
			for (const e of source.entryTypes ?? [])
				expect({ id: e.id, fields: Object.keys(copied.find((x) => x.id === e.id)?.fields ?? {}).sort() }).toEqual({ id: e.id, fields: Object.keys(e.fields ?? {}).sort() })
			// The editor reads it into its form and writes it back as Save does.
			const draft = detail.draft as unknown as Record<string, unknown>
			const form = sectionsFormOf(draft, detail.label)
			const written = sectionsDocument(draft, form)
			const { findings } = await saveRulesetDraft(db as any, rulesetId, written)
			expect({ id: t.id, findings }).toEqual({ id: t.id, findings: [] })
			await deletePubRuleset(db as any, rulesetId)
		}
	}, 60_000)

	it("removals with no cascade leave dangling references: the draft saves with them and only Publish refuses; the editor's cascade leaves none", async () => {
		const t = ARCHETYPE_TEMPLATES.find((x) => x.id.includes("romance"))!
		const { rulesetId } = await createPubRuleset(db as any, { ownerSlug: "acme.arch", name: "removals", label: "Removals", from: t.id, userId })
		const draft = (await rulesetDetail(db as any, rulesetId))!.draft as unknown as Record<string, unknown>
		// The owner's screenshot: entry types, zone types, outcomes and time taken out row by row.
		const bare = sectionsFormOf(draft, "Removals")
		bare.entryTypes = []
		bare.zoneTypes = []
		bare.outcomes = []
		bare.time = { ...bare.time, unit: "", rests: [] }
		const { findings } = await saveRulesetDraft(db as any, rulesetId, sectionsDocument(draft, bare))
		expect(findings.map((f) => /^\[([a-z-]+)\]/.exec(f)?.[1])).toEqual(["bad-function-binding", "bad-function-binding", "unknown-entry-type"])
		expect((await rulesetDetail(db as any, rulesetId))!.findings.length).toBe(3)
		await expect(publishPubRuleset(db as any, rulesetId, { userId })).rejects.toThrow(/not ready to publish/)
		// The same removals through the editor's cascade: nothing left naming what went.
		const form = sectionsFormOf(draft, "Removals")
		for (const e of [...form.entryTypes]) removeEntryType(form, e.uid, { rows: true })
		for (const z of [...form.zoneTypes]) removeZoneType(form, z.uid)
		form.outcomes = []
		form.time = { ...form.time, unit: "", rests: [] }
		const again = await saveRulesetDraft(db as any, rulesetId, sectionsDocument(draft, form))
		// What is left is the holes the rows show — "pick what it is now" — never a reference to something gone.
		expect(again.findings.map((f) => /^\[([a-z-]+)\]/.exec(f)?.[1])).toEqual(["unbound-function-binding", "unbound-function-binding"])
		expect(again.findings.some((f) => /bond|keepsake/.test(f))).toBe(false)
		await deletePubRuleset(db as any, rulesetId)
	}, 60_000)
})
