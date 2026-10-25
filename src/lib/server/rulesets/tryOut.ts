/**
 * 🚧 **Try it out** (PLAN-ruleset-editor §6.6) and the design path's runs
 * (PLAN-rulesets-authoring D4, lane M4, 2026-10-22): a ruleset's document
 * through the handler's engine on a sample party, with no session, no model
 * call and nothing written. The administrator sees what the model would be
 * handed — the labelled blocks with their token counts and depths — and,
 * with a proposed change, what `apply` would decide, allow, refuse and
 * explain.
 *
 * Every run of Admin › Rulesets comes through here:
 *
 *  · **What the model will read** — each step's preview, on the UNSAVED
 *    draft (`document`), for the sample party;
 *  · **a rule's dry run** — one rule on one sample thing held;
 *  · **Run on the sample** — one script line, its phase run in QuickJS
 *    (`scripts`);
 *  · **Playtest a scene** — a party of two or three, the situation, one
 *    change through the resolver as a turn runs it (`scripts`: effects →
 *    worked out → the change, its checks asked before and after a roll →
 *    what the model reads), a card-draw deck shuffled for the scene.
 *
 * A draft need not be published: the engine reads the declaration it is
 * given and never the registry, so the document itself is run (its stats
 * must name declared slots, as `rulesetDocumentFindings` already requires).
 * `document` is honoured for a ruleset made on this pub only — a shipped or
 * plugin one always runs as written.
 *
 * 🚧 **A ruleset in the seven sections** (PLAN-rulesets-functions D8, lane
 * A4, 2026-10-23): the sample party carries its attributes (values keyed by
 * the slot each is filed under — its own `slot`, else the derived one,
 * `rulesetAttributeSlotId`) and its entry types' library rows. Until the
 * engine reads the sections (lane A1), three runs are stand-ins behind this
 * same socket shape, each marked where it is built:
 *
 *  · the **`sections` block** — the ruleset's sentences (attributes, entry
 *    and zone types, functions' "reads as", outcome words, time) and each
 *    member's values, as the model would read them (`sectionsBlock`);
 *  · **Try this function** (`fn`) — what it reads as, and whether it ran
 *    (`ran: false` until the engine runs function modules);
 *  · **Run it N times** (`repeat`) — the engine alone, N seeds, the outcome
 *    words counted (real today for the ways a check is decided).
 */
import {
	_entryTypeAsRepertoire,
	checkMethodKindOfFunction,
	CORE_FUNCTION_IDS,
	declaresSections,
	functionRefKey,
	getAttributeSlot,
	getRuleset,
	i18nText,
	resolveFunctionRef,
	rulesetAttributeSlotId,
	rulesetDocumentFindings,
	rulesetDocumentOf,
	rulesetDocumentProps,
	_rulesetDeclOf,
	rulesetSections,
	rulesetSettingValues,
	rulesetZoneTypes,
	tieSidesOf,
	ZONE_HOLDS_ANY,
	type FunctionRef,
	type RulesetAttributeDecl,
	type RulesetDecl,
	type RulesetDocument,
	type RulesetSections,
	type Rigour,
	type SlotValue
} from "@serene-pub/sdk"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { slotKey } from "$lib/server/state/keys"
import { seededRandom } from "$lib/server/state/expressions"
import { earlyPhases, estimateTokens, runApply, runApplyAsync, runResolve } from "./engine"
import { checkScriptDriver, renderBlocks, runDerivedScripts, runEffectsScripts, type RulesetScriptDeps, type ScriptExplain, type ScriptFailure } from "./scripts"
import type { EngineInput, EngineOutput, HeldPiece, HeldRepertoire, OwnerStat, OwnerView, ProposedDelta, ZoneEntry } from "./types"

export interface TryOutSample {
	/** The member's name; "Sample" (then "Sample 2", …) when left out. */
	name?: string
	/** Values per stat slot id; a stat left out takes its declared default. */
	stats?: Record<string, SlotValue>
	/** Compendium row ids held per repertoire; left out, the first two rows of each. */
	pieces?: Record<string, string[]>
	/**
	 * 🚧 The member's side of each tie (T1): per tie entry type, per other
	 * member's name, that side's field values — held in the zone its holder
	 * keeps ties of that type in, so a check reading `bond.affection` reads it.
	 */
	ties?: Record<string, Record<string, Record<string, SlotValue>>>
}

export interface TryOutParams {
	rigour: Rigour
	/** One sample character (Try it out's); `party` wins when both are sent. */
	sample?: TryOutSample
	/** 🚧 A sample party of one to four (the design path's), keyed `sample:1`, `sample:2`, …. */
	party?: TryOutSample[]
	/**
	 * Changes to put through `apply`; none runs `resolve` only. A change's
	 * `owner` and `aimedAt` may name a member by name (a playtest scene's).
	 */
	deltas?: ProposedDelta[]
	/** Settings values (by setting name); the defaults otherwise. */
	settings?: Record<string, string>
	/** The seed, so a run replays: the dice, and a card-draw deck's shuffle. */
	seed?: string
	/** 🚧 The unsaved draft to run instead of the saved one — a pub ruleset's only. */
	document?: Record<string, unknown>
	/**
	 * 🚧 Run the ruleset's script phases in QuickJS, as a turn does (all
	 * five, at Rules and up); off, the engine alone.
	 */
	scripts?: boolean
	/** 🚧 **Try this function** (D8): the key of one of the ruleset's function references. */
	fn?: string
	/** 🚧 **Run it N times** (D8): the run made this many times, a seed each (2–200), the outcomes counted. */
	repeat?: number
}

/** 🚧 What **Try this function** says of one function reference (stand-in until the engine runs modules). */
export interface TryOutFunction {
	key: string
	ref: string
	/** What the model reads of it: its prose, its holes filled by what it is bound to. */
	readsAs: string
	/**
	 * Whether the rules decided it: a way to decide or a check, put through
	 * the engine as a use by the first of the party (2026-10-23). A module's
	 * own handlers run in a turn (the rules sandbox), not here.
	 */
	ran: boolean
}

/** 🚧 **Run it N times**: how many runs, and how often each outcome came up, in the order first seen. */
export interface TryOutRepeat {
	runs: number
	tally: { outcome: string; count: number }[]
}

export interface TryOutMember {
	key: string
	name: string
	stats: { slotId: string; label: string; value: unknown }[]
	pieces: Record<string, string[]>
}

export interface TryOutResult {
	mode: "resolve" | "apply"
	findings: string[]
	blocks: { key: string; text: string; tokens: number; depth: string; priority: number }[]
	facts: Record<string, unknown>
	outcomes: EngineOutput["outcomes"]
	explain: EngineOutput["explain"]
	rejected: EngineOutput["rejected"]
	changes: EngineOutput["changes"]
	/** The first member (Try it out's one sample). */
	sample: TryOutMember
	/** 🚧 Every member of the party, in order. */
	party: TryOutMember[]
	/** 🚧 What the scripts said and where they failed, when `scripts` ran them. */
	scripts?: { explain: ScriptExplain[]; failed: ScriptFailure[] }
	/** 🚧 Try this function's answer, when `fn` named one. */
	function?: TryOutFunction
	/** 🚧 Run it N times's count, when `repeat` asked for one. */
	repeat?: TryOutRepeat
}

export class TryOutRefusal extends Error {
	/**
	 * @param findings 🚧 The draft's findings, when it is refused for them (RF
	 * fix 6, 2026-10-23): what the editor lays on its rows as it stands.
	 */
	constructor(
		message: string,
		readonly findings?: string[]
	) {
		super(message)
	}
}

/** The saved document to run: a pub row's draft, else the registered declaration. */
export async function documentToTry(db: Db, rulesetId: string, unsaved?: Record<string, unknown>): Promise<RulesetDocument> {
	const [row] = (await db
		.select({ draft: schema.rulesets.draft, retiredAt: schema.rulesets.retiredAt })
		.from(schema.rulesets)
		.where(eq(schema.rulesets.rulesetId, rulesetId))) as { draft: Record<string, unknown>; retiredAt: Date | null }[]
	if (row) {
		const doc = unsaved && typeof unsaved === "object" && !Array.isArray(unsaved) && !row.retiredAt ? unsaved : row.draft
		return { ...(doc as unknown as RulesetDocument), id: rulesetId }
	}
	const decl = getRuleset(rulesetId)
	if (!decl) throw new TryOutRefusal(`There is no ruleset called '${rulesetId}'.`)
	return rulesetDocumentOf(decl)
}

/** 🚧 The type a ruleset attribute's value takes, as a slot type reads (`integer`, `enum`, `text`, `list`). */
const attributeType = (a: RulesetAttributeDecl): string =>
	a.kind === "label" ? (a.of?.length ? "enum" : "text") : a.kind === "text" ? "text" : a.kind === "list" ? "list" : "integer"

/** 🚧 Where an attribute starts when it says nothing: a pool full, a number at its floor, a label its first word. */
function attributeStart(a: RulesetAttributeDecl): SlotValue {
	if (a.start !== undefined) return a.start
	if (a.kind === "label") return (a.of?.[0] ?? "") as SlotValue
	// 🚧 Free text (RF fix 2, item 2): nothing written until a holder writes it.
	if (a.kind === "text") return "" as SlotValue
	if (a.kind === "list") return [] as unknown as SlotValue
	if (a.kind === "pool") return (a.bounds?.max ?? a.bounds?.min ?? 0) as SlotValue
	return (a.bounds?.min ?? 0) as SlotValue
}

/**
 * 🚧 The slot a ruleset attribute's value is filed under: its own `slot`
 * (an existing attribute slot, a ⏳ stat), else the one derived from the
 * ruleset (`rulesetAttributeSlotId`). The key a sample's `stats` names.
 */
export const attributeSlotOf = (rulesetId: string, a: RulesetAttributeDecl): string => a.slot ?? rulesetAttributeSlotId(rulesetId, a.id)

/** 🚧 A sample member's sheet in the sections: each attribute's value (given, else its start) and the library rows held. */
export function sectionsOwner(decl: RulesetDecl, s: RulesetSections, sample: TryOutSample, index: number): OwnerView {
	const stats: OwnerStat[] = []
	for (const a of s.attributes ?? []) {
		if (!a || typeof a.id !== "string") continue
		const slotId = attributeSlotOf(decl.id, a)
		const slot = a.slot ? getAttributeSlot(a.slot) : undefined
		const given = sample.stats?.[slotId] ?? sample.stats?.[a.id]
		const value = (given !== undefined ? given : a.start !== undefined || !slot ? attributeStart(a) : slot.default) as SlotValue | undefined
		const max = a.bounds?.max ?? (a.config as Record<string, unknown> | undefined)?.max ?? (slot?.config as Record<string, unknown> | undefined)?.max
		stats.push({
			slotId,
			selector: a.id,
			type: slot ? String(slot.type ?? "") : attributeType(a),
			value,
			...(slot?.type === "derived" && typeof slot.derive === "string" ? { derive: slot.derive } : {}),
			label: i18nText(a.name) ?? (slot ? i18nText(slot.label) : undefined) ?? a.id,
			...(typeof max === "number" ? { max } : {})
		})
	}
	const repertoires: HeldRepertoire[] = []
	for (const e of s.entryTypes ?? []) {
		if (!e || typeof e.id !== "string") continue
		const rows = s.library?.rows?.[e.id] ?? []
		const wanted = sample.pieces?.[e.id]
		const chosen = wanted ? rows.filter((r) => wanted.includes(r.id)) : rows.slice(0, 2)
		const pieces: HeldPiece[] = chosen.map((r) => ({
			key: r.id,
			props: { ...r.piece },
			count: 1,
			form: "compendium",
			item: { kind: "compendium", compendiumId: decl.id, pieceId: r.id, version: r.version }
		}))
		repertoires.push({ slotId: `sample:${e.id}`, repertoire: _entryTypeAsRepertoire(e), pieces })
	}
	return {
		key: `sample:${index + 1}`,
		owner: { kind: "session_cast", id: index },
		name: sample.name?.trim() || (index ? `Sample ${index + 1}` : "Sample"),
		stats,
		repertoires,
		custom: [],
		bag: Object.fromEntries(stats.map((s) => [s.slotId, s.value as SlotValue]))
	}
}

/** A sample member's sheet: the ruleset's stats (given, else their starts) and the library rows held. */
function sampleOwner(decl: RulesetDecl, sample: TryOutSample, index: number): OwnerView {
	const stats: OwnerStat[] = []
	for (const entry of decl.stats) {
		const slot = getAttributeSlot(entry.id)
		if (!slot) continue
		const given = sample.stats?.[entry.id]
		const value = (given !== undefined ? given : (entry.default ?? slot.default)) as SlotValue | undefined
		const max =
			(entry.config as Record<string, unknown> | undefined)?.max ?? (slot.config as Record<string, unknown> | undefined)?.max
		stats.push({
			slotId: entry.id,
			selector: slotKey(entry.id),
			type: String(slot.type ?? ""),
			value,
			...(slot.type === "derived" && typeof slot.derive === "string" ? { derive: slot.derive } : {}),
			label: i18nText(slot.label) ?? slotKey(entry.id),
			...(typeof max === "number" ? { max } : {})
		})
	}
	const repertoires: HeldRepertoire[] = []
	for (const rep of decl.repertoires) {
		const rows = decl.compendium?.rows?.[rep.id] ?? []
		const wanted = sample.pieces?.[rep.id]
		const chosen = wanted ? rows.filter((r) => wanted.includes(r.id)) : rows.slice(0, 2)
		const pieces: HeldPiece[] = chosen.map((r) => ({
			key: r.id,
			props: { ...r.piece },
			count: 1,
			form: "compendium",
			item: { kind: "compendium", compendiumId: decl.id, pieceId: r.id, version: r.version }
		}))
		repertoires.push({ slotId: `sample:${rep.id}`, repertoire: rep, pieces })
	}
	return {
		key: `sample:${index + 1}`,
		owner: { kind: "session_cast", id: index },
		name: sample.name?.trim() || (index ? `Sample ${index + 1}` : "Sample"),
		stats,
		repertoires,
		custom: [],
		bag: Object.fromEntries(stats.map((s) => [s.slotId, s.value as SlotValue]))
	}
}

const memberOut = (o: OwnerView): TryOutMember => ({
	key: o.key,
	name: o.name,
	stats: o.stats.map((s) => ({ slotId: s.slotId, label: s.label, value: s.value })),
	pieces: Object.fromEntries(o.repertoires.map((r) => [r.repertoire.id, r.pieces.map((p) => p.key)]))
})

interface Built {
	input: EngineInput
	owners: OwnerView[]
	seed: string
	apply: boolean
	/** 🚧 The document, when it is written in the sections (the stand-ins read it). */
	sections: RulesetSections | null
	doc: RulesetDocument
}

function build(doc: RulesetDocument, params: TryOutParams): Built {
	const findings = rulesetDocumentFindings(doc)
	if (findings.length) throw new TryOutRefusal(`The draft cannot be run yet:\n · ${findings.join("\n · ")}`, findings)
	const props = rulesetDocumentProps(doc)
	// The declaration as the registry would hold it (`_rulesetDeclOf`): a ruleset in sections carries
	// its ⏳ read-back in the shape before them — its checks and ways as selectors, its entry types as
	// repertoires, its library as compendium — so the engine decides a function's use by its key.
	const decl = _rulesetDeclOf(doc.id, props)
	const sections = declaresSections(doc) ? rulesetSections(doc) : null
	const members = params.party?.length ? params.party.slice(0, 4) : [params.sample ?? {}]
	const owners = members.map((m, i) => (sections ? sectionsOwner(decl, sections, m ?? {}, i) : sampleOwner(decl, m ?? {}, i)))
	const rigour: Rigour = params.rigour === "mechanics" || params.rigour === "scripts" ? params.rigour : "prose"
	const seed = params.seed || "try-out"
	const input: EngineInput = {
		ruleset: decl,
		rigour,
		owners,
		actions: {},
		deltas: params.deltas ?? [],
		elapsed: 0,
		ties: [],
		turn: 1,
		settings: rulesetSettingValues(decl, { values: params.settings ?? {} }),
		viewer: null,
		// 🚧 Dice for the checks a change makes, by the run's seed (a replay rolls the same).
		random: seededRandom(`try-out:${seed}`),
		// 🚧 A card-draw deck is shuffled for the run's one scene, by its seed.
		decks: {},
		scene: 1,
		deckSeed: `deck:try-out:${seed}`
	} as EngineInput
	// 🚧 T1: each member's side of each tie, towards another member, in the zone that holds the type.
	if (sections) {
		const zones = tieZones(decl, sections, members, owners)
		if (zones) input.zones = zones
	}
	return { input, owners, seed, apply: (params.deltas?.length ?? 0) > 0, sections, doc }
}

/** 🚧 A sample party's tie sides as the zone store would hold them (T1): each side its member's, towards the other. */
function tieZones(decl: RulesetDecl, s: RulesetSections, members: readonly (TryOutSample | undefined)[], owners: readonly OwnerView[]): EngineInput["zones"] | undefined {
	const out: Record<string, Record<string, ZoneEntry[]>> = {}
	const zones = rulesetZoneTypes(decl)
	members.forEach((m, i) => {
		const owner = owners[i]
		if (!owner || !m?.ties) return
		for (const [type, sides] of Object.entries(m.ties)) {
			const tie = (s.entryTypes ?? []).find((e) => e.id === type && tieSidesOf(e) !== undefined)
			if (!tie) continue
			const zone = zones.find((z) => z.holds !== ZONE_HOLDS_ANY && z.holds.includes(type) && z.owners.includes("cast"))?.id ?? "carried"
			for (const [otherName, fields] of Object.entries(sides ?? {})) {
				const other = owners.find((o) => o.name === otherName)
				if (!other || other === owner) continue
				const defaults: Record<string, unknown> = {}
				for (const [k, f] of Object.entries(tie.fields ?? {})) if ((f as { default?: unknown }).default !== undefined) defaults[k] = (f as { default?: unknown }).default
				;((out[owner.key] ??= {})[zone] ??= []).push({ entryId: null, entryType: type, name: other.name, fields: { ...defaults, ...(fields ?? {}), towards: other.key }, sideOwner: owner.key })
			}
		}
	})
	return Object.keys(out).length ? out : undefined
}

/* ── 🚧 Stand-ins until the engine reads the sections (lane A1) ─────── */

const en = (v: unknown): string => i18nText(v as never) ?? ""
const sentence = (s: string): string => (/[.!?…]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`)

/** An attribute's shape, said once beside its name: `0–10`, `shy, warm`. */
function shapeWords(a: RulesetAttributeDecl, numbers: boolean): string {
	if (a.kind === "label" || a.kind === "list") return a.of?.length ? a.of.join(", ") : ""
	if (!numbers) return ""
	const lo = a.bounds?.min
	const hi = a.bounds?.max
	return lo !== undefined && hi !== undefined ? `${lo}–${hi}` : hi !== undefined ? `up to ${hi}` : lo !== undefined ? `from ${lo}` : ""
}

/**
 * 🚧 What an entry field selector reads as (ties T3): `bond.affection` →
 * _Affection on a bond_, as the engine's own prose says it (`functionProse`).
 */
function entryFieldNames(s: RulesetSections): Map<string, string> {
	const out = new Map<string, string>()
	for (const e of s.entryTypes ?? [])
		for (const [k, f] of Object.entries({ ...(e.piece?.fields ?? {}), ...(e.fields ?? {}) }) as [string, { type?: string; label?: never }][])
			if (f?.type === "integer" || f?.type === "number") out.set(`${e.id}.${k}`, `${i18nText(f.label) ?? k} on a ${(i18nText(e.name) ?? e.id).toLowerCase()}`)
	return out
}

/** 🚧 A function reference as the model reads it: its prose (or meaning), each `{{hole}}` filled by its binding or option. */
export function functionReadsAs(ref: FunctionRef, names: (id: string) => string = (id) => id): string {
	const r = resolveFunctionRef(ref)
	const prose = r.decl?.prose || en(r.decl?.meaning)
	if (!prose) return ""
	return sentence(
		prose.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, hole: string) => {
			const b = ref.bindings?.[hole]
			if (b !== undefined) return (Array.isArray(b) ? b : [b]).map((x) => names(String(x))).join(", ")
			const o = ref.options?.[hole]
			return o === undefined || o === null ? hole : typeof o === "object" ? (en(o) || JSON.stringify(o)) : String(o)
		})
	)
}

/**
 * 🚧 STAND-IN (lane A4) — what a ruleset in the sections reads as that the
 * engine does not render yet (lane A1 retires this as it does): each
 * attribute's sentence (its shape where numbers show), entry and zone
 * types' sentences, what its functions read as, its outcome words and its
 * time unit — each line left out once its sentence is in the engine's own
 * blocks (A1's derived voice already says the attributes' and functions').
 * Each member's values are the engine's own `sheet` block.
 */
function sectionsBlock(built: Built, engineText = ""): { text: string; tokens: number; depth: string; priority: number } | null {
	const s = built.sections
	if (!s) return null
	const numbers = built.input.rigour !== "prose"
	/** What the engine already renders is never said twice: a line goes once its sentence is in the engine's blocks. */
	const already = (said: string) => !!said.trim() && engineText.includes(said.trim().replace(/[.!?…]+$/, ""))
	const lines: string[] = []
	const attrs = (s.attributes ?? []).filter((a) => a && typeof a.id === "string")
	const label = (a: RulesetAttributeDecl) => en(a.name) || (a.slot ? en(getAttributeSlot(a.slot)?.label) : "") || a.id
	const said: string[] = []
	for (const a of attrs) {
		const prose = a.prose?.trim() || (a.slot ? en(getAttributeSlot(a.slot)?.description) : "")
		if (!prose || already(prose)) continue
		const shape = shapeWords(a, numbers)
		said.push(`${label(a)}${shape ? ` (${shape})` : ""}: ${sentence(prose)}`)
	}
	for (const e of s.entryTypes ?? []) if (e?.prose?.trim() && !already(e.prose)) said.push(`${en(e.name) || e.id}: ${sentence(e.prose)}`)
	for (const z of s.zoneTypes ?? []) if (z?.prose?.trim() && !already(z.prose)) said.push(`${en(z.name) || z.id}: ${sentence(z.prose)}`)
	const attrName = new Map([...entryFieldNames(s), ...attrs.map((a) => [a.id, label(a)] as const)])
	for (const f of s.functions ?? []) {
		const t = functionReadsAs(f, (id) => attrName.get(id) ?? id)
		if (t && !already(t)) said.push(t)
	}
	if (said.length) lines.push(said.join("\n"))
	const words = (s.outcomes ?? []).map((o) => en(o.label) || o.id)
	if (words.length && !words.every((w) => already(w))) lines.push(`How it can go: ${words.join(", ")}.`)
	if (s.time?.unit && !already(`Time is kept in ${s.time.unit}s`)) lines.push(`Time is kept in ${s.time.unit}s.`)
	const text = lines.join("\n\n").trim()
	return text ? { text, tokens: estimateTokens(text), depth: "full", priority: 100 } : null
}

function resultOf(built: Built, out: EngineOutput, scripts?: TryOutResult["scripts"]): TryOutResult {
	const blocks = Object.entries(out.blocks)
		.filter(([k, v]) => k !== "holders" && v && typeof v === "object" && "text" in (v as object))
		.map(([key, v]) => {
			const b = v as { text: string; tokens: number; depth: string; priority: number }
			return { key, text: b.text, tokens: b.tokens, depth: b.depth, priority: b.priority }
		})
	// 🚧 STAND-IN (A4): what the engine does not render of the sections yet (A1), first.
	const stand = sectionsBlock(built, blocks.map((b) => b.text).join("\n"))
	if (stand && !blocks.some((b) => b.key === "sections")) blocks.unshift({ key: "sections", ...stand })
	const party = built.owners.map(memberOut)
	return {
		mode: built.apply ? "apply" : "resolve",
		findings: [],
		blocks,
		facts: out.facts,
		outcomes: out.outcomes,
		explain: out.explain,
		rejected: out.rejected,
		changes: out.changes,
		sample: party[0]!,
		party,
		...(scripts ? { scripts } : {})
	}
}

/**
 * 🚧 What the model reads after a change: the blocks a read of the moment
 * renders (voice, sheet, what they hold…) with the change's `outcomes`
 * block beside them — `apply` alone renders only the outcomes.
 */
function withReadBlocks(built: Built, out: EngineOutput, early?: ReturnType<typeof earlyPhases>): EngineOutput {
	if (!built.apply) return out
	const read = runResolve({ ...built.input, deltas: [] }, built.seed, early)
	out.blocks = { ...read.blocks, ...out.blocks }
	return out
}

/** The engine alone, synchronously: no script runs. */
export function tryOutDocument(doc: RulesetDocument, params: TryOutParams): TryOutResult {
	const built = build(doc, params)
	const out = built.apply ? withReadBlocks(built, runApply(built.input, built.seed)) : runResolve(built.input, built.seed)
	return resultOf(built, out)
}

/**
 * 🚧 The run a turn makes, minus the session: the ruleset's `effects`
 * scripts, its `derived` ones, the engine — its checks asking the `pre-roll`
 * and `post-roll` scripts — and its `render` scripts on the blocks
 * (`resolve.ts`'s order). Script sources come from Admin › Scripts by their
 * seed keys (`deps.loadSource` in tests). A script's failure is a line, never
 * fatal.
 */
export async function playtestDocument(
	db: Db,
	doc: RulesetDocument,
	params: TryOutParams,
	deps: RulesetScriptDeps = {}
): Promise<TryOutResult> {
	const built = build(doc, params)
	const { input, seed } = built
	const scriptDeps: RulesetScriptDeps = { ...deps, seed, settings: input.settings ?? {} }
	const effects = await runEffectsScripts(db, input, scriptDeps)
	if (Object.keys(effects).length) input.effects = effects
	const early = earlyPhases(input)
	input.scripted = await runDerivedScripts(db, input, scriptDeps, early)
	// What the effects and derived scripts said: the engine folds both into the
	// run's explain lines and `facts.scriptsFailed` itself; the summary names
	// each by its phase.
	const said: ScriptExplain[] = []
	const broke: ScriptFailure[] = []
	for (const [owner, v] of Object.entries(input.effects ?? {})) {
		for (const e of v.explain ?? []) said.push({ phase: "effects", seedKey: e.seedKey, text: e.text, owner })
		for (const f of v.failed ?? []) broke.push({ phase: "effects", seedKey: f.seedKey, why: f.why, owner })
	}
	for (const [owner, v] of Object.entries(input.scripted ?? {})) {
		for (const e of v.explain ?? []) said.push({ phase: "derived", seedKey: e.seedKey, text: e.text, owner })
		for (const f of v.failed ?? []) broke.push({ phase: "derived", seedKey: f.seedKey, why: f.why, owner })
	}
	const explain: ScriptExplain[] = []
	const failed: ScriptFailure[] = []
	let out: EngineOutput
	if (!built.apply) out = runResolve(input, seed, early)
	else {
		const driver = await checkScriptDriver(db, input, scriptDeps)
		out =
			driver.checkAsks.preRoll || driver.checkAsks.postRoll
				? await runApplyAsync({ ...input, checkAsks: driver.checkAsks }, driver.answer, seed, early)
				: runApply(input, seed, early)
		explain.push(...driver.explain)
		failed.push(...driver.failed)
		withReadBlocks(built, out, early)
	}
	const rendered = await renderBlocks(db, input, out.blocks, out.outcomes, scriptDeps)
	out.blocks = rendered.blocks
	explain.push(...rendered.explain)
	failed.push(...rendered.failed)
	// As a turn files them (`resolve.ts`): before / after a roll and render lines join the explain trail.
	for (const e of explain) out.explain.push({ target: `${e.owner ?? "session"}.script`, total: 0, terms: [], text: `${e.seedKey}: ${e.text}` })
	if (failed.length) out.facts.scriptsFailed = [...((out.facts.scriptsFailed as unknown[] | undefined) ?? []), ...failed]
	return resultOf(built, out, { explain: [...said, ...explain], failed: [...broke, ...failed] })
}

/** The most runs **Run it N times** makes in one ask. */
export const MAX_REPEAT = 200

/** An outcome in the ruleset's words: a decided check's label, else its band, else what happened. */
const outcomeWord = (o: EngineOutput["outcomes"][number]): string => o.check?.label || o.check?.band || o.text

/**
 * 🚧 **Run it N times** (D8): the engine alone (no scripts: a balance count,
 * not a turn), `n` seeds made from the run's, each run's decided outcomes
 * counted by their words. A run that decides nothing counts as _Nothing
 * decided_.
 */
export function repeatDocument(doc: RulesetDocument, params: TryOutParams, n: number): TryOutResult {
	const runs = Math.max(2, Math.min(MAX_REPEAT, Math.floor(n)))
	const base = params.seed || "try-out"
	const counts = new Map<string, number>()
	let first: TryOutResult | null = null
	for (let i = 1; i <= runs; i++) {
		const r = tryOutDocument(doc, { ...params, seed: `${base}#${i}`, scripts: false, repeat: undefined })
		first ??= r
		const decided = r.outcomes.filter((o) => o.check)
		const words = decided.length ? decided.map(outcomeWord) : ["Nothing decided"]
		for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1)
	}
	return { ...first!, repeat: { runs, tally: [...counts].map(([outcome, count]) => ({ outcome, count })) } }
}

/**
 * 🚧 **Try this function** (D8): what one function reference reads as,
 * beside a run of the ruleset. A way to decide or a check is put through
 * the rules as a use by the first of the party — the engine decides it by
 * its key (the declaration's ⏳ read-back names each as a check) — unless
 * the scene's own change already says what happens; `ran` says whether it
 * was decided.
 */
export function tryFunction(doc: RulesetDocument, params: TryOutParams, key: string): TryOutResult {
	const s = rulesetSections(doc)
	const ref = (s.functions ?? []).find((f) => f && functionRefKey(f) === key)
	if (!ref) throw new TryOutRefusal(`The draft has no function called '${key}'.`)
	const names = new Map([...entryFieldNames(s), ...(s.attributes ?? []).map((a) => [a.id, i18nText(a.name) ?? a.id] as const)])
	const decides = ref.ref === CORE_FUNCTION_IDS.check || checkMethodKindOfFunction(ref.ref) !== undefined
	const deltas = params.deltas?.length ? params.deltas : decides ? [{ owner: "sample:1", op: "use", check: key, reason: "Try this function" } as ProposedDelta] : []
	const result = tryOutDocument(doc, { ...params, fn: undefined, deltas })
	const ran = result.outcomes.some((o) => !!o.check && (o.check.selector === key || o.check.methodKey === key))
	return { ...result, function: { key, ref: ref.ref, readsAs: functionReadsAs(ref, (id) => names.get(id) ?? id), ran } }
}

export async function tryOutRuleset(db: Db, rulesetId: string, params: TryOutParams): Promise<TryOutResult> {
	const doc = await documentToTry(db, rulesetId, params.document)
	if (params.fn) return tryFunction(doc, params, params.fn)
	if (params.repeat && params.repeat > 1) return repeatDocument(doc, params, params.repeat)
	return params.scripts ? playtestDocument(db, doc, params) : tryOutDocument(doc, params)
}

/* ── Ask a model ───────────────────────────────────────────────────────── */

export interface AskModelParams extends TryOutParams {
	/** The scene in a sentence: what is going on as the change is made. */
	situation?: string
}

export interface AskModelResult {
	result: TryOutResult
	/** What the model wrote, handed the blocks and the outcome. */
	narration: string
	/** The loadout the call ran on, by name — for the administrator's eyes. */
	loadout: string
}

/** The words a model is handed for a playtest: the blocks it reads, then the situation and what the rules decided. */
export function playtestPrompt(result: TryOutResult, situation: string): { systemPrompt: string; userPrompt: string } {
	const order = ["voice", "gm", "sheet", "pieces", "ties", "custom"]
	const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length)
	const read = [...result.blocks]
		.filter((b) => b.key !== "outcomes")
		.sort((a, b) => rank(a.key) - rank(b.key))
		.map((b) => b.text)
		.filter(Boolean)
	const outcomes = result.outcomes.map((o) => `- ${o.text}`)
	const refused = result.rejected.map((r) => `- Refused: ${r.why}`)
	return {
		systemPrompt: [
			"You narrate one moment of a story played under these rules. The rules have already decided what happened; tell it, and never change the outcome.",
			...read
		].join("\n\n"),
		userPrompt: [
			situation.trim() ? `The situation: ${situation.trim()}` : "",
			outcomes.length || refused.length ? `What the rules decided:\n${[...outcomes, ...refused].join("\n")}` : "Nothing was decided by the rules.",
			"Narrate what happens next in two or three sentences."
		]
			.filter(Boolean)
			.join("\n\n")
	}
}

/**
 * 🚧 A playtest scene, then one model call on the pub's **Reply** loadout
 * (`core:loadout/reply@1`): handed the blocks the model reads and what the
 * rules decided, it narrates the moment — what a turn's reply would make of
 * it. Admin only; no session, no message, no row is written.
 */
export async function askModelAboutPlaytest(db: Db, rulesetId: string, params: AskModelParams): Promise<AskModelResult> {
	const doc = await documentToTry(db, rulesetId, params.document)
	const result = await playtestDocument(db, doc, params)
	const { CORE_LOADOUT } = await import("@serene-pub/core-catalog")
	const { findLoadout, resolveLoadout } = await import("$lib/server/loadouts")
	const requested = await findLoadout(db, CORE_LOADOUT.reply)
	if (!requested) throw new TryOutRefusal("The pub has no Reply loadout to ask. Set one up in Admin › Models.")
	const resolution = await resolveLoadout(db, requested)
	const effective = resolution.effective
	if (!effective?.connectionId)
		throw new TryOutRefusal("The Reply loadout has no model yet. Pick one in Admin › Models, then ask again.")
	const { dispatchStep } = await import("$lib/server/pipelines/runtime/dispatchStep")
	const prompt = playtestPrompt(result, params.situation ?? "")
	const { text } = await dispatchStep(db, {
		...prompt,
		connectionId: effective.connectionId,
		connectionModelId: effective.connectionModelId ?? null,
		samplingId: effective.samplingConfigId ?? null,
		label: "Playtest a scene"
	})
	return { result, narration: text.trim(), loadout: effective.name }
}
