/**
 * 🚧 Rulesets authored on this pub (PLAN-ruleset-editor §4–§5, ruled
 * 2026-10-21) — the store behind Admin › Rulesets and the boot path that puts
 * published ones back in the SDK registry.
 *
 * A ruleset's declaration is a `RulesetDocument` (SDK): the same shape a
 * package ships, held as JSON in a `rulesets` row. A row has a **draft** (what
 * the editor edits; may be invalid, its findings beside it) and a
 * **published** document (what boots). Publishing runs the SDK's findings and
 * the §23 upgrade gate, then `defineStoredRulesetDocument` replaces the held
 * declaration and the derived entry types are re-derived.
 *
 * Origins are derived, never stored: `core:` is Serene Pub's; a row here is
 * the pub's; anything else registered came from a plugin. Shipped and plugin
 * rulesets are immutable here — copy to change (`createPubRuleset` with
 * `from`). A copy takes the slots the source owns with it, as stored slots
 * under the new owner (`declareSlot`), and `reidRulesetDocument` renames the
 * references.
 *
 * Retire vs delete (ruling 5): a ruleset some session or lorebook still names
 * can only be retired — it stays registered so they keep playing it, and
 * leaves the pickers (`pickableRulesets`). Delete is for a pub ruleset nothing
 * names; it withdraws the declaration. Values filed against either stay where
 * they are (parked data).
 */

import { asc, count, eq } from "drizzle-orm"
import {
	_withdrawRuleset,
	attributeSlots,
	defineStoredRulesetDocument,
	getAttributeSlot,
	getRuleset,
	getRulesetTemplate,
	i18nText,
	isReservedAttributeOwner,
	parseRulesetId,
	reidRulesetDocument,
	rulesetDocumentFindings,
	rulesetDocumentOf,
	rulesetDocumentOwnSlots,
	rulesetDocumentUpgradeFindings,
	rulesetDecides,
	rulesetEntryTypeDecls,
	rulesetInSections,
	rulesetRollsDice,
	rulesets,
	rulesetSections,
	rulesetTemplates,
	vocabularies,
	VOCABULARY_OWNERS,
	CHECK_METHOD_KINDS,
	CORE_FUNCTION_IDS,
	functionRefDecides,
	functions as registeredFunctions,
	RESERVED_FUNCTIONS,
	type AttributeSlotProps,
	type FieldDecl,
	type FunctionDecl,
	type FunctionRef,
	type RulesetDecl,
	type RulesetDocument,
	type RulesetPlaytest,
	type RulesetTemplate,
	type SlotId
} from "@serene-pub/sdk"
import { deriveEntryTypes, ENTRY_UNIVERSAL_PARTS } from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import { declareSlot } from "$lib/server/state/declarations"
import { OWNER_SLUG } from "$lib/server/pipelines/entities/pubGenres"

export { OWNER_SLUG }
/** `vis-itineris`: lowercase letters and digits joined by single hyphens. */
export const RULESET_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

export class PubRulesetRefusal extends Error {}
const slotStem = (id: string): string => id.slice(id.indexOf("/") + 1, id.lastIndexOf("@"))
const refuse = (msg: string): never => {
	throw new PubRulesetRefusal(msg)
}

export type RulesetOrigin = "core" | "plugin" | "pub"
export type RulesetState = "shipped" | "draft" | "published" | "retired"

export interface RulesetListRow {
	rulesetId: string
	/** The admin label (a row's) or the declaration's name. */
	label: string
	name: string
	description: string
	origin: RulesetOrigin
	state: RulesetState
	/** The published version (a pub row's) — shipped rulesets say nothing. */
	version: string | null
	/** True when the draft differs from what is published. */
	draftChanged: boolean
	draftFindings: number
	/**
	 * Whether this ruleset rolls dice — 🚧 one of its check methods throws
	 * them (`rulesetRollsDice`, the ⏳ `conventions.dice` read as one;
	 * 2026-10-22).
	 */
	rollsDice: boolean
	/**
	 * 🚧 Whether it decides anything by its rules — a check method other
	 * than `none` (`rulesetDecides`): what How strict offers (every level, or
	 * Words only). The changelist's _Plays_ column.
	 */
	decides: boolean
	playedBy: { sessions: number; lorebooks: number }
	/** The plugin's display name for a plugin ruleset; null otherwise. */
	pluginName: string | null
}

export interface RulesetDetail extends RulesetListRow {
	basedOn: string | null
	/** The copied ruleset's name, when it is still registered. */
	basedOnName: string | null
	draft: RulesetDocument | null
	published: RulesetDocument | null
	findings: string[]
	/** What publishing the draft would do to the published version (§23). */
	upgradeFindings: string[]
	/** The ids of the slots the draft lists as its own. */
	ownSlots: string[]
	/** Every declared slot the Sheet step may list, with who owns it. */
	slotChoices: SlotChoice[]
	/**
	 * The entry types the draft's entryable repertoires derive (PLAN-rulesets
	 * §21): a library row is edited with exactly these fields, as the same
	 * piece is edited as a lorebook entry (ruling 6, 2026-10-21). Empty when the
	 * draft's repertoires are refused; the reason is among `findings`.
	 */
	derivedEntryTypes: DerivedEntryTypeShape[]
	/** Admin › Scripts rows a script phase may name (ruling 7, 2026-10-21). */
	scriptChoices: ScriptChoice[]
	/**
	 * 🚧 The playtest scene of the ruleset template this one was made from
	 * (2026-10-22, D4): its party's stats renamed to this ruleset's own slots,
	 * as the copy renamed them — what the Playtest step preloads. Null for a
	 * ruleset not made from a template.
	 */
	playtest: RulesetPlaytest | null
	/** 🚧 The shared vocabularies a ruleset may play, with their members (the Plays step). */
	vocabularyChoices: VocabularyChoice[]
	/** 🚧 The functions the editor's catalogue offers (D8, 2026-10-23): core's, packages', this pub's other rulesets'. */
	functionChoices: FunctionChoice[]
}

/** 🚧 A shared vocabulary as the Plays step offers it: its id and its members by owner. */
export interface VocabularyChoice {
	id: string
	members: { owner: string; word: string; slotId: string; label: string }[]
}

const vocabularyChoices = (): VocabularyChoice[] =>
	vocabularies().map((v) => ({
		id: v.id,
		members: VOCABULARY_OWNERS.flatMap((owner) =>
			Object.entries((v as unknown as Record<string, Record<string, { id: string; label?: unknown }>>)[owner] ?? {}).map(([word, slot]) => ({
				owner,
				word,
				slotId: slot.id,
				label: i18nText(slot.label as never) ?? word
			}))
		)
	}))

/**
 * 🚧 A ruleset template as _New ruleset_ offers it (D4; the archetype cards
 * of PLAN-rulesets-functions D8, 2026-10-23): its card's words, and — read
 * through its sections, whichever shape it is written in — how it decides
 * (its deciding functions, by name), how many attributes it starts with, and
 * its entry types and zone types by name.
 */
export interface RulesetTemplateCard {
	id: string
	/** The template's name stem (`romance`, `dice-pool`): where the page files its card. */
	stem: string
	label: string
	about: string
	goodFor: string
	/** Its deciding functions' names, in its order — _Compare against a target_. */
	decidedBy: string[]
	attributes: number
	/** Its entry types by name — _Bonds, Moods_. */
	entryTypes: string[]
	/** Its zone types by name — _Deck, Hand, Discard_. */
	zoneTypes: string[]
	/** The playtest scene's situation. */
	situation: string
}

/** A template id's stem: `core:ruleset/template-dice-pool@1` → `dice-pool`. */
const templateStem = (id: string): string => slotStem(id).replace(/^template-/, "")

export const rulesetTemplateCards = (): RulesetTemplateCard[] => {
	const names = functionNames()
	return rulesetTemplates().map((t) => {
		const s = rulesetSections(t.ruleset)
		const deciding = (s.functions ?? []).filter((f) => functionRefDecides(f) || (RESERVED_FUNCTIONS[f.ref]?.kind === "deciding" && f.ref !== CORE_FUNCTION_IDS.check))
		return {
			id: t.id,
			stem: templateStem(t.id),
			label: i18nText(t.label) ?? t.id,
			about: i18nText(t.about) ?? "",
			goodFor: i18nText(t.goodFor) ?? "",
			decidedBy: [...new Set(deciding.map((f) => names.get(f.ref) ?? i18nText(f.module?.name) ?? f.key ?? f.ref))],
			attributes: s.attributes?.length ?? 0,
			entryTypes: (s.entryTypes ?? []).map((e) => i18nText(e.name) ?? e.id),
			zoneTypes: (s.zoneTypes ?? []).map((z) => i18nText(z.name) ?? z.id),
			situation: i18nText(t.playtest.situation) ?? ""
		}
	})
}

/* ── The function catalogue (D8: the editor's catalogue drawer) ────────── */

/**
 * 🚧 One function the editor's catalogue offers (PLAN-rulesets-functions D1,
 * D8, 2026-10-23): a registered function module (core's, a package's), or
 * one another ruleset on this pub carries (a fork, a module of its own). The
 * whole declaration rides along, so a sentence row draws its pickers from
 * the header (bindings, options) and **Change how it works** forks the body.
 *
 * `standIn`: a reserved core id (`CORE_FUNCTION_IDS`) the catalogue has not
 * registered yet, described from the check-method words until it is — a
 * header only, never run as a module. ⏳ Gone when core ships every
 * reserved id as a module.
 */
export interface FunctionChoice {
	id: string
	name: string
	meaning: string
	kind: string
	/** `core`, a package's (`package`), or another ruleset's on this pub (`ruleset`). */
	from: "core" | "package" | "ruleset"
	/** Who it comes from, by name: a package's, or the ruleset that carries it. */
	source: string
	/** It decides a moment by itself (a deciding function that decides). */
	decides: boolean
	hasBody: boolean
	decl: FunctionDecl
	standIn?: true
}

const en = (s: string) => ({ en: s })
const checkKindHeader = (kind: keyof typeof CHECK_METHOD_KINDS, name: string): Partial<FunctionDecl> => {
	const k = CHECK_METHOD_KINDS[kind]
	return { name: en(name), meaning: k.description, form: k.options as FunctionDecl["form"], prose: i18nText(k.description) ?? name }
}

/**
 * The headers of core's reserved ids, in the catalogue's words — what a
 * stand-in reads until the module is registered. Deciding ones borrow their
 * check method's description and options (the options keep their names:
 * PLAN-rulesets-functions A2 note).
 */
const STAND_INS: Readonly<Record<string, Partial<FunctionDecl>>> = {
	[CORE_FUNCTION_IDS.judge]: { name: en("Judge in words"), meaning: en("The game master decides from the sentence. Nothing is rolled."), prose: "The game master judges how it goes, in words." },
	[CORE_FUNCTION_IDS.dieTarget]: checkKindHeader("die-target", "Roll a die"),
	[CORE_FUNCTION_IDS.dicePool]: checkKindHeader("dice-pool", "Roll a pool"),
	[CORE_FUNCTION_IDS.cardDraw]: checkKindHeader("card-draw", "Draw a card"),
	[CORE_FUNCTION_IDS.compare]: checkKindHeader("compare", "Compare against a target"),
	[CORE_FUNCTION_IDS.spend]: checkKindHeader("bid", "Spend to succeed"),
	[CORE_FUNCTION_IDS.table]: { name: en("Roll on a table"), meaning: en("Roll, and read the row it lands on."), prose: "A roll on a table says what happens." },
	[CORE_FUNCTION_IDS.samePlace]: { name: en("Same place"), meaning: en("Everyone in the same place."), prose: "Everyone in the same place." },
	[CORE_FUNCTION_IDS.withinTie]: { name: en("Within a bond"), meaning: en("The two a bond joins, and those tied to them."), prose: "The two a bond joins, and those tied to them." },
	[CORE_FUNCTION_IDS.aimedAt]: { name: en("Aimed at"), meaning: en("Whoever it is aimed at."), prose: "Whoever it is aimed at." },
	[CORE_FUNCTION_IDS.everyone]: { name: en("Everyone"), meaning: en("Everyone in the session."), prose: "Everyone in the session." },
	[CORE_FUNCTION_IDS.check]: {
		name: en("A check"),
		meaning: en("A named check: what it adds, and the way it is decided."),
		prose: "A check adds its value and is decided its way.",
		form: {
			base: { type: "text", label: en("Adds") },
			way: { type: "text", label: en("Decided by") },
			within: { type: "text", label: en("In the group") }
		} as FunctionDecl["form"]
	},
	[CORE_FUNCTION_IDS.workedOut]: {
		name: en("Worked out"),
		meaning: en("A value worked out from others."),
		prose: "A value worked out from others.",
		form: { from: { type: "list", item: { type: "text" }, label: en("From") }, onSheet: { type: "boolean", label: en("On the sheet") } } as unknown as FunctionDecl["form"]
	},
	[CORE_FUNCTION_IDS.tally]: { name: en("A tally"), meaning: en("A count kept from what someone holds."), prose: "A count kept from what someone holds." },
	[CORE_FUNCTION_IDS.typedBonuses]: { name: en("Bonuses have types"), meaning: en("Bonuses of one type don't add up; the best of each counts."), prose: "Bonuses of one type don't add up; the best of each counts." },
	[CORE_FUNCTION_IDS.castingPool]: { name: en("Casting from a pool"), meaning: en("Spells are paid for from a pool."), prose: "Spells are paid for from a pool." }
}

const hasBody = (d: FunctionDecl): boolean => typeof d.body === "string" ? d.body.trim().length > 0 : !!d.seedKey

function choiceOf(decl: FunctionDecl, from: FunctionChoice["from"], source: string, standIn = false): FunctionChoice {
	return {
		id: decl.id,
		name: i18nText(decl.name) ?? decl.id,
		meaning: i18nText(decl.meaning) ?? "",
		kind: String(decl.kind ?? ""),
		from,
		source,
		decides: functionRefDecides({ ref: decl.id, ...(from === "ruleset" ? { module: decl } : {}) } as FunctionRef),
		hasBody: hasBody(decl),
		decl,
		...(standIn ? { standIn: true as const } : {})
	}
}

/** Every reserved id's name, registered or stood in: what an archetype card says decides it. */
export function functionNames(): Map<string, string> {
	const out = new Map<string, string>()
	for (const [id, h] of Object.entries(STAND_INS)) out.set(id, i18nText(h.name) ?? id)
	for (const f of registeredFunctions()) out.set(f.id, i18nText(f.name) ?? f.id)
	return out
}

/**
 * 🚧 The catalogue for one ruleset's editor: every registered function
 * (core first, then packages), a stand-in for each reserved core id not yet
 * registered, then the modules this pub's other rulesets carry (forks and
 * their own), by that ruleset's label.
 */
async function functionChoices(db: Db, rulesetId: string, plugins: Map<string, string>): Promise<FunctionChoice[]> {
	const out: FunctionChoice[] = []
	const seen = new Set<string>()
	for (const f of registeredFunctions()) {
		const owner = f.id.slice(0, f.id.indexOf(":"))
		out.push(choiceOf(f, owner === "core" ? "core" : "package", owner === "core" ? "Serene Pub" : (plugins.get(owner) ?? owner)))
		seen.add(f.id)
	}
	for (const [id, h] of Object.entries(STAND_INS)) {
		if (seen.has(id)) continue
		const r = RESERVED_FUNCTIONS[id]
		out.push(choiceOf({ id, kind: r?.kind ?? "value", prose: "", ...h } as FunctionDecl, "core", "Serene Pub", true))
		seen.add(id)
	}
	const rows = await rowsByRulesetId(db)
	for (const [id, row] of rows) {
		if (id === rulesetId) continue
		for (const ref of rulesetSections(row.draft).functions ?? []) {
			const m = ref?.module
			if (!m || typeof m.id !== "string" || seen.has(m.id)) continue
			seen.add(m.id)
			out.push(choiceOf(m, "ruleset", row.label))
		}
	}
	return out.sort((a, b) => (a.from === b.from ? 0 : a.from === "core" ? -1 : b.from === "core" ? 1 : a.from === "package" ? -1 : 1))
}

/** The slot a copy under `owner` gives a source's own slot (`copyOwnSlots`'s rule). */
const copiedSlotId = (id: string, owner: string): string => `${owner}:slot/${slotStem(id)}@1`

/** A template's playtest with its stats renamed onto the copy's own slots. */
function playtestFor(template: RulesetTemplate, rulesetId: string): RulesetPlaytest {
	const owner = parseRulesetId(rulesetId)?.owner ?? ""
	const own = new Set(rulesetDocumentOwnSlots(rulesetDocumentOf(template.ruleset)))
	const rename = (id: string) => (own.has(id as SlotId) ? copiedSlotId(id, owner) : id)
	const scene = JSON.parse(JSON.stringify(template.playtest)) as RulesetPlaytest
	return {
		...scene,
		party: scene.party.map((m) => ({
			...m,
			...(m.stats ? { stats: Object.fromEntries(Object.entries(m.stats).map(([k, v]) => [rename(k), v])) } : {})
		}))
	}
}

export interface ScriptChoice {
	id: number
	name: string
	typeId: string
	/** The key a ruleset's `scripts[].seedKey` names; null until `scriptSeedKeyFor` stamps one. */
	seedKey: string | null
	enabled: boolean
	shipped: boolean
}

async function scriptChoices(db: Db): Promise<ScriptChoice[]> {
	const rows = (await db
		.select({
			id: schema.pipelineScripts.id,
			name: schema.pipelineScripts.name,
			typeId: schema.pipelineScripts.typeId,
			seedKey: schema.pipelineScripts.seedKey,
			enabled: schema.pipelineScripts.enabled,
			isImmutable: schema.pipelineScripts.isImmutable
		})
		.from(schema.pipelineScripts)
		.orderBy(asc(schema.pipelineScripts.name))) as {
		id: number
		name: string
		typeId: string
		seedKey: string | null
		enabled: boolean
		isImmutable: boolean
	}[]
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		typeId: r.typeId,
		seedKey: r.seedKey,
		enabled: r.enabled,
		shipped: r.isImmutable
	}))
}

/**
 * The seed key a ruleset's script phase names for an Admin › Scripts row. A
 * shipped row has one; a row a person wrote gets one stamped here, under the
 * ruleset's owner (`<owner>:script/<name>-<id>`), once — the core seeder only
 * ever upserts its own keys, so a stamped row is never touched by it.
 */
export async function scriptSeedKeyFor(db: Db, rulesetId: string, scriptId: number): Promise<string> {
	const parsed = parseRulesetId(rulesetId)
	if (!parsed) refuse(`'${rulesetId}' is not a ruleset id.`)
	const [row] = (await db
		.select({ id: schema.pipelineScripts.id, name: schema.pipelineScripts.name, seedKey: schema.pipelineScripts.seedKey })
		.from(schema.pipelineScripts)
		.where(eq(schema.pipelineScripts.id, scriptId))) as { id: number; name: string; seedKey: string | null }[]
	if (!row) refuse(`There is no script with id ${scriptId}.`)
	if (row!.seedKey) return row!.seedKey
	const slug = row!.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "script"
	const seedKey = `${parsed!.owner}:script/${slug}-${row!.id}`
	await db.update(schema.pipelineScripts).set({ seedKey }).where(eq(schema.pipelineScripts.id, row!.id))
	return seedKey
}

export interface DerivedEntryTypeShape {
	repertoireId: string
	entryTypeId: string
	fields: Record<string, FieldDecl>
}

function derivedEntryTypesOf(doc: RulesetDocument | null): DerivedEntryTypeShape[] {
	if (!doc) return []
	try {
		return rulesetEntryTypeDecls(doc as unknown as RulesetDecl, ENTRY_UNIVERSAL_PARTS).map((d) => ({
			repertoireId: d.id.slice(d.id.lastIndexOf(".") + 1, d.id.lastIndexOf("@") > 0 ? d.id.lastIndexOf("@") : undefined),
			entryTypeId: d.id,
			fields: (d.fields ?? {}) as Record<string, FieldDecl>
		}))
	} catch {
		return []
	}
}

export interface SlotChoice {
	id: string
	label: string
	owner: string
	type: string
	appliesTo: string[]
	retired: boolean
}

const slotChoices = (): SlotChoice[] =>
	attributeSlots()
		.map((s) => ({
			id: s.id,
			label: i18nText(s.label) ?? slotStem(s.id),
			owner: s.id.slice(0, s.id.indexOf(":")),
			type: String(s.type ?? ""),
			appliesTo: [...(s.appliesTo ?? [])],
			retired: !!(s as { retired?: boolean }).retired
		}))
		.sort((a, b) => a.label.localeCompare(b.label))

type Row = typeof schema.rulesets.$inferSelect

/* ── Reads ─────────────────────────────────────────────────────────────── */

async function pluginNames(db: Db): Promise<Map<string, string>> {
	const rows = (await db
		.select({ pluginId: schema.plugins.pluginId, name: schema.plugins.name })
		.from(schema.plugins)) as { pluginId: string; name: string | null }[]
	return new Map(rows.map((r) => [r.pluginId, r.name ?? r.pluginId]))
}

async function pluginIds(db: Db): Promise<Set<string>> {
	return new Set((await pluginNames(db)).keys())
}

const rowsByRulesetId = async (db: Db): Promise<Map<string, Row>> =>
	new Map(
		((await db.select().from(schema.rulesets).orderBy(asc(schema.rulesets.id))) as Row[]).map((r) => [
			r.rulesetId,
			r
		])
	)

/** Whose a ruleset is: `core`, a row here (`pub`), else a plugin's. */
export async function rulesetOrigin(db: Db, rulesetId: string): Promise<RulesetOrigin> {
	if (rulesetId.startsWith("core:")) return "core"
	const [row] = (await db
		.select({ id: schema.rulesets.id })
		.from(schema.rulesets)
		.where(eq(schema.rulesets.rulesetId, rulesetId))) as { id: number }[]
	return row ? "pub" : "plugin"
}

/** How many sessions and lorebooks name a ruleset as their primary one. */
export async function playedBy(db: Db, rulesetId: string): Promise<{ sessions: number; lorebooks: number }> {
	const [[s], [l]] = await Promise.all([
		db.select({ n: count() }).from(schema.sessions).where(eq(schema.sessions.primaryRuleset, rulesetId)),
		db.select({ n: count() }).from(schema.lorebooks).where(eq(schema.lorebooks.primaryRuleset, rulesetId))
	])
	return { sessions: Number((s as any)?.n ?? 0), lorebooks: Number((l as any)?.n ?? 0) }
}

const retiredIds = new Set<string>()

/**
 * The rulesets a picker offers: every registered one except a retired pub
 * ruleset. Sessions and lorebooks that already pin a retired one keep it —
 * it is registered — they just cannot be newly made on it.
 */
export const pickableRulesets = (): RulesetDecl[] => rulesets().filter((r) => !retiredIds.has(r.id))

/** 🚧 Read through the sections (2026-10-23): a check method that throws dice, or a function that does. */
const rollsDice = (decl: RulesetDecl | null | undefined): boolean => !!decl && rulesetRollsDice(decl as never)

const sameDocument = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

function rowState(row: Row): RulesetState {
	if (row.retiredAt) return "retired"
	return row.published ? "published" : "draft"
}

async function listRow(
	db: Db,
	decl: RulesetDecl | undefined,
	row: Row | undefined,
	plugins?: Map<string, string>
): Promise<RulesetListRow> {
	const id = (row?.rulesetId ?? decl?.id)!
	const doc = (row?.published ?? row?.draft) as RulesetDocument | undefined
	const shown = decl ?? (doc as unknown as RulesetDecl | undefined)
	const origin: RulesetOrigin = row ? "pub" : id.startsWith("core:") ? "core" : "plugin"
	const owner = id.slice(0, id.indexOf(":"))
	return {
		pluginName: origin === "plugin" ? ((plugins ?? (await pluginNames(db))).get(owner) ?? owner) : null,
		rulesetId: id,
		label: row?.label ?? i18nText(shown?.name) ?? id,
		name: i18nText(shown?.name) ?? id,
		description: i18nText(shown?.description) ?? "",
		origin,
		state: row ? rowState(row) : "shipped",
		version: row?.publishedVersion ?? null,
		draftChanged: row ? !row.published || !sameDocument(row.draft, row.published) : false,
		draftFindings: row?.draftFindings?.length ?? 0,
		rollsDice: rollsDice(shown),
		// 🚧 Any deciding function, in either shape (the SDK's reading, 2026-10-23).
		decides: !!shown && rulesetDecides(shown),
		playedBy: await playedBy(db, id)
	}
}

/** Every ruleset the pub knows: registered ones and the pub's rows (drafts included). */
export async function listRulesets(db: Db): Promise<RulesetListRow[]> {
	const rows = await rowsByRulesetId(db)
	const plugins = await pluginNames(db)
	const out: RulesetListRow[] = []
	const seen = new Set<string>()
	for (const decl of rulesets()) {
		seen.add(decl.id)
		out.push(await listRow(db, decl, rows.get(decl.id), plugins))
	}
	for (const [id, row] of rows) if (!seen.has(id)) out.push(await listRow(db, undefined, row, plugins))
	return out.sort((a, b) => (a.origin === b.origin ? a.name.localeCompare(b.name) : a.origin === "core" ? -1 : b.origin === "core" ? 1 : a.origin.localeCompare(b.origin)))
}

export async function rulesetDetail(db: Db, rulesetId: string): Promise<RulesetDetail | null> {
	const rows = await rowsByRulesetId(db)
	const row = rows.get(rulesetId)
	const decl = getRuleset(rulesetId)
	if (!row && !decl) return null
	const base = await listRow(db, decl, row)
	const draft = (row?.draft ?? null) as RulesetDocument | null
	const published = (row?.published ?? null) as RulesetDocument | null
	const shownDoc = draft ?? (decl ? rulesetDocumentOf(decl) : null)
	const template = row?.basedOn ? getRulesetTemplate(row.basedOn) : undefined
	return {
		...base,
		basedOn: row?.basedOn ?? null,
		basedOnName: row?.basedOn
			? (i18nText(getRuleset(row.basedOn)?.name) ?? (template ? (i18nText(template.label) ?? null) : null))
			: null,
		draft,
		published: published ?? (decl && !row ? rulesetDocumentOf(decl) : null),
		findings: row ? row.draftFindings : [],
		upgradeFindings: draft && published ? rulesetDocumentUpgradeFindings(published, draft) : [],
		ownSlots: shownDoc ? rulesetDocumentOwnSlots(shownDoc) : [],
		slotChoices: slotChoices(),
		derivedEntryTypes: derivedEntryTypesOf(shownDoc),
		scriptChoices: await scriptChoices(db),
		playtest: template ? playtestFor(template, rulesetId) : null,
		vocabularyChoices: vocabularyChoices(),
		functionChoices: await functionChoices(db, rulesetId, await pluginNames(db))
	}
}

/* ── Writes ────────────────────────────────────────────────────────────── */

export interface CreatePubRulesetParams {
	ownerSlug: string
	name: string
	label: string
	/** A registered ruleset, or a ruleset template (`getRulesetTemplate`), to copy; from scratch when left out. */
	from?: string | null
	/**
	 * 🚧 A ruleset someone shared, pasted as its document (D8, _Paste a
	 * document_): taken under the new id, its modules re-owned and the slots
	 * it names borrowed (`reidRulesetDocument`). Wins over `from`.
	 */
	document?: unknown
	userId: number
}

/**
 * 🚧 **From scratch** (R9, PLAN-rulesets-functions D2, 2026-10-23): the
 * label as its name and nothing else — no voice, no time, no outcomes, no
 * way to decide. A session on it reads exactly as one with no rules; what
 * that needs is the host's.
 */
function blankDocument(id: string, label: string): RulesetDocument {
	return { id, version: "1.0.0", name: { en: label } } as unknown as RulesetDocument
}

/**
 * 🚧 A document in the seven sections (D2): what the editor reads and every
 * Save writes — a copy of a ruleset written in the shape before them is
 * read through its aliases once, here (`rulesetInSections`), as data
 * upgrade 0119 does for stored rows.
 */
const inSections = (doc: RulesetDocument): RulesetDocument => {
	const d = doc as unknown as Record<string, unknown>
	return {
		...rulesetInSections(doc),
		id: doc.id,
		version: doc.version,
		// 🚧 The author's handbook pages and saved tests ride along (the SDK's kept keys do not name them yet).
		...(Array.isArray(d.handbook) ? { handbook: d.handbook } : {}),
		...(Array.isArray(d.playtests) ? { playtests: d.playtests } : {})
	} as unknown as RulesetDocument
}

/**
 * Copy the slots a document owns under the new owner as stored slots, each a
 * row of its own (`declareSlot`); a slot already declared under the new id is
 * reused. Returns the rename map `reidRulesetDocument` takes.
 */
async function copyOwnSlots(db: Db, userId: number, doc: RulesetDocument, owner: string): Promise<Record<string, SlotId>> {
	const out: Record<string, SlotId> = {}
	for (const id of rulesetDocumentOwnSlots(doc)) {
		const decl = getAttributeSlot(id)
		if (!decl) continue
		const next = copiedSlotId(id, owner) as SlotId
		if (!getAttributeSlot(next)) {
			// 🚧 A slot the source owned by name (`rulesetOwned`, a template's
			// always) is the copy's now through its stats entry: the name goes.
			const { id: _i, origin: _o, authorUserId: _a, retired: _r, rulesetOwned: _ro, ...props } = decl as typeof decl & {
				authorUserId?: unknown
				retired?: unknown
				rulesetOwned?: unknown
			}
			await declareSlot(db, userId, next, props as AttributeSlotProps)
		}
		out[id] = next
	}
	return out
}

export async function createPubRuleset(db: Db, params: CreatePubRulesetParams): Promise<{ rulesetId: string }> {
	const owner = String(params.ownerSlug ?? "").trim()
	const name = String(params.name ?? "").trim()
	const label = String(params.label ?? "").trim()
	if (owner === "core") refuse("'core' is Serene Pub's own name — choose an owner name of your own.")
	if (!OWNER_SLUG.test(owner))
		refuse("The owner name takes lowercase letters and digits, joined by single dots or hyphens.")
	if ((await pluginIds(db)).has(owner) || isReservedAttributeOwner(owner))
		refuse(`'${owner}' is an installed plugin's name — a ruleset made here needs an owner name no plugin uses.`)
	if (!RULESET_NAME.test(name)) refuse("The ruleset name takes lowercase letters and digits, joined by single hyphens.")
	if (!label) refuse("A ruleset needs a label people will see.")
	const rulesetId = `${owner}:ruleset/${name}@1`
	if (getRuleset(rulesetId) || (await rowsByRulesetId(db)).has(rulesetId))
		refuse(`There is already a ruleset called '${rulesetId}'.`)

	let draft: RulesetDocument
	const pasted = params.document
	const from = pasted === undefined || pasted === null ? params.from?.trim() || null : null
	if (pasted !== undefined && pasted !== null) {
		if (typeof pasted !== "object" || Array.isArray(pasted)) refuse("A pasted ruleset is its document: one JSON object.")
		const given = pasted as Record<string, unknown>
		const version = typeof given.version === "string" && /^\d+\.\d+\.\d+$/.test(given.version) ? given.version : "1.0.0"
		// Under its own id it may be anyone's; under the new one, ours: what it names but did not bring is borrowed.
		const doc = { ...given, id: typeof given.id === "string" && parseRulesetId(given.id) ? given.id : rulesetId, version } as unknown as RulesetDocument
		draft = inSections({ ...reidRulesetDocument(doc, rulesetId, {}), name: { en: label } })
	} else if (from) {
		// 🚧 A ruleset template is copied as a ruleset is (D4): never played itself.
		const source = getRuleset(from) ?? getRulesetTemplate(from)?.ruleset
		if (!source) refuse(`There is no ruleset called '${from}' to start from.`)
		const doc = rulesetDocumentOf(source!)
		const slots = await copyOwnSlots(db, params.userId, doc, owner)
		draft = inSections({ ...reidRulesetDocument(doc, rulesetId, slots), name: { en: label } })
	} else draft = blankDocument(rulesetId, label)

	await db.insert(schema.rulesets).values({
		rulesetId,
		ownerSlug: owner,
		label,
		basedOn: from,
		draft: draft as unknown as Record<string, unknown>,
		draftFindings: rulesetDocumentFindings(draft),
		createdBy: params.userId
	})
	return { rulesetId }
}

async function pubRow(db: Db, rulesetId: string): Promise<Row> {
	// 🚧 RF fix 6: a request that names no ruleset says so, never "There is no ruleset called ''".
	if (typeof rulesetId !== "string" || !rulesetId.trim()) refuse("No ruleset was named. Open the ruleset again from Admin › Rulesets.")
	const [row] = (await db.select().from(schema.rulesets).where(eq(schema.rulesets.rulesetId, rulesetId))) as Row[]
	if (!row) {
		if (getRuleset(rulesetId))
			refuse(`'${rulesetId}' ${rulesetId.startsWith("core:") ? "is Serene Pub's" : "is a plugin's"} and stays as written. Copy it to change it.`)
		refuse(`There is no ruleset called '${rulesetId}'.`)
	}
	return row!
}

export async function saveRulesetDraft(
	db: Db,
	rulesetId: string,
	draft: unknown,
	patch: { label?: string } = {}
): Promise<{ findings: string[] }> {
	const row = await pubRow(db, rulesetId)
	if (row.retiredAt) refuse(`'${rulesetId}' is retired. Unretire it to edit it.`)
	if (!draft || typeof draft !== "object" || Array.isArray(draft)) refuse("A draft is the ruleset's document, an object.")
	const doc = { ...(draft as Record<string, unknown>), id: rulesetId } as unknown as RulesetDocument
	const findings = rulesetDocumentFindings(doc)
	const label = patch.label !== undefined ? String(patch.label).trim() : row.label
	if (!label) refuse("A ruleset needs a label people will see.")
	await db
		.update(schema.rulesets)
		.set({ draft: doc as unknown as Record<string, unknown>, draftFindings: findings, label })
		.where(eq(schema.rulesets.id, row.id))
	return { findings }
}

/** Put a document in the registry with its derived entry types. */
function registerDocument(doc: RulesetDocument, userId: number | string): RulesetDecl {
	const decl = defineStoredRulesetDocument(doc, { userId })
	deriveEntryTypes(decl)
	return decl
}

export interface PublishParams {
	userId: number
	/** The version to publish as; the draft's own when left out. */
	version?: string
	/** Accept the upgrade findings (dropped or changed fields) and publish anyway. */
	acknowledgeUpgrade?: boolean
}

export async function publishPubRuleset(db: Db, rulesetId: string, params: PublishParams): Promise<{ version: string }> {
	const row = await pubRow(db, rulesetId)
	if (row.retiredAt) refuse(`'${rulesetId}' is retired. Unretire it to publish it.`)
	const draft = {
		...(row.draft as unknown as RulesetDocument),
		id: rulesetId,
		...(params.version ? { version: params.version } : {})
	} as RulesetDocument
	const findings = rulesetDocumentFindings(draft)
	if (findings.length) refuse(`The draft is not ready to publish:\n · ${findings.join("\n · ")}`)
	const published = row.published as unknown as RulesetDocument | null
	if (published) {
		const upgrade = rulesetDocumentUpgradeFindings(published, draft)
		const versionOnly = upgrade.filter((f) => f.startsWith("[version-"))
		if (versionOnly.length) refuse(versionOnly.join("\n"))
		if (upgrade.length && !params.acknowledgeUpgrade)
			refuse(`Publishing would change what is stored:\n · ${upgrade.join("\n · ")}`)
	}
	registerDocument(draft, params.userId)
	retiredIds.delete(rulesetId)
	await db
		.update(schema.rulesets)
		.set({
			draft: draft as unknown as Record<string, unknown>,
			draftFindings: [],
			published: draft as unknown as Record<string, unknown>,
			publishedVersion: draft.version
		})
		.where(eq(schema.rulesets.id, row.id))
	return { version: draft.version }
}

export async function retirePubRuleset(db: Db, rulesetId: string): Promise<void> {
	const row = await pubRow(db, rulesetId)
	if (row.retiredAt) return
	await db.update(schema.rulesets).set({ retiredAt: new Date() }).where(eq(schema.rulesets.id, row.id))
	retiredIds.add(rulesetId)
}

export async function unretirePubRuleset(db: Db, rulesetId: string): Promise<void> {
	const row = await pubRow(db, rulesetId)
	if (!row.retiredAt) return
	await db.update(schema.rulesets).set({ retiredAt: null }).where(eq(schema.rulesets.id, row.id))
	retiredIds.delete(rulesetId)
}

/**
 * Delete a pub ruleset nothing names. One a session or lorebook still plays is
 * refused with the counts — retire it instead. The slots it declared stay as
 * stored slots (their values are parked data; retire them in Attributes).
 */
export async function deletePubRuleset(db: Db, rulesetId: string): Promise<void> {
	const row = await pubRow(db, rulesetId)
	const used = await playedBy(db, rulesetId)
	if (used.sessions || used.lorebooks)
		refuse(
			`'${row.label}' is played by ${used.sessions} session${used.sessions === 1 ? "" : "s"} and ${used.lorebooks} lorebook${used.lorebooks === 1 ? "" : "s"}, so it cannot be deleted. Retire it: they keep playing it, and nobody new starts on it.`
		)
	_withdrawRuleset(rulesetId)
	retiredIds.delete(rulesetId)
	await db.delete(schema.rulesets).where(eq(schema.rulesets.id, row.id))
}

/* ── Boot ──────────────────────────────────────────────────────────────── */

/**
 * Register every published pub ruleset from its row. Returns one line per row
 * refused (an owner a plugin has since claimed, a slot that is gone, a
 * document this build's SDK refuses); the row is kept — its page shows why.
 */
export async function registerPubRulesets(db: Db): Promise<string[]> {
	const lines: string[] = []
	const rows = (await db
		.select()
		.from(schema.rulesets)
		.orderBy(asc(schema.rulesets.id))) as Row[]
	const installed = await pluginIds(db)
	for (const row of rows) {
		if (!row.published) continue
		const parsed = parseRulesetId(row.rulesetId)
		if (!parsed || installed.has(parsed.owner) || isReservedAttributeOwner(parsed.owner)) {
			lines.push(`${row.rulesetId}: its owner '${parsed?.owner ?? "?"}' is now an installed plugin's name; the plugin's declaration wins.`)
			continue
		}
		try {
			registerDocument({ ...(row.published as unknown as RulesetDocument), id: row.rulesetId }, row.createdBy ?? 0)
			if (row.retiredAt) retiredIds.add(row.rulesetId)
		} catch (e) {
			lines.push(`${row.rulesetId}: ${e instanceof Error ? e.message : String(e)}`)
		}
	}
	return lines
}

/** Tests only: forget which pub rulesets are retired. */
export function _clearPubRulesets(): void {
	retiredIds.clear()
}
