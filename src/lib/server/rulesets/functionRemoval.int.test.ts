/**
 * 🚧 Deleting a function (RF fix 6, 2026-10-23). The owner: "Deleting
 * functions doesn't clear errors, can't save. 'There is no ruleset called ''.'"
 * The empty id was the page's (it read the Admin router's live params while
 * the next section loaded — `IdPage.svelte`); this pins the server half:
 * a function added from the catalogue or forked into the draft, then
 * removed through the editor's own form (`removeFunction`), leaves a draft
 * with no findings that saves and publishes; removing the default way hands
 * it to the next way, or to none, and a check that named it is left on the
 * default; a request that names no ruleset says so in words.
 */
import { beforeAll, describe, expect, it } from "vitest"
import { CORE_FUNCTION_IDS, forkFunction, functionRefDecides, functionWayKeys, getFunction, type FunctionDecl } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import {
	newFunctionRow,
	removeFunction,
	sectionsDocument,
	sectionsFormOf,
	type FunctionRow,
	type Json,
	type SectionsForm
} from "$lib/client/admin/sections/rulesets/rulesetSectionsForm"
import { createPubRuleset, deletePubRuleset, publishPubRuleset, rulesetDetail, saveRulesetDraft } from "./pubRulesets"

let db: TestDb
let userId: number

beforeAll(async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
	const [u] = await db
		.insert(schema.users)
		.values({ username: "admin-fn-removal", password: "x", isAdmin: true } as any)
		.returning({ id: schema.users.id })
	userId = u!.id
}, 60_000)

const reasons = (findings: readonly string[]) => findings.map((f) => /^\[([a-z-]+)\]/.exec(f)?.[1] ?? f)
const NERVE = { id: "nerve", name: { en: "Nerve" }, kind: "pool", bounds: { max: 3 }, prose: "Courage held back, spent to be brave." }

/** A from-scratch draft with nerve, read into the editor's form as the page reads it. */
async function scratch(name: string, extra: Record<string, unknown> = {}): Promise<{ rulesetId: string; saved: Json; form: SectionsForm }> {
	const { rulesetId } = await createPubRuleset(db as any, { ownerSlug: "acme.rm", name, label: name, from: null, userId })
	const base = (await rulesetDetail(db as any, rulesetId))!.draft as unknown as Json
	const first = await saveRulesetDraft(db as any, rulesetId, { ...base, attributes: [NERVE], ...extra })
	expect(first.findings).toEqual([])
	const saved = (await rulesetDetail(db as any, rulesetId))!.draft as unknown as Json
	return { rulesetId, saved, form: sectionsFormOf(saved, name) }
}
/** Save what the form holds, as the page's Save does; the server's findings and the draft back. */
async function save(rulesetId: string, saved: Json, form: SectionsForm) {
	const { findings } = await saveRulesetDraft(db as any, rulesetId, sectionsDocument(saved, form))
	const draft = (await rulesetDetail(db as any, rulesetId))!.draft as unknown as Json
	return { findings, draft, form: sectionsFormOf(draft, "again") }
}
/** A way to decide, as the page tells one (the catalogue's `decides`; a carried module read). */
const isWayIn = (form: SectionsForm) => (row: FunctionRow) =>
	functionRefDecides(
		{ ref: row.ref, key: row.key, ...(row.module ? { module: row.module as unknown as FunctionDecl } : {}) },
		functionWayKeys(form.functions.map((f) => ({ ref: f.ref, key: f.key, options: f.options })))
	)

describe("deleting a function", () => {
	it("one added from the catalogue, then deleted: no findings, and it saves and publishes", async () => {
		const { rulesetId, saved, form } = await scratch("catalogue")
		const restore = getFunction("core:function/restore@1")!
		form.functions = [...form.functions, newFunctionRow(form, restore.id, "Restore", restore)]
		const added = await save(rulesetId, saved, form)
		expect(reasons(added.findings)).toEqual(["unbound-function-binding"])
		removeFunction(added.form, added.form.functions[0]!.uid, { isWay: isWayIn(added.form) })
		const removed = await save(rulesetId, added.draft, added.form)
		expect(removed.findings).toEqual([])
		expect(removed.draft.functions).toBeUndefined()
		expect((await rulesetDetail(db as any, rulesetId))!.findings).toEqual([])
		await expect(publishPubRuleset(db as any, rulesetId, { userId })).resolves.toMatchObject({ version: "1.0.0" })
		await deletePubRuleset(db as any, rulesetId).catch(() => {})
	}, 60_000)

	it("one forked into the draft (its own module), bound, then deleted: no module left, no findings", async () => {
		const { rulesetId, saved, form } = await scratch("forked")
		const copy = forkFunction(getFunction("core:function/restore@1")!, rulesetId)
		expect(copy.id).toBe("acme.rm:function/forked-restore@1")
		const row = newFunctionRow(form, copy.id, "Restore", copy as never, JSON.parse(JSON.stringify(copy)))
		row.bindings = { what: "nerve" }
		form.functions = [...form.functions, row]
		const added = await save(rulesetId, saved, form)
		expect(added.findings).toEqual([])
		expect((added.draft.functions as { module?: { id: string } }[])[0]!.module!.id).toBe(copy.id)
		removeFunction(added.form, added.form.functions[0]!.uid, { isWay: isWayIn(added.form) })
		const removed = await save(rulesetId, added.draft, added.form)
		expect(removed.findings).toEqual([])
		expect(JSON.stringify(removed.draft)).not.toContain("forked-restore")
		await deletePubRuleset(db as any, rulesetId)
	}, 60_000)

	it("the default way deleted: the next way decides, a check that named it is left on the default; the last way deleted, none", async () => {
		const { rulesetId, saved, form } = await scratch("ways", {
			functions: [
				{ ref: CORE_FUNCTION_IDS.dieTarget, key: "d20" },
				{ ref: CORE_FUNCTION_IDS.compare, key: "weigh" },
				{ ref: CORE_FUNCTION_IDS.check, key: "climb", options: { way: "d20" } }
			]
		})
		const first = removeFunction(form, form.functions[0]!.uid, { isWay: isWayIn(form), name: "One die against a target" })
		expect(first).toMatchObject({ wasDefault: true, nowDefault: { key: "weigh" } })
		expect(form.functions.find((f) => f.key === "climb")!.cleared).toEqual([{ hole: "way", was: "One die against a target" }])
		const after = await save(rulesetId, saved, form)
		expect(after.findings).toEqual([])
		expect((after.draft.functions as { key?: string; options?: unknown }[]).map((f) => [f.key, f.options ?? null])).toEqual([
			["weigh", null],
			["climb", null]
		])
		const last = removeFunction(after.form, after.form.functions[0]!.uid, { isWay: isWayIn(after.form) })
		expect(last).toMatchObject({ wasDefault: true, nowDefault: null })
		expect((await save(rulesetId, after.draft, after.form)).findings).toEqual([])
		await deletePubRuleset(db as any, rulesetId)
	}, 60_000)

	it("a request that names no ruleset is refused in words, never as a ruleset called ''", async () => {
		await expect(saveRulesetDraft(db as any, "", { id: "", version: "1.0.0", name: { en: "x" } })).rejects.toThrow(
			"No ruleset was named. Open the ruleset again from Admin › Rulesets."
		)
	}, 60_000)
})
