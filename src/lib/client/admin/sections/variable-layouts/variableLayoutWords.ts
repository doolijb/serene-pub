/**
 * What Admin › Writing › Variable layouts says and where it links, pure so it
 * is tested (`variableLayoutWords.test.ts`). The pages (W1 the changelist, W2
 * a variable's change view, W3 a layout's form) and a preset's **Variable
 * layouts** fieldset (W6) read their words and addresses from here, so the
 * same fact reads the same way everywhere (PLAN variable-layouts 2026-11-10).
 *
 * UI words: *variable layout* (never bare *layout* as a heading noun),
 * *variable* (never *section*). Code keeps `variable template` identifiers.
 */
import { VARIABLE_LAYOUT_SLUG } from "@serene-pub/sdk"
// The owner slug Genres and Rulesets ask for, one rule for all three.
import { OWNER_SLUG } from "$lib/client/components/pipelines/workspace/canvas/draft.svelte"

type ListRow = Sockets.Pipelines.VariableLayouts.ListRow
type LibraryTemplate = Sockets.Pipelines.Library.LibraryTemplate

export const VARIABLE_LAYOUTS_HREF = "/admin/variable-layouts"

/** W2: a variable's page. The id holds `:`, `/` and `@`, so it is encoded as one segment. */
export function variableHref(variableId: string): string {
	return `${VARIABLE_LAYOUTS_HREF}/${encodeURIComponent(variableId)}`
}

/** W3: a layout's form — `new` (optionally starting from `from`), or a row's id. */
export function layoutFormHref(
	variableId: string,
	id: number | "new",
	from?: number | null
): string {
	const base = `${variableHref(variableId)}/${id}`
	return id === "new" && from != null ? `${base}?from=${from}` : base
}

/** W1's **Written as** column: the layout in use and why. */
export function writtenAsWords(row: Pick<ListRow, "inUse" | "reason">): string {
	if (row.reason === "as-written" || !row.inUse) return "As written"
	if (row.reason === "pub") return `${row.inUse.name} · chosen for this pub`
	if (row.reason === "automatic") return `${row.inUse.name} (automatic)`
	return row.inUse.name
}

/** The muted *+ N preset(s)* beside **Written as**; empty when no preset differs. */
export function presetsDifferingWords(n: number): string {
	if (!n || n < 1) return ""
	return `+ ${n} ${n === 1 ? "preset" : "presets"}`
}

/**
 * A layout reference's slug from its name — the server's `layoutSlugOf`
 * (`entities/objectVariableLayouts.ts`), so the slug shown is the one stamped.
 */
export function layoutSlugOf(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
}

/** `core:var/characters@2` → 2; 1 when the id carries none. */
export function variableMajorOf(variableId: string): number {
	const m = /@(\d+)$/.exec(variableId)
	return m ? Number(m[1]) : 1
}

/** `owner/slug@major`, as the form shows it in mono. */
export function referenceOf(
	variableId: string,
	ownerSlug: string,
	slug: string
): string {
	return `${ownerSlug}/${slug}@${variableMajorOf(variableId)}`
}

/** What is wrong with a typed owner slug, in words; null when it reads. */
export function ownerSlugProblem(owner: string): string | null {
	const o = owner.trim()
	if (!o)
		return "An owner slug is needed: every variable layout you make is named under it."
	if (o === "core")
		return "core is Serene Pub's own. Use an owner slug of your own."
	if (!OWNER_SLUG.test(o))
		return "The owner slug takes lowercase letters and digits, joined by single dots or hyphens."
	return null
}

/** What is wrong with a typed slug, in words; null when it reads. */
export function slugProblem(slug: string): string | null {
	const s = slug.trim()
	if (!s) return "A name to reference it by is needed."
	if (!VARIABLE_LAYOUT_SLUG.test(s))
		return "The name takes lowercase letters and digits, joined by single hyphens: prose, titled-json."
	return null
}

/**
 * The owner slug this pub last used for a layout of its own: the newest
 * person's row (not built in) that carries a reference. Empty when none.
 */
export function lastOwnerSlug(rows: readonly LibraryTemplate[]): string {
	let best: { id: number; owner: string } | null = null
	for (const r of rows) {
		if (r.isImmutable || !r.reference) continue
		const owner = r.reference.slice(0, r.reference.indexOf("/"))
		if (!owner || owner === "core") continue
		if (!best || r.id > best.id) best = { id: r.id, owner }
	}
	return best?.owner ?? ""
}

/** The name a template writes the variable by: its first scope root (`characters`). */
export function variableKeyOf(
	scope: Record<string, unknown> | null | undefined,
	variableId: string
): string {
	const first = scope ? Object.keys(scope)[0] : undefined
	if (first) return first
	const name = /\/([^@]+)@/.exec(variableId)?.[1] ?? variableId
	return name
}

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`

/**
 * W3's **Use it everywhere** sentence, counted: what turning it on changes.
 * Templates the check cannot read are named, not counted.
 */
export function useEverywhereSentence(
	key: string,
	counts: {
		pipelines?: number
		contextTemplates?: number
		uncheckedContextTemplates?: number
	} | null
): string {
	const head = `Every template that writes {{{${key}}}} without naming a variable layout uses this one`
	if (!counts) return `${head}.`
	const p = counts.pipelines ?? 0
	const t = counts.contextTemplates ?? 0
	const u = counts.uncheckedContextTemplates ?? 0
	const tail = u
		? ` ${plural(u, "template", "templates")} in a language the check cannot read ${u === 1 ? "is" : "are"} not counted.`
		: ""
	return `${head}: ${plural(p, "pipeline", "pipelines")}, ${plural(t, "template", "templates")}.${tail}`
}

/** `?step=<specSlug>:<stepKey>`, the panel's opaque handle; split at the last colon (a hex handle holds none). */
export function parseStepParam(
	step: string | null | undefined
): { specSlug: string; stepKey: string } | null {
	if (!step) return null
	const at = step.lastIndexOf(":")
	if (at <= 0 || at === step.length - 1) return null
	return { specSlug: step.slice(0, at), stepKey: step.slice(at + 1) }
}

/** W2: *Named by 2 context templates*; empty when none name it. */
export function namedByTemplatesWords(n: number): string {
	if (!n || n < 1) return ""
	return `Named by ${n} context ${n === 1 ? "template" : "templates"}`
}

/** `A`, `A and B`, `A, B and C`. */
export function joinNames(names: readonly string[]): string {
	if (names.length < 2) return names[0] ?? ""
	return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/** *the A preset* / *the A and B presets*: the words after *Chosen by*. */
export function presetsWords(names: readonly string[]): string {
	return `the ${joinNames(names)} ${names.length === 1 ? "preset" : "presets"}`
}

/**
 * Why W2 already knows a layout stays, for the delete confirmation's
 * `protect`; null when the view knows no reason (the server may still refuse).
 */
export function layoutStaysWords(row: {
	inUse: boolean
	namedByTemplates: number
	chosenByPresets: readonly { name: string }[]
}): string | null {
	if (row.inUse) return "it is the one in use — choose another first"
	if (row.chosenByPresets.length)
		return `chosen by ${presetsWords(row.chosenByPresets.map((p) => p.name))}`
	if (row.namedByTemplates > 0) {
		const n = row.namedByTemplates
		return `named by ${n} context ${n === 1 ? "template" : "templates"}`
	}
	return null
}

/** A layout's language in words: Handlebars, Liquid, or a plugin's engine id as it is. */
export function engineWords(engine: string): string {
	if (engine === "core:template/handlebars@1") return "Handlebars"
	if (engine === "core:template/liquid@1") return "Liquid"
	return engine
}

/** W1's filter line: the step in words, falling back when its heading is unknown. */
export function stepWords(heading?: string, pipelineLabel?: string): string {
	if (heading)
		return pipelineLabel ? `${heading} in ${pipelineLabel}` : heading
	return pipelineLabel ? `a step in ${pipelineLabel}` : "this step"
}

type LeftoverPick = Sockets.Pipelines.LeftoverPicks.Pick

/** The variables with leftover picks at more than one level (genre, preset, instance). */
export function variablesAtSeveralLevels(
	picks: readonly Pick<LeftoverPick, "variableId" | "scope">[]
): Set<string> {
	const kinds = new Map<string, Set<string>>()
	for (const p of picks) {
		const set = kinds.get(p.variableId) ?? new Set<string>()
		set.add(p.scope.kind)
		kinds.set(p.variableId, set)
	}
	return new Set(
		[...kinds].filter(([, set]) => set.size > 1).map(([id]) => id)
	)
}

/**
 * A leftover pick's line: *‹Variable› uses ‹layout› here (set before layouts
 * moved).*, naming the step it was set on when its lines show under another
 * step's template, and the level (*the genre's*, *the ‹name› preset's*, *the
 * pipeline's*) when the variable has picks at more than one.
 */
export function leftoverLineWords(
	pick: Pick<
		LeftoverPick,
		"variableLabel" | "layoutName" | "scope" | "presetName"
	>,
	opts: { stepHeading?: string; levelNamed?: boolean } = {}
): string {
	const level = !opts.levelNamed
		? ""
		: pick.scope.kind === "genre"
			? "the genre's "
			: pick.scope.kind === "preset"
				? pick.presetName
					? `the ${pick.presetName} preset's `
					: "the preset's "
				: "the pipeline's "
	const where = opts.stepHeading
		? `set on ${opts.stepHeading} before layouts moved`
		: "set before layouts moved"
	return `${pick.variableLabel} uses ${level}${pick.layoutName}${opts.stepHeading ? "" : " here"} (${where}).`
}

/** One thing that writes a variable out with another layout than the one in use. */
export type Difference = Sockets.Pipelines.VariableLayouts.Difference

/** One line of **Where this differs**: text, a link to where it is changed, text. */
export function differenceLine(d: Difference): {
	lead: string
	link: { text: string; href: string }
	rest: string
} {
	if (d.kind === "template")
		return {
			lead: "The context template ",
			link: { text: d.name, href: `/admin/context-templates/${d.id}` },
			rest: ` names ${d.layout.name}.`
		}
	if (d.kind === "preset")
		return {
			lead: "The ",
			link: { text: d.name, href: `/admin/session-presets/${d.id}` },
			rest: ` preset chooses ${d.layout.name}.`
		}
	return {
		lead: d.stepHeading ? `${d.stepHeading} in ` : "A step in ",
		link: {
			text: d.pipelineLabel,
			href: `/admin/pipelines/${encodeURIComponent(d.specSlug)}`
		},
		rest:
			d.kind === "leftover"
				? ` keeps ${d.layout.name}, picked before layouts moved.`
				: ` uses ${d.layout.name}, the pipeline's choice for that step.`
	}
}
