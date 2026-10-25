/**
 * 🚧 Rulesets authored on the pub (PLAN-ruleset-editor §4): the store and
 * the boot path.
 *
 *  - a copy of Vis Itineris lands as a draft under the admin's owner, with the
 *    source's slots copied beside it as stored slots, and is NOT registered
 *    until published;
 *  - publish registers it (pickers, repertoires, derived entry types);
 *    republishing wants a version bump and acknowledges dropped fields;
 *  - retire hides it from the pickers but keeps it registered; delete is
 *    refused while a lorebook names it; delete withdraws it otherwise;
 *  - `registerPubRulesets` puts published rows back after a registry reset
 *    and reports a row whose owner a plugin has since claimed.
 */
import { beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import {
	_clearReservedAttributeOwners,
	_withdrawRuleset,
	allEntryTypes,
	CORE_FUNCTION_IDS,
	getAttributeSlot,
	rulesetAttributeSlotId,
	getRuleset,
	reserveAttributeOwner,
	type RulesetDocument
} from "@serene-pub/sdk"
import { DICE_POOL_TEMPLATE_ID, RULESET_TEMPLATES, visItinerisRuleset } from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import {
	_clearPubRulesets,
	createPubRuleset,
	deletePubRuleset,
	listRulesets,
	pickableRulesets,
	publishPubRuleset,
	registerPubRulesets,
	retirePubRuleset,
	rulesetDetail,
	rulesetTemplateCards,
	saveRulesetDraft,
	scriptSeedKeyFor,
	unretirePubRuleset
} from "./pubRulesets"

const MINE = "acme.lab:ruleset/mine@1"
let db: TestDb
let userId: number
let copiedSlot = ""

beforeAll(async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
	const [u] = await db
		.insert(schema.users)
		.values({ username: "admin-rules", password: "x", isAdmin: true } as any)
		.returning({ id: schema.users.id })
	userId = u!.id
}, 60_000)

describe("pub rulesets", () => {
	it("copies a shipped ruleset into a draft under the admin's owner, slots beside it", async () => {
		await expect(
			createPubRuleset(db as any, { ownerSlug: "core", name: "x", label: "X", userId })
		).rejects.toThrow(/Serene Pub's own name/)
		const { rulesetId } = await createPubRuleset(db as any, {
			ownerSlug: "acme.lab",
			name: "mine",
			label: "Mine",
			from: visItinerisRuleset.id,
			userId
		})
		expect(rulesetId).toBe(MINE)
		expect(getRuleset(MINE)).toBeUndefined()
		const detail = (await rulesetDetail(db as any, MINE))!
		expect(detail.state).toBe("draft")
		expect(detail.origin).toBe("pub")
		expect(detail.basedOn).toBe(visItinerisRuleset.id)
		expect(detail.findings).toEqual([])
		// 🚧 A4: the copy is in the sections — attributes, functions, entry types — none of the shapes before them.
		expect(Object.keys(detail.draft!)).toEqual(expect.arrayContaining(["attributes", "functions", "entryTypes", "library", "options"]))
		expect((detail.draft as any).stats).toBeUndefined()
		expect((detail.draft as any).conventions).toBeUndefined()
		expect(detail.ownSlots.length).toBeGreaterThan(0)
		copiedSlot = detail.ownSlots[0]!
		for (const id of detail.ownSlots) {
			expect(id.startsWith("acme.lab:slot/")).toBe(true)
			expect(getAttributeSlot(id)?.origin).toBe("stored")
		}
		const slotRows = await db
			.select({ id: schema.attributeDeclarations.id })
			.from(schema.attributeDeclarations)
		expect(slotRows.some((r) => r.id === detail.ownSlots[0])).toBe(true)
		await expect(
			createPubRuleset(db as any, { ownerSlug: "acme.lab", name: "mine", label: "Again", userId })
		).rejects.toThrow(/already a ruleset/)
	}, 60_000)

	it("lists shipped and pub rulesets, pub ones with their state", async () => {
		const rows = await listRulesets(db as any)
		const vi = rows.find((r) => r.rulesetId === visItinerisRuleset.id)!
		expect(vi.origin).toBe("core")
		expect(vi.state).toBe("shipped")
		const mine = rows.find((r) => r.rulesetId === MINE)!
		expect(mine.state).toBe("draft")
		expect(mine.label).toBe("Mine")
	}, 60_000)

	it("publishes into the registry; a republish wants the version moved", async () => {
		const { version } = await publishPubRuleset(db as any, MINE, { userId })
		expect(version).toBe("1.0.0")
		const decl = getRuleset(MINE)!
		expect(decl.origin).toBe("stored")
		expect(pickableRulesets().some((r) => r.id === MINE)).toBe(true)
		// 🚧 A4 (2026-10-23): a copy is written in the seven sections; its entry types derive from them.
		expect(decl.attributes?.length).toBeGreaterThan(0)
		expect(allEntryTypes().some((t) => t.id.startsWith("acme.lab:entry/mine."))).toBe(true)
		const detail = (await rulesetDetail(db as any, MINE))!
		expect(detail.state).toBe("published")
		expect(detail.draftChanged).toBe(false)

		// Same version, a changed name: refused until the version moves.
		const draft = { ...detail.draft!, name: { en: "Mine, renamed" } } as RulesetDocument
		const { findings } = await saveRulesetDraft(db as any, MINE, draft)
		expect(findings).toEqual([])
		expect((await rulesetDetail(db as any, MINE))!.draftChanged).toBe(true)
		await expect(publishPubRuleset(db as any, MINE, { userId })).rejects.toThrow(/version-not-bumped/)
		await publishPubRuleset(db as any, MINE, { userId, version: "1.0.1" })
		expect(getRuleset(MINE)?.name).toEqual({ en: "Mine, renamed" })

		// An invalid draft is saved with its findings and cannot be published.
		const bad = { ...draft, version: "1.0.2", voice: {} } as unknown as RulesetDocument
		const saved = await saveRulesetDraft(db as any, MINE, bad)
		expect(saved.findings.some((f) => f.startsWith("[missing-voice]"))).toBe(true)
		await expect(publishPubRuleset(db as any, MINE, { userId })).rejects.toThrow(/not ready to publish/)
		await saveRulesetDraft(db as any, MINE, { ...draft, version: "1.0.2" })
	}, 60_000)

	it("retires out of the pickers but stays registered; delete refused while a lorebook names it", async () => {
		await retirePubRuleset(db as any, MINE)
		expect(pickableRulesets().some((r) => r.id === MINE)).toBe(false)
		expect(getRuleset(MINE)).toBeTruthy()
		expect((await rulesetDetail(db as any, MINE))!.state).toBe("retired")
		await expect(saveRulesetDraft(db as any, MINE, {})).rejects.toThrow(/retired/)
		await unretirePubRuleset(db as any, MINE)
		expect(pickableRulesets().some((r) => r.id === MINE)).toBe(true)

		const [book] = await db
			.insert(schema.lorebooks)
			.values({ name: "On mine", userId, primaryRuleset: MINE } as any)
			.returning({ id: schema.lorebooks.id })
		await expect(deletePubRuleset(db as any, MINE)).rejects.toThrow(/played by 0 sessions and 1 lorebook/)
		expect((await rulesetDetail(db as any, MINE))!.playedBy.lorebooks).toBe(1)
		await db.delete(schema.lorebooks).where(eq(schema.lorebooks.id, book!.id))
	}, 60_000)

	it("boots published rows back after a registry reset; a claimed owner is reported", async () => {
		_withdrawRuleset(MINE)
		_clearPubRulesets()
		expect(getRuleset(MINE)).toBeUndefined()
		expect(await registerPubRulesets(db as any)).toEqual([])
		expect(getRuleset(MINE)?.origin).toBe("stored")
		expect(allEntryTypes().some((t) => t.id.startsWith("acme.lab:entry/mine."))).toBe(true)

		_withdrawRuleset(MINE)
		reserveAttributeOwner("acme.lab")
		try {
			const lines = await registerPubRulesets(db as any)
			expect(lines.length).toBe(1)
			expect(lines[0]).toMatch(/installed plugin's name/)
			expect(getRuleset(MINE)).toBeUndefined()
		} finally {
			_clearReservedAttributeOwners()
		}
		expect(await registerPubRulesets(db as any)).toEqual([])
	}, 60_000)

	it("stamps a seed key on a person's script row once; a shipped row keeps its own", async () => {
		const [mine] = await db
			.insert(schema.pipelineScripts)
			.values({ typeId: "core:script/run-script@1", name: "My Derived Rule", source: "return 1" } as any)
			.returning({ id: schema.pipelineScripts.id })
		const key = await scriptSeedKeyFor(db as any, MINE, mine!.id)
		expect(key).toBe(`acme.lab:script/my-derived-rule-${mine!.id}`)
		expect(await scriptSeedKeyFor(db as any, MINE, mine!.id)).toBe(key)
		const [shipped] = await db
			.insert(schema.pipelineScripts)
			.values({ typeId: "core:script/run-script@1", name: "Shipped", source: "", seedKey: "core:script/shipped-x", isImmutable: true } as any)
			.returning({ id: schema.pipelineScripts.id })
		expect(await scriptSeedKeyFor(db as any, MINE, shipped!.id)).toBe("core:script/shipped-x")
		const detail = (await rulesetDetail(db as any, MINE))!
		expect(detail.scriptChoices.some((c) => c.id === mine!.id && c.seedKey === key)).toBe(true)
		expect(detail.derivedEntryTypes.length).toBeGreaterThan(0)
		await expect(scriptSeedKeyFor(db as any, MINE, 999999)).rejects.toThrow(/no script/)
	}, 60_000)

	it("shipped rulesets stay as written; a pub one nothing names deletes", async () => {
		await expect(saveRulesetDraft(db as any, visItinerisRuleset.id, {})).rejects.toThrow(/stays as written/)
		await expect(deletePubRuleset(db as any, visItinerisRuleset.id)).rejects.toThrow(/stays as written/)
		await deletePubRuleset(db as any, MINE)
		expect(getRuleset(MINE)).toBeUndefined()
		expect(allEntryTypes().some((t) => t.id.startsWith("acme.lab:entry/mine."))).toBe(false)
		expect(await rulesetDetail(db as any, MINE)).toBeNull()
		// The slots it brought stay as stored slots (parked data).
		expect(getAttributeSlot(copiedSlot as any)?.origin).toBe("stored")
	}, 60_000)

	it("🚧 M4: a ruleset template is copied like a ruleset — its attributes the copy's own, its playtest preloaded", async () => {
		const cards = rulesetTemplateCards()
		expect(cards.map((c) => c.id)).toEqual(RULESET_TEMPLATES.map((t) => t.id))
		// 🚧 A4: the card reads the template through its sections — how it decides, attributes, entry types.
		expect(cards.find((c) => c.id === DICE_POOL_TEMPLATE_ID)).toMatchObject({
			label: "Dice pool",
			stem: "dice-pool",
			decidedBy: [expect.any(String)],
			attributes: 3,
			entryTypes: ["Gear", "Conditions", "Talents"],
			zoneTypes: []
		})
		const { rulesetId } = await createPubRuleset(db as any, {
			ownerSlug: "acme.lab",
			name: "pool",
			label: "Pool",
			from: DICE_POOL_TEMPLATE_ID,
			userId
		})
		const detail = (await rulesetDetail(db as any, rulesetId))!
		expect(detail.findings).toEqual([])
		expect(detail.basedOn).toBe(DICE_POOL_TEMPLATE_ID)
		expect(detail.basedOnName).toBe("Dice pool")
		expect((detail.draft as any).template).toBeUndefined()
		// 🚧 In the sections (2026-10-23): the template's attributes are the copy's own, filed under the
		// slots the copy derives (`rulesetAttributeSlotId`) — no template slot is copied.
		expect((detail.draft as any).attributes.map((a: { id: string; slot?: string }) => [a.id, a.slot])).toEqual([
			["body", undefined],
			["mind", undefined],
			["heart", undefined]
		])
		expect(rulesetAttributeSlotId(rulesetId, "body")).toBe("acme.lab.pool:slot/body@1")
		// The scene, its party's stats by the attributes' own ids.
		expect(detail.playtest?.party.map((m) => m.name)).toEqual(["Wren", "Oskar"])
		expect(Object.keys(detail.playtest!.party[0]!.stats!)).toContain("mind")
		expect(detail.playtest?.change).toMatchObject({ owner: "Wren", op: "use", check: "roll.mind" })
		expect(detail.decides).toBe(true)
		expect(detail.vocabularyChoices.some((v) => v.id === "core:vocabulary/common@1" && v.members.length > 0)).toBe(true)
		// A copy of a ruleset (not a template) preloads no scene.
		expect((await rulesetDetail(db as any, visItinerisRuleset.id))!.playtest).toBeNull()
		await deletePubRuleset(db as any, rulesetId)
	}, 60_000)

	it("🚧 A4: from scratch is a name and nothing else; a pasted document is taken under the new id", async () => {
		const blank = await createPubRuleset(db as any, { ownerSlug: "acme.lab", name: "blank", label: "Blank Slate", userId })
		const b = (await rulesetDetail(db as any, blank.rulesetId))!
		expect(b.draft).toEqual({ id: "acme.lab:ruleset/blank@1", version: "1.0.0", name: { en: "Blank Slate" } })
		expect(b.findings).toEqual([])
		expect(b.decides).toBe(false)

		const shared = {
			id: "someone.else:ruleset/hearts@3",
			version: "2.1.0",
			name: { en: "Their name" },
			template: true,
			attributes: [{ id: "affection", name: { en: "Affection" }, kind: "number", bounds: { min: 0, max: 10 }, prose: "How much someone likes you." }],
			functions: [{ ref: CORE_FUNCTION_IDS.compare, key: "confession" }],
			handbook: [{ title: "A note", body: "Play kindly." }]
		}
		await expect(createPubRuleset(db as any, { ownerSlug: "acme.lab", name: "bad", label: "Bad", document: [1, 2] as any, userId })).rejects.toThrow(
			/one JSON object/
		)
		const pasted = await createPubRuleset(db as any, { ownerSlug: "acme.lab", name: "hearts", label: "Hearts", document: shared, userId })
		const p = (await rulesetDetail(db as any, pasted.rulesetId))!
		expect(p.draft).toMatchObject({ id: "acme.lab:ruleset/hearts@1", version: "2.1.0", name: { en: "Hearts" } })
		expect((p.draft as any).template).toBeUndefined()
		expect((p.draft as any).attributes[0].id).toBe("affection")
		expect((p.draft as any).handbook).toEqual([{ title: "A note", body: "Play kindly." }])
		expect(p.findings).toEqual([])
		expect(p.decides).toBe(true)

		// The catalogue: every reserved core id, registered or stood in, grouped by kind.
		const ids = new Set(p.functionChoices.map((c) => c.id))
		for (const id of Object.values(CORE_FUNCTION_IDS)) expect(ids.has(id)).toBe(true)
		const pool = p.functionChoices.find((c) => c.id === CORE_FUNCTION_IDS.dicePool)!
		expect(pool).toMatchObject({ kind: "deciding", from: "core", decides: true })
		expect(Object.keys(pool.decl.form ?? {})).toContain("sides")
		await deletePubRuleset(db as any, blank.rulesetId)
		await deletePubRuleset(db as any, pasted.rulesetId)
	}, 60_000)
})
