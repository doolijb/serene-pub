/**
 * 🚧 Admin › Rulesets › one ruleset, **in the seven sections**
 * (PLAN-rulesets-functions D2, D8; lane A4, 2026-10-23): what the editor's
 * form holds, and how a Save turns it back into ONE document.
 *
 * The draft is read through `rulesetSections` — a draft written in the shape
 * before the sections (stats, repertoires, conventions, selectors, scripts…)
 * reads through its aliases — and every Save writes the sections: the first
 * Save of an older draft rewrites it, as data upgrade 0119 does for what is
 * stored. Nothing is required beyond a name: a section with nothing in it is
 * left out, so a ruleset from scratch stays `{ id, version, name }` (R9).
 *
 * The form holds text where a person types (numbers as their boxes show
 * them, lists comma-joined), and each row keeps the declaration it was read
 * from (`original`): a row nobody touched writes that object back byte for
 * byte, and what no field shows (a ⏳ entry type's whole piece shape, a
 * stat's config) rides through an edit of what one does.
 *
 * **The merge rule** (as before): Save sends `rulesets:saveDraft` once —
 * the Document's text when it changed (it wins over the forms, and the page
 * says so before Save), else the forms over the saved draft, else the saved
 * draft as it was.
 *
 * Besides the sections the document carries, kept by the editor: its name,
 * description and voice; the author's handbook pages (`handbook: [{ title,
 * body }]`, the field the handbook generator reads); and the playtest scenes
 * saved as tests (`playtests`). Everything else said at the top level of the
 * draft rides through untouched.
 *
 * Pure (no Svelte, no socket): pinned by `rulesetSectionsForm.test.ts`.
 */
import {
	entryTypeFields,
	FIVE_BANDS,
	functionRefKey,
	modelShareOf,
	rulesetEntryTypeId,
	rulesetSections,
	type FieldDecl,
	type FunctionRef,
	type RulesetAttributeDecl,
	type RulesetEntryTypeDecl,
	type RulesetOutcomeDecl,
	type RulesetSections,
	type ZoneTypeDecl
} from "@serene-pub/sdk"
import type { SameFormValueOptions } from "$lib/client/forms/sameFormValue"
import { applyLibrary, libraryFormOf, type DerivedEntryTypeShape, type LibraryForm } from "./rulesetLibraryForm"
import { isObject, newRowUid, numberText, plain, setOrDrop, textOf, unchanged, withEnglish, type Json } from "./rulesetFormParts"
import { parseDocumentText } from "./rulesetDocument"

export { newRowUid, textOf, withEnglish }
export type { Json }

/** The keys of the shape before the sections: a Save that writes the sections leaves them behind. */
export const LEGACY_KEYS = [
	"stats",
	"repertoires",
	"selectors",
	"scripts",
	"conventions",
	"compendium",
	"settings",
	"presets",
	"conversions",
	"difficultyBands",
	"entryable"
] as const

/** The section keys, as `RULESET_SECTIONS` names them (outcomes and time are one view). */
export const SECTION_KEYS = ["attributes", "functions", "entryTypes", "zoneTypes", "outcomes", "time", "library", "options"] as const

/** The three voices, in the order How strict reads them. */
export const VOICE_RIGOURS = ["prose", "mechanics", "scripts"] as const
export type VoiceRigour = (typeof VOICE_RIGOURS)[number]
/** A voice rides in every prompt at its level: about 60 tokens (the SDK's `VOICE_MAX_CHARS`). */
export const VOICE_MAX = 240

/* ── rows ─────────────────────────────────────────────────────────── */

export interface AttributeRow {
	uid: string
	/** What functions bind it by (`affection`). */
	id: string
	name: string
	/** `number` · `pool` · `tally` · `label` · `list` · 🚧 `text` (free prose per holder); "" for one an attribute slot shapes. */
	kind: string
	min: string
	max: string
	/** A label's or a list's words, comma-joined. */
	of: string
	start: string
	carriedBy: string[]
	/** `holder` · `gm` · `everyone` · a scope function's id; "" for the default (everyone). */
	visibility: string
	changedBy: string[]
	tags: string
	prose: string
	shownAs: string
	/** An existing attribute slot it is (⏳ a stat); "" for the ruleset's own. */
	slot: string
	borrowed: boolean
	/** 🚧 Every holder carries it: none may turn it off for themselves (RF fix 2, item 3). */
	required: boolean
	original: RulesetAttributeDecl | null
}

/** One function reference: what it uses (`ref`), its key, its bindings and options; a carried module when forked. */
export interface FunctionRow {
	uid: string
	ref: string
	key: string
	bindings: Record<string, string | string[]>
	options: Json
	module: Json | null
	original: FunctionRef | null
	/**
	 * 🚧 The holes a removal emptied (RF fix 2, item 6): a role or an option
	 * that named an entry type, attribute or zone type since removed, with
	 * the name it had — the row says so until it is filled. Never written,
	 * never compared.
	 */
	cleared?: { hole: string; was: string }[]
}

export interface EntryFieldRow {
	uid: string
	key: string
	label: string
	/** The field's type: `string` (a line) · `text` (a paragraph) · `enum` · `integer` · `boolean`. */
	type: string
	/** An enum's words, comma-joined. */
	of: string
	original: FieldDecl | null
}

export interface EntryTypeRow {
	uid: string
	id: string
	name: string
	description: string
	prose: string
	tags: string
	relational: boolean
	/** 🚧 What the other end may be (T1): `person` · `place` · `entry`, or "" (unsaid). */
	farEnd: string
	traits: boolean
	holders: string[]
	visibility: string
	shownAs: string
	fields: EntryFieldRow[]
	/** 🚧 Per field, the lorebook column it reads onto (T2); a field left out reads onto nothing. */
	readsOnto: Record<string, string>
	/** 🚧 Per field, what the model is told (T5): words (on unless said), the number (off unless said). */
	modelShare: Record<string, { words: boolean; number: boolean }>
	original: RulesetEntryTypeDecl | null
}

export interface ZoneTypeRow {
	uid: string
	id: string
	name: string
	prose: string
	owners: string[]
	/** Entry type ids; empty with `holdsAny` for any. */
	holds: string[]
	holdsAny: boolean
	/** `none` · `number` · `attribute`. */
	limitKind: string
	limit: string
	limitAttribute: string
	visibility: string
	ordered: boolean
	shownAs: string
	original: ZoneTypeDecl | null
}

export interface OutcomeRow {
	uid: string
	id: string
	label: string
	/** A five-band step it reads as, or "". */
	five: string
	from: string
	original: RulesetOutcomeDecl | null
}

export interface RestRow {
	uid: string
	id: string
	label: string
	minutes: string
	recharges: string
	original: Json | null
}

export interface TimeForm {
	unit: string
	roundSeconds: string
	perTurn: string
	reaction: boolean
	kinds: string
	rests: RestRow[]
	original: Json | null
}

export interface ChoiceRow {
	uid: string
	key: string
	label: string
}

export interface OptionRow {
	uid: string
	name: string
	label: string
	description: string
	/** A session's owner may set it (`reach: 'owner'`). */
	owner: boolean
	/** An `enum` option's choices; a field of another type keeps `original` and shows read-only. */
	choices: ChoiceRow[]
	default: string
	enumField: boolean
	original: FieldDecl | null
}

export interface OptionsForm {
	fields: OptionRow[]
	/** What a choice lays, presets and conversions: kept as they are (the Document edits them). */
	original: Json | null
}

export interface HandbookRow {
	uid: string
	title: string
	body: string
}

/** 🚧 A playtest scene saved as a test: its name, the scene, How strict and the seed. */
export interface SavedPlaytest {
	name: string
	party: { name: string; stats?: Record<string, unknown>; pieces?: Record<string, string[]> }[]
	situation: string
	change: Json | null
	rigour?: string
	seed?: string
}

export interface PlaytestRow {
	uid: string
	value: SavedPlaytest
}

export interface SectionsForm {
	/** The admin label (the row's), not the document's. */
	label: string
	name: string
	description: string
	voice: Record<VoiceRigour, string>
	attributes: AttributeRow[]
	functions: FunctionRow[]
	entryTypes: EntryTypeRow[]
	zoneTypes: ZoneTypeRow[]
	outcomes: OutcomeRow[]
	time: TimeForm
	library: LibraryForm
	options: OptionsForm
	handbook: HandbookRow[]
	playtests: PlaytestRow[]
}

/** What the dirty check never compares: the rows' own bookkeeping. */
export const SECTIONS_COMPARE: SameFormValueOptions = {
	ignore: [
		"attributes.uid",
		"attributes.original",
		"functions.uid",
		"functions.original",
		"functions.cleared",
		"entryTypes.uid",
		"entryTypes.original",
		"entryTypes.fields.uid",
		"entryTypes.fields.original",
		"zoneTypes.uid",
		"zoneTypes.original",
		"outcomes.uid",
		"outcomes.original",
		"time.rests.uid",
		"time.rests.original",
		"time.original",
		"library.lists.rows.uid",
		"options.fields.uid",
		"options.fields.original",
		"options.fields.choices.uid",
		"options.original",
		"handbook.uid",
		"playtests.uid"
	]
}

/* ── small readers ────────────────────────────────────────────────── */

const str = (v: unknown): string => (typeof v === "string" ? v : "")
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
const joined = (v: unknown): string => list(v).join(", ")
/** A comma list typed into a box: trimmed, empties dropped, each once. */
export const splitWords = (t: string): string[] => [...new Set(t.split(",").map((s) => s.trim()).filter(Boolean))]
const NUMBER = /^\s*-?\d+(\.\d+)?\s*$/
const num = (t: string): number | undefined => (NUMBER.test(t) ? Number(t) : undefined)

/** A slug from a name: `Morning refill` → `morning-refill`. */
export const slugOf = (name: string): string =>
	name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")

/** A slug no other row has: `nerve`, `nerve-2`, …. */
export function freeId(name: string, taken: Iterable<string>, fallback = "item"): string {
	const used = new Set(taken)
	const base = slugOf(name) || fallback
	if (!used.has(base)) return base
	for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`
}

/* ── reading a document into the form ─────────────────────────────── */

function attributeRow(a: RulesetAttributeDecl): AttributeRow {
	return {
		uid: newRowUid(),
		id: str(a.id),
		name: textOf(a.name),
		kind: str(a.kind),
		min: numberText(a.bounds?.min),
		max: numberText(a.bounds?.max),
		of: joined(a.of),
		start: Array.isArray(a.start) ? (a.start as unknown[]).join(", ") : numberText(a.start),
		carriedBy: list(a.carriedBy),
		visibility: str(a.visibility),
		changedBy: list(a.changedBy),
		tags: joined(a.tags),
		prose: str(a.prose),
		shownAs: str(a.shownAs),
		slot: str(a.slot),
		borrowed: a.borrowed === true,
		required: a.required === true,
		original: plain(a)
	}
}

function functionRow(f: FunctionRef): FunctionRow {
	return {
		uid: newRowUid(),
		ref: str(f.ref),
		key: f ? functionRefKey(f) : "",
		bindings: plain({ ...(f.bindings ?? {}) }) as Record<string, string | string[]>,
		options: plain({ ...(f.options ?? {}) }) as Json,
		module: f.module ? (plain(f.module) as unknown as Json) : null,
		original: plain(f)
	}
}

function fieldRow(key: string, f: FieldDecl): EntryFieldRow {
	const type = f.type === "enum" ? "enum" : f.type === "integer" || f.type === "number" ? "integer" : f.type === "boolean" ? "boolean" : f.type === "text" ? "text" : "string"
	const of = f.members?.length ? f.members.map((m) => m.key) : list(f.of)
	return { uid: newRowUid(), key, label: textOf(f.label), type, of: of.join(", "), original: plain(f) }
}

function entryTypeRow(e: RulesetEntryTypeDecl): EntryTypeRow {
	return {
		uid: newRowUid(),
		id: str(e.id),
		name: textOf(e.name),
		description: textOf(e.description),
		prose: str(e.prose),
		tags: joined(e.tags),
		relational: e.relational === true,
		farEnd: str(e.farEnd),
		traits: e.traits === true,
		holders: list(e.holders),
		visibility: str(e.visibility),
		shownAs: str(e.shownAs),
		fields: Object.entries(e.fields ?? {}).map(([k, f]) => fieldRow(k, f as FieldDecl)),
		readsOnto: Object.fromEntries(Object.entries(e.readsOnto ?? {}).map(([k, v]) => [k, String(v)])),
		modelShare: Object.fromEntries(Object.keys(e.fields ?? {}).map((k) => [k, modelShareOf(e.modelShare?.[k])])),
		original: plain(e)
	}
}

function zoneTypeRow(z: ZoneTypeDecl): ZoneTypeRow {
	const limit = z.limit
	return {
		uid: newRowUid(),
		id: str(z.id),
		name: textOf(z.name),
		prose: str(z.prose),
		owners: list(z.owners),
		holds: z.holds === "*" ? [] : list(z.holds),
		holdsAny: z.holds === "*",
		limitKind: typeof limit === "number" ? "number" : isObject(limit) ? "attribute" : "none",
		limit: typeof limit === "number" ? String(limit) : "",
		limitAttribute: isObject(limit) ? str((limit as Json).attribute) : "",
		visibility: str(z.visibility),
		ordered: z.ordered === true,
		shownAs: str(z.shownAs),
		original: plain(z)
	}
}

function outcomeRow(o: RulesetOutcomeDecl): OutcomeRow {
	return { uid: newRowUid(), id: str(o.id), label: textOf(o.label), five: str(o.five), from: numberText(o.from), original: plain(o) }
}

function timeFormOf(t: RulesetSections["time"]): TimeForm {
	const o = (t ?? null) as Json | null
	return {
		unit: str(o?.unit),
		roundSeconds: numberText(o?.roundSeconds),
		perTurn: numberText((o?.turns as Json | undefined)?.perTurn),
		reaction: (o?.turns as Json | undefined)?.reaction === true,
		kinds: joined((o?.turns as Json | undefined)?.kinds),
		rests: (Array.isArray(o?.rests) ? (o!.rests as Json[]) : []).map((r) => ({
			uid: newRowUid(),
			id: str(r.id),
			label: textOf(r.label),
			minutes: numberText(r.minutes),
			recharges: joined(r.recharges),
			original: plain(r)
		})),
		original: o ? plain(o) : null
	}
}

function optionsFormOf(o: RulesetSections["options"]): OptionsForm {
	const fields = Object.entries((o?.fields ?? {}) as Record<string, FieldDecl>).map(([name, f]) => {
		const keys = f.members?.length ? f.members.map((m) => m.key) : list(f.of)
		return {
			uid: newRowUid(),
			name,
			label: textOf(f.label),
			description: textOf(f.description),
			owner: (f as { reach?: unknown }).reach === "owner",
			choices: keys.map((k) => ({ uid: newRowUid(), key: k, label: textOf(f.members?.find((m) => m.key === k)?.label) })),
			default: typeof f.default === "string" ? f.default : "",
			enumField: f.type === "enum",
			original: plain(f)
		}
	})
	return { fields, original: o ? (plain(o) as unknown as Json) : null }
}

/**
 * 🚧 The library adapter: the library field reads a draft in the shape
 * before the sections (`compendium`, `repertoires`), so a ruleset in
 * sections is shown to it as one — its library as the compendium, its entry
 * types as the lists, each with its whole field shape (`entryTypeFields`).
 */
export function libraryView(doc: Json | null): Json {
	const s = rulesetSections(doc ?? {})
	return {
		...(s.library ? { compendium: s.library } : {}),
		repertoires: (s.entryTypes ?? []).map((e) => ({
			id: e.id,
			label: e.name,
			entryable: e.entryable !== false,
			piece: { type: "object", fields: entryTypeFields(e) }
		}))
	}
}

/** The entry types a library row is edited with, as the library field takes them. */
export function libraryEntryTypes(rulesetId: string, doc: Json | null): DerivedEntryTypeShape[] {
	return (rulesetSections(doc ?? {}).entryTypes ?? []).map((e) => ({
		repertoireId: e.id,
		entryTypeId: rulesetEntryTypeId(rulesetId, e.id),
		fields: entryTypeFields(e) as Record<string, FieldDecl>
	}))
}

const handbookOf = (doc: Json | null): HandbookRow[] =>
	(Array.isArray(doc?.handbook) ? (doc!.handbook as Json[]) : [])
		.filter(isObject)
		.map((p) => ({ uid: newRowUid(), title: str(p.title), body: str(p.body) }))

const playtestsOf = (doc: Json | null): PlaytestRow[] =>
	(Array.isArray(doc?.playtests) ? (doc!.playtests as Json[]) : [])
		.filter(isObject)
		.map((p) => ({ uid: newRowUid(), value: plain(p) as unknown as SavedPlaytest }))

/** The form a draft opens with: read through its sections, whichever shape it is written in. */
export function sectionsFormOf(doc: Json | null | undefined, label: string): SectionsForm {
	const d = (doc ?? {}) as Json
	const s = rulesetSections(d)
	const voice = isObject(d.voice) ? (d.voice as Json) : {}
	return {
		label,
		name: textOf(d.name),
		description: textOf(d.description),
		voice: { prose: str(voice.prose), mechanics: str(voice.mechanics), scripts: str(voice.scripts) },
		attributes: (s.attributes ?? []).filter(isObject).map(attributeRow),
		functions: (s.functions ?? []).filter(isObject).map(functionRow),
		entryTypes: (s.entryTypes ?? []).filter(isObject).map(entryTypeRow),
		zoneTypes: (s.zoneTypes ?? []).filter(isObject).map(zoneTypeRow),
		outcomes: (s.outcomes ?? []).filter(isObject).map(outcomeRow),
		time: timeFormOf(s.time),
		library: libraryFormOf(libraryView(d)),
		options: optionsFormOf(s.options),
		handbook: handbookOf(d),
		playtests: playtestsOf(d)
	}
}

/* ── new rows ─────────────────────────────────────────────────────── */

export function newAttribute(form: SectionsForm, name = ""): AttributeRow {
	return {
		uid: newRowUid(),
		id: name ? freeId(name, form.attributes.map((a) => a.id), "attribute") : "",
		name,
		kind: "number",
		min: "",
		max: "",
		of: "",
		start: "",
		carriedBy: [],
		visibility: "",
		changedBy: [],
		tags: "",
		prose: "",
		shownAs: "",
		slot: "",
		borrowed: false,
		required: false,
		original: null
	}
}

export function newEntryType(form: SectionsForm, name = ""): EntryTypeRow {
	return {
		uid: newRowUid(),
		id: name ? freeId(name, form.entryTypes.map((e) => e.id), "entry") : "",
		name,
		description: "",
		prose: "",
		tags: "",
		relational: false,
		farEnd: "",
		traits: false,
		holders: [],
		visibility: "",
		shownAs: "",
		fields: [],
		readsOnto: {},
		modelShare: {},
		original: null
	}
}

export const newEntryField = (): EntryFieldRow => ({ uid: newRowUid(), key: "", label: "", type: "string", of: "", original: null })

export function newZoneType(form: SectionsForm, name = ""): ZoneTypeRow {
	return {
		uid: newRowUid(),
		id: name ? freeId(name, form.zoneTypes.map((z) => z.id), "zone") : "",
		name,
		prose: "",
		owners: ["cast"],
		holds: [],
		holdsAny: true,
		limitKind: "none",
		limit: "",
		limitAttribute: "",
		visibility: "",
		ordered: false,
		shownAs: "",
		original: null
	}
}

export const newOutcome = (form: SectionsForm, label = ""): OutcomeRow => ({
	uid: newRowUid(),
	id: label ? freeId(label, form.outcomes.map((o) => o.id), "outcome") : "",
	label,
	five: "",
	from: "",
	original: null
})

export const newRest = (): RestRow => ({ uid: newRowUid(), id: "", label: "", minutes: "", recharges: "", original: null })

export const newOption = (form: SectionsForm): OptionRow => ({
	uid: newRowUid(),
	name: freeId("option", form.options.fields.map((f) => f.name), "option"),
	label: "",
	description: "",
	owner: false,
	choices: [],
	default: "",
	enumField: true,
	original: null
})

/** A reference to a catalogue function, under a key no other reference has; its options start at their defaults. */
export function newFunctionRow(form: SectionsForm, ref: string, name: string, decl?: { form?: Record<string, FieldDecl> } | null, module?: Json | null): FunctionRow {
	const options: Json = {}
	for (const [k, f] of Object.entries(decl?.form ?? {})) if (f && (f as FieldDecl).default !== undefined) options[k] = plain((f as FieldDecl).default)
	return {
		uid: newRowUid(),
		ref,
		key: freeId(name, form.functions.map((f) => f.key), "function"),
		bindings: {},
		options,
		module: module ?? null,
		original: null
	}
}

/* ── writing the form back ────────────────────────────────────────── */

const bounded = (row: AttributeRow): Json | undefined => {
	const min = num(row.min)
	const max = num(row.max)
	return min === undefined && max === undefined ? undefined : { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) }
}

/** 🚧 The kinds that hold words, not a number: no bounds (a list's most aside). */
export const WORD_KINDS: readonly string[] = ["label", "list", "text"]

function startOf(row: AttributeRow): unknown {
	const t = row.start.trim()
	if (!t) return undefined
	if (row.kind === "list") return splitWords(t)
	if (row.kind === "label" || row.kind === "text" || (!row.kind && !NUMBER.test(t))) return t
	return num(t) ?? t
}

export function writeAttribute(row: AttributeRow): Json {
	if (row.original && unchanged(row, attributeRow(row.original), ["uid", "original"])) return row.original as unknown as Json
	const o: Json = { ...((row.original ?? {}) as Json), id: row.id.trim() }
	setOrDrop(o, "name", withEnglish(row.original?.name, row.name))
	setOrDrop(o, "slot", row.slot.trim() || undefined)
	setOrDrop(o, "borrowed", row.slot.trim() && row.borrowed ? true : undefined)
	setOrDrop(o, "kind", row.kind || undefined)
	setOrDrop(o, "bounds", WORD_KINDS.includes(row.kind) ? undefined : bounded(row))
	setOrDrop(o, "of", (row.kind === "label" || row.kind === "list") && splitWords(row.of).length ? splitWords(row.of) : undefined)
	setOrDrop(o, "start", startOf(row))
	setOrDrop(o, "carriedBy", row.carriedBy.length ? [...row.carriedBy] : undefined)
	setOrDrop(o, "visibility", row.visibility || undefined)
	setOrDrop(o, "changedBy", row.changedBy.length ? [...row.changedBy] : undefined)
	setOrDrop(o, "tags", splitWords(row.tags).length ? splitWords(row.tags) : undefined)
	setOrDrop(o, "prose", row.prose.trim() || undefined)
	setOrDrop(o, "shownAs", row.shownAs || undefined)
	setOrDrop(o, "required", row.required ? true : undefined)
	return o
}

/** A binding as stored: a role filled by one target, or several; an empty one is left out. */
function writeBindings(b: Record<string, string | string[]>): Json | undefined {
	const out: Json = {}
	for (const [role, v] of Object.entries(b)) {
		if (Array.isArray(v)) {
			const vs = v.filter(Boolean)
			if (vs.length) out[role] = vs
		} else if (typeof v === "string" && v) out[role] = v
	}
	return Object.keys(out).length ? out : undefined
}

/** Options as stored: an option cleared (`""`, `null`, `undefined`) is left out. */
function writeOptions(o: Json): Json | undefined {
	const out: Json = {}
	for (const [k, v] of Object.entries(o)) if (v !== "" && v !== null && v !== undefined) out[k] = v
	return Object.keys(out).length ? out : undefined
}

export function writeFunction(row: FunctionRow): Json {
	if (row.original && unchanged(row, functionRow(row.original), ["uid", "original"])) return row.original as unknown as Json
	const o: Json = { ...((row.original ?? {}) as Json), ref: row.ref }
	// The key is said only when it is not the function's own name (`functionRefKey`'s rule).
	const own = functionRefKey({ ref: row.ref })
	setOrDrop(o, "key", row.key.trim() && row.key.trim() !== own ? row.key.trim() : undefined)
	setOrDrop(o, "bindings", writeBindings(row.bindings))
	setOrDrop(o, "options", writeOptions(row.options))
	setOrDrop(o, "module", row.module ? plain(row.module) : undefined)
	// A forked module has a new hash; the pin is the old one's.
	if (row.module && row.original?.module && JSON.stringify(row.module) !== JSON.stringify(row.original.module)) delete o.hash
	return o
}

function writeField(row: EntryFieldRow): [string, FieldDecl] {
	if (row.original && unchanged(row, fieldRow(row.key, row.original), ["uid", "original"])) return [row.key.trim(), row.original]
	const o: Json = { ...((row.original ?? {}) as Json), type: row.type }
	setOrDrop(o, "label", withEnglish(row.original?.label, row.label))
	const of = splitWords(row.of)
	if (row.type === "enum" && of.length) {
		o.of = of
		const was = row.original?.members ?? []
		o.members = of.map((k) => was.find((m) => m.key === k) ?? { key: k, label: { en: k } })
	} else {
		delete o.of
		delete o.members
	}
	return [row.key.trim(), o as unknown as FieldDecl]
}

export function writeEntryType(row: EntryTypeRow): Json {
	if (row.original && unchanged(row, entryTypeRow(row.original), ["uid", "original"])) return row.original as unknown as Json
	const o: Json = { ...((row.original ?? {}) as Json), id: row.id.trim() }
	setOrDrop(o, "name", withEnglish(row.original?.name, row.name) ?? { en: row.id.trim() })
	setOrDrop(o, "description", withEnglish(row.original?.description, row.description))
	o.prose = row.prose.trim()
	setOrDrop(o, "tags", splitWords(row.tags).length ? splitWords(row.tags) : undefined)
	setOrDrop(o, "relational", row.relational ? true : undefined)
	setOrDrop(o, "farEnd", row.relational && row.farEnd ? row.farEnd : undefined)
	setOrDrop(o, "traits", row.traits ? true : undefined)
	setOrDrop(o, "holders", row.holders.length ? [...row.holders] : undefined)
	setOrDrop(o, "visibility", row.visibility || undefined)
	setOrDrop(o, "shownAs", row.shownAs || undefined)
	const fields = row.fields.filter((f) => f.key.trim()).map(writeField)
	setOrDrop(o, "fields", fields.length ? Object.fromEntries(fields) : undefined)
	// 🚧 T2/T5: only what a field says — a column it reads onto, a share that is not the default.
	const keys = new Set(fields.map(([k]) => k))
	const onto = Object.entries(row.readsOnto).filter(([k, v]) => keys.has(k) && v)
	setOrDrop(o, "readsOnto", onto.length ? Object.fromEntries(onto) : undefined)
	const shares = Object.entries(row.modelShare)
		.filter(([k]) => keys.has(k))
		.map(([k, v]) => [k, { ...(v.words ? {} : { words: false }), ...(v.number ? { number: true } : {}) }] as const)
		.filter(([, v]) => Object.keys(v).length)
	setOrDrop(o, "modelShare", shares.length ? Object.fromEntries(shares) : undefined)
	return o
}

export function writeZoneType(row: ZoneTypeRow): Json {
	if (row.original && unchanged(row, zoneTypeRow(row.original), ["uid", "original"])) return row.original as unknown as Json
	const o: Json = { ...((row.original ?? {}) as Json), id: row.id.trim() }
	setOrDrop(o, "name", withEnglish(row.original?.name, row.name) ?? { en: row.id.trim() })
	o.owners = row.owners.length ? [...row.owners] : ["cast"]
	// 🚧 RF fix 2, item 6: a zone type whose entry types were all removed
	// holds nothing (`[]`, refused until one is picked) — never "anything".
	o.holds = row.holdsAny ? "*" : [...row.holds]
	setOrDrop(
		o,
		"limit",
		row.limitKind === "number" && num(row.limit) !== undefined
			? num(row.limit)
			: row.limitKind === "attribute" && row.limitAttribute
				? { attribute: row.limitAttribute }
				: undefined
	)
	setOrDrop(o, "visibility", row.visibility || undefined)
	setOrDrop(o, "ordered", row.ordered ? true : undefined)
	o.prose = row.prose.trim()
	setOrDrop(o, "shownAs", row.shownAs || undefined)
	return o
}

export function writeOutcome(row: OutcomeRow): Json {
	if (row.original && unchanged(row, outcomeRow(row.original), ["uid", "original"])) return row.original as unknown as Json
	const o: Json = { ...((row.original ?? {}) as Json), id: row.id.trim() || slugOf(row.label) }
	setOrDrop(o, "label", withEnglish(row.original?.label, row.label) ?? { en: row.id.trim() })
	setOrDrop(o, "five", (FIVE_BANDS as readonly string[]).includes(row.five) ? row.five : undefined)
	setOrDrop(o, "from", num(row.from))
	return o
}

function writeTime(t: TimeForm): Json | undefined {
	if (t.original && unchanged(t, timeFormOf(t.original as never), ["uid", "original", "rests.uid", "rests.original"])) return t.original
	const o: Json = { ...(t.original ?? {}) }
	setOrDrop(o, "unit", t.unit || undefined)
	setOrDrop(o, "roundSeconds", num(t.roundSeconds))
	const turns: Json = { ...((isObject(o.turns) ? o.turns : {}) as Json) }
	setOrDrop(turns, "perTurn", num(t.perTurn))
	setOrDrop(turns, "reaction", t.reaction ? true : undefined)
	setOrDrop(turns, "kinds", splitWords(t.kinds).length ? splitWords(t.kinds) : undefined)
	setOrDrop(o, "turns", Object.keys(turns).length ? turns : undefined)
	const rests = t.rests
		.filter((r) => r.label.trim() || r.id.trim())
		.map((r) => {
			const was = (r.original ?? {}) as Json
			const out: Json = { ...was, id: r.id.trim() || slugOf(r.label) }
			setOrDrop(out, "label", withEnglish(was.label, r.label) ?? { en: out.id as string })
			setOrDrop(out, "minutes", num(r.minutes))
			setOrDrop(out, "recharges", splitWords(r.recharges).length ? splitWords(r.recharges) : undefined)
			return out
		})
	setOrDrop(o, "rests", rests.length ? rests : undefined)
	return Object.keys(o).length ? o : undefined
}

function writeOptions_(f: OptionsForm): Json | undefined {
	const o: Json = { ...(f.original ?? {}) }
	const fields: Json = {}
	for (const row of f.fields) {
		const name = row.name.trim()
		if (!name) continue
		if (!row.enumField) {
			fields[name] = row.original
			continue
		}
		const was = (row.original ?? {}) as Json
		const field: Json = { ...was, type: "enum" }
		setOrDrop(field, "label", withEnglish(was.label, row.label) ?? { en: name })
		setOrDrop(field, "description", withEnglish(was.description, row.description))
		setOrDrop(field, "reach", row.owner ? "owner" : was.reach === "owner" ? undefined : was.reach)
		const choices = row.choices.filter((c) => c.key.trim())
		field.of = choices.map((c) => c.key.trim())
		const members = Array.isArray(was.members) ? (was.members as Json[]) : []
		field.members = choices.map((c) => {
			const m = members.find((x) => x.key === c.key.trim())
			return { ...(m ?? {}), key: c.key.trim(), label: withEnglish(m?.label, c.label) ?? { en: c.key.trim() } }
		})
		setOrDrop(field, "default", choices.some((c) => c.key.trim() === row.default) ? row.default : choices[0]?.key.trim())
		fields[name] = field
	}
	setOrDrop(o, "fields", Object.keys(fields).length ? fields : undefined)
	return Object.keys(o).length ? o : undefined
}

/**
 * 🚧 The form over the saved draft: what is said at the top level kept (the
 * shapes before the sections left behind), its name, description and voice,
 * each section that holds anything, the library, the handbook pages and the
 * saved tests. A section with nothing in it is left out (R9).
 */
export function sectionsDocument(saved: Json, form: SectionsForm): Json {
	const out: Json = { ...saved }
	for (const k of LEGACY_KEYS) delete out[k]
	for (const k of SECTION_KEYS) delete out[k]
	setOrDrop(out, "name", withEnglish(saved.name, form.name) ?? withEnglish(undefined, form.label))
	setOrDrop(out, "description", withEnglish(saved.description, form.description))
	const voice: Json = {}
	for (const r of VOICE_RIGOURS) if (form.voice[r].trim()) voice[r] = form.voice[r].trim()
	setOrDrop(out, "voice", Object.keys(voice).length ? voice : undefined)
	// 🚧 RF fix 2, item 1: a row added and never typed into is not written (nor run, nor judged).
	const attributes = form.attributes.filter((a) => !blankAttribute(a)).map(writeAttribute)
	const functions = form.functions.map(writeFunction)
	const entryTypes = form.entryTypes.filter((e) => !blankEntryType(e)).map(writeEntryType)
	const zoneTypes = form.zoneTypes.filter((z) => !blankZoneType(z)).map(writeZoneType)
	const outcomes = form.outcomes.filter((o) => o.label.trim() || o.id.trim()).map(writeOutcome)
	if (attributes.length) out.attributes = attributes
	if (functions.length) out.functions = functions
	if (entryTypes.length) out.entryTypes = entryTypes
	if (zoneTypes.length) out.zoneTypes = zoneTypes
	if (outcomes.length) out.outcomes = outcomes
	setOrDrop(out, "time", writeTime(form.time))
	// The library field writes `compendium` over the view it was shown; the sections call it the library.
	const view = libraryView(saved)
	const lib: Json = {}
	applyLibrary(lib, view, form.library)
	setOrDrop(out, "library", lib.compendium)
	setOrDrop(out, "options", writeOptions_(form.options))
	const pages = form.handbook.filter((p) => p.title.trim() || p.body.trim()).map((p) => ({ title: p.title.trim(), body: p.body }))
	setOrDrop(out, "handbook", pages.length ? pages : undefined)
	setOrDrop(out, "playtests", form.playtests.length ? form.playtests.map((p) => plain(p.value)) : undefined)
	return out
}

/* ── 🚧 a row still blank (RF fix 2, item 1) ────────────────────────── */

/**
 * A row added and never typed into: no name, no id, no sentence, nothing
 * of its own. It is not written, so it is never run nor judged — the preview
 * and a Save leave it out, and it says nothing until the author types.
 */
export const blankAttribute = (a: AttributeRow): boolean => !a.original && !a.name.trim() && !a.id.trim() && !a.prose.trim() && !a.slot
export const blankEntryType = (e: EntryTypeRow): boolean =>
	!e.original && !e.name.trim() && !e.id.trim() && !e.prose.trim() && !e.fields.some((f) => f.key.trim())
export const blankZoneType = (z: ZoneTypeRow): boolean => !z.original && !z.name.trim() && !z.id.trim() && !z.prose.trim()

/**
 * The id a new row takes from its name (as New ruleset takes the ruleset's
 * from its label): the name slugged, kept clear of the other rows' ids, until
 * the author types an id of their own. A row read from the draft keeps its id.
 */
export function idFromName<R extends { uid: string; id: string; name: string; original: unknown }>(row: R, rows: readonly R[], name: string, fallback: string): string {
	const others = rows.filter((r) => r.uid !== row.uid).map((r) => r.id)
	const auto = !row.original && (!row.id || row.id === freeId(row.name, others, fallback) || row.id === slugOf(row.name))
	if (!auto) return row.id
	return name.trim() ? freeId(name, others, fallback) : ""
}

/* ── 🚧 removing something says so everywhere it was named (RF fix 2, item 6) ── */

/** How many library rows an entry type has (its id as saved, or as typed). */
export function libraryRowsOf(form: SectionsForm, e: EntryTypeRow): number {
	const ids = new Set([e.id, e.original?.id].filter(Boolean))
	return form.library.lists.filter((l) => ids.has(l.repertoireId)).reduce((n, l) => n + l.rows.length, 0)
}

/**
 * Empty every function hole — a role's binding, an option's value — that
 * names what `names` matches, and say on the row what it named. A role
 * filled by several keeps the rest. 🚧 `holes` keeps it to roles or to
 * options alone (RF fix 6: a function's key is named by options, its id by roles).
 */
function clearReferences(
	form: SectionsForm,
	names: (v: string) => boolean,
	wasOf: (v: string) => string,
	holes: { roles?: boolean; options?: boolean } = { roles: true, options: true }
): void {
	for (const f of form.functions) {
		const cleared: { hole: string; was: string }[] = []
		const bindings = { ...f.bindings }
		if (holes.roles) for (const [role, v] of Object.entries(bindings)) {
			if (Array.isArray(v)) {
				const gone = v.filter((x) => names(x))
				if (!gone.length) continue
				const kept = v.filter((x) => !names(x))
				if (kept.length) bindings[role] = kept
				else delete bindings[role]
				cleared.push({ hole: role, was: gone.map(wasOf).join(", ") })
			} else if (typeof v === "string" && names(v)) {
				delete bindings[role]
				cleared.push({ hole: role, was: wasOf(v) })
			}
		}
		const options = { ...f.options }
		if (holes.options) for (const [k, v] of Object.entries(options))
			if (typeof v === "string" && names(v)) {
				delete options[k]
				cleared.push({ hole: k, was: wasOf(v) })
			}
		if (!cleared.length) continue
		f.bindings = bindings
		f.options = options
		f.cleared = [...(f.cleared ?? []).filter((c) => !cleared.some((x) => x.hole === c.hole)), ...cleared]
	}
}

/**
 * Remove an entry type and what named it: zone types stop holding it (one
 * left holding nothing says so), the functions bound to it or to one of its
 * fields lose that binding and show the hole, and — when `rows` — its
 * library rows go too. Without `rows` they stay, and Check and publish says
 * they belong to no entry type.
 */
export function removeEntryType(form: SectionsForm, uid: string, opts: { rows: boolean }): void {
	const e = form.entryTypes.find((x) => x.uid === uid)
	if (!e) return
	const ids = new Set([e.id.trim(), e.original?.id].filter((x): x is string => !!x))
	form.entryTypes = form.entryTypes.filter((x) => x.uid !== uid)
	if (!ids.size) return
	for (const z of form.zoneTypes) if (!z.holdsAny && z.holds.some((h) => ids.has(h))) z.holds = z.holds.filter((h) => !ids.has(h))
	// Its list goes: with its rows when asked, and always when it has none.
	form.library.lists = form.library.lists.filter((l) => !ids.has(l.repertoireId) || (!opts.rows && l.rows.length > 0))
	// A field of it reads as the field on it: "Affection on a bond".
	const name = e.name.trim() || e.id
	const fieldOf = (v: string) => {
		const key = v.slice(v.indexOf(".") + 1)
		const f = e.fields.find((x) => x.key.trim() === key)
		return `${f?.label.trim() || key} on a ${name.toLowerCase()}`
	}
	clearReferences(form, (v) => ids.has(v) || [...ids].some((id) => v.startsWith(`${id}.`)), (v) => (ids.has(v) ? name : fieldOf(v)))
}

/** Remove an attribute and what named it: functions' bindings and options, a zone type's limit. */
export function removeAttribute(form: SectionsForm, uid: string): void {
	const a = form.attributes.find((x) => x.uid === uid)
	if (!a) return
	const ids = new Set([a.id.trim(), a.original?.id].filter((x): x is string => !!x))
	form.attributes = form.attributes.filter((x) => x.uid !== uid)
	if (!ids.size) return
	for (const z of form.zoneTypes)
		if (z.limitKind === "attribute" && ids.has(z.limitAttribute)) {
			z.limitKind = "none"
			z.limitAttribute = ""
		}
	clearReferences(form, (v) => ids.has(v), () => a.name.trim() || a.id)
}

/**
 * Remove a zone type and what named it: functions' bindings and options.
 * The entry types it held live in the host's carried list again, unless
 * another zone type holds them.
 */
export function removeZoneType(form: SectionsForm, uid: string): void {
	const z = form.zoneTypes.find((x) => x.uid === uid)
	if (!z) return
	const ids = new Set([z.id.trim(), z.original?.id].filter((x): x is string => !!x))
	form.zoneTypes = form.zoneTypes.filter((x) => x.uid !== uid)
	if (!ids.size) return
	clearReferences(form, (v) => ids.has(v), () => z.name.trim() || z.id)
}

/** 🚧 What removing a function moved (RF fix 6): the row, and the way a moment is decided when it names none, before and after. */
export interface FunctionRemoval {
	removed: FunctionRow | null
	/** It was the first way to decide — the one a moment uses when it names none. */
	wasDefault: boolean
	/** The way to decide that is first now; null when none is left. */
	nowDefault: FunctionRow | null
	/** Saved tests whose change used it, by name: their change is emptied. */
	tests: string[]
}

/**
 * 🚧 Remove a function and what named it (RF fix 6, 2026-10-23): another
 * function's option that named its key (a check's way, an outcome move's
 * check) is emptied, and that row shows the hole; a role that named a
 * module only this ruleset carried (its own scope) is emptied the same way;
 * a saved test whose change used it keeps its party and loses the change.
 * The way a moment is decided when it names none is the first way listed
 * (`isWay`): removing it hands that to the next way, or to none.
 */
export function removeFunction(
	form: SectionsForm,
	uid: string,
	opts: { isWay?: (row: FunctionRow) => boolean; name?: string } = {}
): FunctionRemoval {
	const isWay = opts.isWay ?? (() => false)
	const row = form.functions.find((f) => f.uid === uid) ?? null
	if (!row) return { removed: null, wasDefault: false, nowDefault: null, tests: [] }
	const before = form.functions.find(isWay) ?? null
	form.functions = form.functions.filter((f) => f.uid !== uid)
	const key = row.key.trim()
	const name = opts.name?.trim() || key
	if (key) clearReferences(form, (v) => v === key, () => name, { options: true })
	if (row.module && row.ref) clearReferences(form, (v) => v === row.ref, () => name, { roles: true })
	const tests: string[] = []
	if (key)
		for (const t of form.playtests) {
			const change = (t.value as { change?: { check?: unknown } | null }).change
			if (change && change.check === key) {
				t.value = { ...t.value, change: null } as typeof t.value
				tests.push(String((t.value as { name?: unknown }).name ?? ""))
			}
		}
	const after = form.functions.find(isWay) ?? null
	return { removed: row, wasDefault: !!before && before.uid === uid, nowDefault: after, tests }
}

/** 🚧 Where an entry type's entries sit: the zone types that hold it by name, else every one that holds anything. */
export function zonesHolding(form: SectionsForm, e: EntryTypeRow): ZoneTypeRow[] {
	const named = form.zoneTypes.filter((z) => !z.holdsAny && z.holds.includes(e.id))
	return named.length ? named : form.zoneTypes.filter((z) => z.holdsAny)
}

/* ── 🚧 the saved draft's findings, on the rows they are about (RF fix 2, items 1, 8) ── */

const ROW_SECTIONS = ["attributes", "functions", "entryTypes", "zoneTypes", "outcomes"] as const
export type RowSection = (typeof ROW_SECTIONS)[number]

/** One finding as a row shows it: its reason, and the sentence without the path to the row. */
export interface RowFinding {
	reason: string | null
	sentence: string
}

export interface FindingsByRow {
	/** By row uid. */
	rows: Record<string, RowFinding[]>
	/** A section's own (the library's, time's, options', a list of the entry types), by section key. */
	sections: Record<string, RowFinding[]>
	/** What no row or section owns (the document's version, its name). */
	rest: RowFinding[]
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * The rows as a Save writes them, in its order: a blank row is never
 * written (`sectionsDocument`), so a finding's index counts the others.
 */
const writtenRows = (form: SectionsForm): Record<RowSection, { uid: string }[]> => ({
	attributes: form.attributes.filter((a) => !blankAttribute(a)),
	functions: form.functions,
	entryTypes: form.entryTypes.filter((e) => !blankEntryType(e)),
	zoneTypes: form.zoneTypes.filter((z) => !blankZoneType(z)),
	outcomes: form.outcomes.filter((o) => o.label.trim() || o.id.trim())
})

/**
 * The saved draft's findings put where they belong: `‹id›.entryTypes[2]…`
 * on the third entry type row, `‹id›.library…` on the library, `‹id›.time…`
 * on Outcomes and time. `form` must be the form the findings were judged
 * from: the one read from that draft, or 🚧 (RF fix 6) the one whose draft
 * was judged as it stands — its rows counted as a Save writes them.
 */
export function findingsByRow(form: SectionsForm, findings: readonly string[], rulesetId: string): FindingsByRow {
	const out: FindingsByRow = { rows: {}, sections: {}, rest: [] }
	const written = writtenRows(form)
	const head = new RegExp(`^${escapeRe(rulesetId)}\\.(${ROW_SECTIONS.join("|")})\\[(\\d+)\\]`)
	const sectionHead = new RegExp(`^${escapeRe(rulesetId)}\\.(library|time|options|entryTypes|attributes|zoneTypes|functions|outcomes)\\b`)
	const tidy = (t: string) => {
		const s = t.replace(/^[.:]\s*/, "").trim()
		return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
	}
	for (const f of findings) {
		const m = /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(f)
		const reason = m ? m[1]! : null
		const sentence = m ? m[2]! : f
		const row = head.exec(sentence)
		if (row) {
			const target = written[row[1] as RowSection][Number(row[2])]
			if (target) {
				;(out.rows[target.uid] ??= []).push({ reason, sentence: tidy(sentence.slice(row[0].length)) })
				continue
			}
		}
		const sec = sectionHead.exec(sentence)
		if (sec) {
			const key = sec[1] === "time" ? "outcomes" : sec[1]!
			;(out.sections[key] ??= []).push({ reason, sentence: tidy(sentence.slice(sec[0].length)) || sentence })
			continue
		}
		out.rest.push({ reason, sentence })
	}
	return out
}

/** Whether the forms say anything other than the saved draft read back (the label is the row's, never the document's). */
export function formChangesDocument(form: SectionsForm, base: SectionsForm): boolean {
	return !unchanged(form, base, [...(SECTIONS_COMPARE.ignore ?? []), "label"])
}

/** What a form could not write faithfully, in sentences: the Save stops on these. */
export function formProblems(form: SectionsForm): string[] {
	const out: string[] = []
	const twice = (ids: string[], what: string) => {
		const seen = new Set<string>()
		for (const id of ids.filter(Boolean)) {
			if (seen.has(id)) out.push(`Two ${what} are called '${id}'. Give one another name.`)
			seen.add(id)
		}
	}
	for (const a of form.attributes) if (!a.id.trim()) out.push(`An attribute${a.name.trim() ? ` (${a.name.trim()})` : ""} has no id yet.`)
	twice(form.attributes.map((a) => a.id.trim()), "attributes")
	twice(form.functions.map((f) => f.key.trim()), "functions")
	twice(form.entryTypes.map((e) => e.id.trim()), "entry types")
	twice(form.zoneTypes.map((z) => z.id.trim()), "zone types")
	for (const e of form.entryTypes) if (!e.id.trim()) out.push(`An entry type${e.name.trim() ? ` (${e.name.trim()})` : ""} has no id yet.`)
	for (const z of form.zoneTypes) if (!z.id.trim()) out.push(`A zone type${z.name.trim() ? ` (${z.name.trim()})` : ""} has no id yet.`)
	return out
}

export type SavePlan = { ok: true; document: Json; documentWon: boolean } | { ok: false; error: string }

/** The one document a Save sends (the merge rule in the module note). */
export function documentToSave(input: {
	saved: Json
	form: SectionsForm
	formsChanged: boolean
	documentText: string
	documentChanged: boolean
}): SavePlan {
	if (input.documentChanged) {
		const parsed = parseDocumentText(input.documentText)
		if (!parsed.ok) return { ok: false, error: `The Document is not valid JSON (${parsed.error}). Fix it, or put the saved text back.` }
		return { ok: true, document: parsed.value, documentWon: input.formsChanged }
	}
	return { ok: true, document: input.formsChanged ? sectionsDocument(input.saved, input.form) : input.saved, documentWon: false }
}
