/**
 * 🚧 Admin › Rulesets › one ruleset: the editor's words (PLAN-rulesets-
 * functions D8, lane A4, 2026-10-23) — an attribute's kind, owners, who sees
 * it and who changes it in a phrase; a function's sentence split into words
 * and holes; what it reads as; the rail's counts and its _Playable now_ note;
 * _Next, if you want it_; and the handbook's generated pages.
 *
 * NOMENCLATURE §28: the interface never says rigour, repertoire, piece,
 * compendium or mechanics; _How strict_, an entry type by its name, _the
 * ‹name› library_, _the rules_.
 *
 * Pure.
 */
import { FIVE_BANDS, i18nText, type FieldDecl } from "@serene-pub/sdk"
import type { AttributeRow, EntryTypeRow, FunctionRow, OptionRow, OutcomeRow, SectionsForm, TimeForm, ZoneTypeRow } from "./rulesetSectionsForm"
import { splitWords } from "./rulesetSectionsForm"

type FunctionChoice = Sockets.Rulesets.DetailRow["functionChoices"][number]
type SlotChoice = Sockets.Rulesets.DetailRow["slotChoices"][number]

/* ── attributes ───────────────────────────────────────────────────── */

export const ATTRIBUTE_KIND_OPTIONS = [
	{ value: "number", label: "A number", hint: "A whole number, bounded or not" },
	{ value: "pool", label: "A pool", hint: "Spent and refilled, from its floor to its most" },
	{ value: "tally", label: "A tally", hint: "A count from nothing up" },
	{ value: "label", label: "Words", hint: "One of its words" },
	{ value: "list", label: "A list of words", hint: "Several words" },
	{ value: "text", label: "Free text", hint: "A few sentences of each holder's own, read as a sentence" }
] as const

/** What an entry type's field holds, as the entry type card offers it — and as a function's role names what it takes (RF fix 6). */
export const ENTRY_FIELD_TYPE_OPTIONS = [
	{ value: "string", label: "A line of text" },
	{ value: "text", label: "A paragraph" },
	{ value: "enum", label: "One of some words" },
	{ value: "integer", label: "A number" },
	{ value: "boolean", label: "Yes or no" }
] as const

/** A field type in the words above, lowercased; a `number` field reads as an `integer` one. */
const fieldTypeWords = (t: string): string =>
	(ENTRY_FIELD_TYPE_OPTIONS.find((o) => o.value === (t === "number" ? "integer" : t))?.label ?? t).toLowerCase()

const joinOr = (xs: readonly string[]): string => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`)
const joinAnd = (xs: readonly string[]): string => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`)

/**
 * 🚧 Why a function's role offers what it offers (RF fix 6, 2026-10-23;
 * pickers explain why): what it takes, and the attributes and entry fields
 * it leaves out by name — _The number takes a number, a pool or a tally,
 * so Mood is not offered._ Nothing to say when nothing is left out and
 * something is offered.
 */
export function pickNote(input: {
	role: string
	/** What the role takes, in words (`attributeKindsInWords`). */
	takes: string
	/** The entry field types it takes too; empty when no entry's field may fill it. */
	fieldTypes: readonly string[]
	leftOut: readonly string[]
	offered: number
}): string | undefined {
	const fields = [...new Set(input.fieldTypes.map(fieldTypeWords))]
	const takes = `${input.role} takes ${input.takes}${fields.length ? `, or an entry's field that is ${joinOr(fields)}` : ""}`
	if (input.leftOut.length) return `${takes}, so ${joinAnd(input.leftOut)} ${input.leftOut.length === 1 ? "is" : "are"} not offered.`
	if (!input.offered) return `${takes}. None of yours is yet: add one under Attributes${fields.length ? " or Entry types" : ""}.`
	return undefined
}

export const OWNER_OPTIONS = [
	{ value: "cast", label: "Each character" },
	{ value: "world", label: "The world" },
	{ value: "location", label: "Each place" }
] as const

export const CHANGER_OPTIONS = [
	{ value: "rules", label: "The rules" },
	{ value: "gm", label: "The game master" },
	{ value: "holder", label: "The holder" },
	{ value: "everyone", label: "Anyone" }
] as const

/** Who sees it: the three words, then the scope functions a ruleset may name. */
export const VISIBILITY_WORDS = [
	{ value: "", label: "Everyone", hint: "The default" },
	{ value: "holder", label: "The holder", hint: "They may show it to others" },
	{ value: "gm", label: "The game master" },
	{ value: "everyone", label: "Everyone" }
] as const

export const SHOWN_AS_OPTIONS = [
	{ value: "", label: "As the widget likes" },
	{ value: "bar", label: "A bar" },
	{ value: "pips", label: "Pips" },
	{ value: "badge", label: "A badge" },
	{ value: "count", label: "A count" },
	{ value: "words", label: "Words" },
	{ value: "list", label: "A list" },
	{ value: "fan", label: "A fan of cards" },
	{ value: "ties", label: "A list of ties" }
] as const

const OWNER_WORD: Record<string, string> = { cast: "each character", world: "the world", location: "each place" }
const CHANGER_WORD: Record<string, string> = { rules: "the rules", gm: "the game master", holder: "the holder", everyone: "anyone" }

const sentenceCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
/** "a, b and c". */
export const listed = (words: readonly string[]): string =>
	words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
const orListed = (words: readonly string[]): string =>
	words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`

/** What an attribute holds, in a phrase: _A number, 0 to 10_ · _A pool, 0 to 3, starts at 3_ · _Words: shy · warm_. */
export function kindWords(a: AttributeRow, slot?: SlotChoice | null): string {
	if (!a.kind && a.slot) return slot ? `Shaped by ${slot.label}` : "Shaped by its attribute slot"
	const range = a.min.trim() && a.max.trim() ? `${a.min.trim()} to ${a.max.trim()}` : a.max.trim() ? `up to ${a.max.trim()}` : a.min.trim() ? `from ${a.min.trim()}` : ""
	const start = a.start.trim() ? `starts at ${a.start.trim()}` : ""
	switch (a.kind) {
		case "label":
		case "list": {
			const words = splitWords(a.of)
			const head = a.kind === "label" ? "Words" : "A list of words"
			return words.length ? `${head}: ${words.join(" · ")}` : `${head}, any`
		}
		case "text":
			return "Free text"
		case "pool":
			return ["A pool", range, start].filter(Boolean).join(", ")
		case "tally":
			return ["A tally", start].filter(Boolean).join(", ")
		default:
			return ["A number", range, start].filter(Boolean).join(", ")
	}
}

/** _Each character_ (the default) · _Each character, each place_. */
export const carriedWords = (owners: readonly string[]): string =>
	sentenceCase((owners.length ? owners : ["cast"]).map((o) => OWNER_WORD[o] ?? o).join(", "))

/** Who sees it, by its word or its scope function's name. */
export function visibilityWords(v: string, scopes: readonly { value: string; label: string }[] = []): string {
	const w = VISIBILITY_WORDS.find((x) => x.value === v)
	if (w) return v === "holder" ? "The holder · may show it" : w.label
	return scopes.find((s) => s.value === v)?.label ?? v
}

/** _the rules or the game master_ · _anyone_ (nobody said: anyone). */
export const changedByWords = (who: readonly string[]): string => (who.length ? orListed(who.map((w) => CHANGER_WORD[w] ?? w)) : "anyone")

export const shownAsWords = (v: string): string => SHOWN_AS_OPTIONS.find((o) => o.value === v)?.label ?? v

/** An attribute's display name: its own, else its slot's, else its id. */
export const attributeName = (a: AttributeRow, slots: readonly SlotChoice[] = []): string =>
	a.name.trim() || (a.slot ? slots.find((s) => s.id === a.slot)?.label : "") || a.id || "New attribute"

/* ── functions ────────────────────────────────────────────────────── */

/** A function kind's chip on its row and its group in the catalogue, in the catalogue's order. */
export const FUNCTION_KINDS: readonly { kind: string; label: string; group: string }[] = [
	{ kind: "value", label: "A value", group: "Values" },
	{ kind: "deciding", label: "A way to decide", group: "Deciding" },
	{ kind: "changing", label: "Changes values", group: "Changing" },
	{ kind: "asking", label: "Asks someone", group: "Asking" },
	{ kind: "pieces", label: "Entries", group: "Entries and zones" },
	{ kind: "zones", label: "Zones", group: "Entries and zones" },
	{ kind: "scope", label: "Who's in reach", group: "Who's in reach" },
	{ kind: "time", label: "Time and order", group: "Time and order" },
	{ kind: "progression", label: "Progression", group: "Progression" }
]

export const functionKindLabel = (kind: string): string =>
	FUNCTION_KINDS.find((k) => k.kind === kind)?.label ?? (kind.includes(":") ? "A package's own" : kind || "A function")

/** The catalogue's groups in order: core kinds, then packages' own kinds, then other rulesets. */
export function catalogueGroups(choices: readonly FunctionChoice[]): { group: string; choices: FunctionChoice[] }[] {
	const order = [...new Set(FUNCTION_KINDS.map((k) => k.group))]
	const out = new Map<string, FunctionChoice[]>(order.map((g) => [g, []]))
	const other: FunctionChoice[] = []
	const mine: FunctionChoice[] = []
	for (const c of choices) {
		if (c.from === "ruleset") mine.push(c)
		else {
			const g = FUNCTION_KINDS.find((k) => k.kind === c.kind)?.group
			if (g) out.get(g)!.push(c)
			else other.push(c)
		}
	}
	return [
		...[...out].map(([group, cs]) => ({ group, choices: cs })),
		{ group: "From packages", choices: other },
		{ group: "From your other rulesets", choices: mine }
	].filter((g) => g.choices.length)
}

/** The header a row reads: its catalogue choice's, else its own carried module's. */
export function rowDecl(row: FunctionRow, choices: readonly FunctionChoice[]): (FunctionChoice["decl"] & Record<string, unknown>) | null {
	if (row.module) return row.module as never
	return (choices.find((c) => c.id === row.ref)?.decl as never) ?? null
}

export type SentencePart = { text: string } | { hole: string; as: "binding" | "option" | "unknown" }

/**
 * A function's sentence in parts: its prose (else its meaning) cut at each
 * `{{hole}}`, each hole a binding (a role its header declares), an option
 * (a field of its form) or, unknown, a word as written.
 */
export function sentenceParts(decl: { prose?: string; meaning?: unknown; bindings?: Record<string, unknown>; form?: Record<string, unknown> } | null): SentencePart[] {
	const prose = decl?.prose?.trim() || i18nText(decl?.meaning as never) || ""
	const out: SentencePart[] = []
	const re = /\{\{\s*([\w.-]+)\s*\}\}/g
	let at = 0
	for (let m = re.exec(prose); m; m = re.exec(prose)) {
		if (m.index > at) out.push({ text: prose.slice(at, m.index) })
		const hole = m[1]!
		out.push({ hole, as: decl?.bindings && hole in decl.bindings ? "binding" : decl?.form && hole in decl.form ? "option" : "unknown" })
		at = m.index + m[0].length
	}
	if (at < prose.length) out.push({ text: prose.slice(at) })
	return out
}

/** An option's value as a sentence reads it. */
export function optionWords(v: unknown, field?: FieldDecl | null): string {
	if (v === undefined || v === null || v === "") return ""
	if (field?.type === "enum") {
		const m = field.members?.find((x) => x.key === v)
		if (m) return i18nText(m.label) ?? String(v)
	}
	if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? (i18nText((x as { label?: never }).label) ?? JSON.stringify(x)) : String(x))).join(", ")
	if (typeof v === "object") return i18nText(v as never) ?? JSON.stringify(v)
	if (typeof v === "boolean") return v ? "yes" : "no"
	return String(v)
}

/** What a reference reads as: its sentence with every hole filled by its binding's names or its option. */
export function readsAs(row: FunctionRow, decl: ReturnType<typeof rowDecl>, nameOf: (id: string) => string): string {
	const parts = sentenceParts(decl)
	if (!parts.length) return ""
	const text = parts
		.map((p) => {
			if ("text" in p) return p.text
			const b = row.bindings[p.hole]
			if (b !== undefined && (Array.isArray(b) ? b.length : b)) return (Array.isArray(b) ? b : [b]).map(nameOf).join(", ")
			const o = row.options[p.hole]
			const w = optionWords(o, (decl?.form as Record<string, FieldDecl> | undefined)?.[p.hole])
			return w || `[${p.hole}]`
		})
		.join("")
		.trim()
	return /[.!?…]$/.test(text) ? text : `${text}.`
}

/** How many lines a body has; null when there is none (a header-only function). */
export function bodyLines(decl: { body?: unknown; seedKey?: unknown } | null): number | null {
	if (typeof decl?.body === "string" && decl.body.trim()) return decl.body.trim().split("\n").length
	return null
}

/* ── the rail ─────────────────────────────────────────────────────── */

export type ViewId = "attributes" | "functions" | "entryTypes" | "zoneTypes" | "outcomes" | "library" | "options" | "document" | "playtest" | "publish"

export const SECTION_VIEWS: readonly { id: ViewId; label: string; purpose: string }[] = [
	{ id: "attributes", label: "Attributes", purpose: "What characters, the world and places carry. Say what each one means; the model reads your sentence." },
	{ id: "functions", label: "Functions", purpose: "What happens, when, and how things are decided. Each one is a sentence you can read." },
	{ id: "entryTypes", label: "Entry types", purpose: "Kinds of thing people hold, suffer or share. Each kind is a lorebook entry type; its rows are the library." },
	{ id: "zoneTypes", label: "Zone types", purpose: "Where entries sit. Declared once; every owner that may carry one gets its own. Who sees a thing is decided by the zone it's in." },
	{ id: "outcomes", label: "Outcomes and time", purpose: "How things can turn out, in your own words, and how time is kept. Left empty, the host's defaults hold." },
	{ id: "library", label: "Library", purpose: "Ready-made rows for your entry types, each with where it comes from." },
	{ id: "options", label: "Options", purpose: "The ways a table may play these rules: choices a session's owner can make." }
]

export const viewLabel = (id: ViewId): string =>
	SECTION_VIEWS.find((v) => v.id === id)?.label ?? (id === "document" ? "Document" : id === "playtest" ? "Playtest a scene" : "Check and publish")

/** Each section's count as the rail shows it: a number, or _defaults_ where the host's hold. */
export function railCounts(form: SectionsForm): Record<string, string> {
	const rows = form.library.lists.reduce((n, l) => n + l.rows.length, 0)
	const t: TimeForm = form.time
	const timeSet = !!(t.unit || t.perTurn.trim() || t.rests.length || t.roundSeconds.trim())
	const outcomes = form.outcomes.filter((o: OutcomeRow) => o.label.trim() || o.id.trim()).length
	return {
		attributes: String(form.attributes.length),
		functions: String(form.functions.length),
		entryTypes: String(form.entryTypes.length),
		zoneTypes: String(form.zoneTypes.length),
		outcomes: outcomes || timeSet ? String(outcomes + (timeSet ? 1 : 0)) : "defaults",
		library: String(rows),
		options: String(form.options.fields.filter((f: OptionRow) => f.name.trim()).length)
	}
}

/**
 * The rail's note (R6: attributes with their sentences are the floor of a
 * game): green when every attribute has its sentence, else what is missing.
 * 🚧 When the saved draft has findings (RF fix 2, item 8) it says how many
 * stand before publish instead: the draft saved all the same.
 */
export function playableNote(
	form: SectionsForm,
	slots: readonly SlotChoice[] = [],
	problems = 0
): { tone: "success" | "muted" | "warning"; strong: string; text: string } {
	if (problems > 0)
		return {
			tone: "warning",
			strong: problems === 1 ? "1 problem before publish." : `${problems} problems before publish.`,
			text: "The draft is saved as it is; each problem is shown where it is, and Publish waits until they are fixed."
		}
	const n = form.attributes.length
	if (!n) return { tone: "muted", strong: "Plays as no rules.", text: "A session on it reads like one with no rules at all. Add attributes with a sentence each and it's a game." }
	const silent = form.attributes.filter((a) => !a.prose.trim() && !a.slot)
	if (silent.length)
		return {
			tone: "muted",
			strong: "Almost playable.",
			text: `${listed(silent.map((a) => attributeName(a, slots)))} ${silent.length === 1 ? "needs its" : "need their"} sentence: the model reads what each one means.`
		}
	const words = ["One attribute", "Two attributes", "Three attributes", "Four attributes", "Five attributes"][n - 1] ?? `${n} attributes`
	return { tone: "success", strong: "Playable now.", text: `${words} with ${n === 1 ? "its sentence is" : "their sentences is"} a complete ruleset. Everything else is optional.` }
}

/** _Next, if you want it_: a few things worth adding next, by what the draft lacks. */
export function nextSteps(form: SectionsForm): { view: ViewId; link: string; why: string }[] {
	const out: { view: ViewId; link: string; why: string }[] = []
	if (!form.attributes.length) out.push({ view: "attributes", link: "Add an attribute", why: "with a sentence: that alone is something to play." })
	if (form.attributes.length && !form.functions.length)
		out.push({ view: "functions", link: "Add a function", why: "so a value changes by the rules instead of when the model remembers." })
	if (!form.entryTypes.length) out.push({ view: "entryTypes", link: "Add an entry type", why: "for the things people hold, suffer or share between them." })
	if (form.functions.length && !form.outcomes.length) out.push({ view: "outcomes", link: "Name your outcomes", why: "in your own words, so a result reads like your game." })
	return out.slice(0, 2)
}

/* ── the handbook ─────────────────────────────────────────────────── */

export interface HandbookPageView {
	id: string
	title: string
	body: string
	source: "generated" | "authored"
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
const sentence = (s: string) => (/[.!?…]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`)

const FIVE_WORDS: Readonly<Record<string, string>> = {
	"crit-fail": "a bad miss",
	fail: "falls short",
	partial: "a partial result",
	success: "works",
	crit: "goes better than hoped"
}

/**
 * 🚧 The handbook's pages, generated from the draft's sentences, then the
 * author's own: an authored page whose title matches a generated one takes
 * its place. The same pages, in the same order, as the handbook generator
 * the docs build uses (`renderHandbook`, the SDK's cli; lane A3): _How to
 * play ‹name›_, _What people carry_, _How things are decided_, _Things
 * people keep_, _How outcomes read_, _Time_.
 */
export function handbookPages(form: SectionsForm, input: { slots?: readonly SlotChoice[]; choices?: readonly FunctionChoice[] } = {}): HandbookPageView[] {
	const name = form.name.trim() || form.label.trim() || "This game"
	const slots = input.slots ?? []
	const pages: HandbookPageView[] = []
	const add = (title: string, body: string[]) => {
		const text = body.filter(Boolean).join("\n\n")
		if (text.trim()) pages.push({ id: slug(title), title, body: text, source: "generated" })
	}
	const attrs = form.attributes
	add(`How to play ${name}`, [
		form.description.trim() ? sentence(form.description) : "",
		attrs.length ? `What matters about people here: ${listed(attrs.map((a) => attributeName(a, slots)))}.` : ""
	])
	add("What people carry", [
		...attrs.filter((a) => a.prose.trim()).map((a) => `**${attributeName(a, slots)}** — ${sentence(a.prose)}`),
		...form.zoneTypes.filter((z: ZoneTypeRow) => z.prose.trim()).map((z) => `**${z.name || z.id}** — ${sentence(z.prose)}`)
	])
	const nameOf = (id: string) => attributeName(attrs.find((a) => a.id === id) ?? ({ id, name: "", slot: "" } as AttributeRow), slots)
	add(
		"How things are decided",
		form.functions.map((f) => {
			const decl = rowDecl(f, input.choices ?? [])
			const reads = readsAs(f, decl, nameOf)
			const title = i18nText(decl?.name as never) || f.key
			return reads ? `**${title}** — ${reads}` : ""
		})
	)
	add("Things people keep", form.entryTypes.filter((e: EntryTypeRow) => e.prose.trim()).map((e) => `**${e.name || e.id}** — ${sentence(e.prose)}`))
	add(
		"How outcomes read",
		form.outcomes
			.filter((o) => o.label.trim())
			.map((o) => `**${o.label.trim()}**${o.five && (FIVE_BANDS as readonly string[]).includes(o.five) ? ` — ${FIVE_WORDS[o.five]}` : ""}.`)
	)
	if (form.time.unit) add("Time", [`Time is kept in ${form.time.unit}s.`])
	for (const own of form.handbook) {
		if (!own.title.trim()) continue
		const page: HandbookPageView = { id: slug(own.title), title: own.title.trim(), body: own.body, source: "authored" }
		const at = pages.findIndex((p) => p.id === page.id || p.title === page.title)
		if (at >= 0) pages[at] = page
		else pages.push(page)
	}
	return pages
}
