/**
 * The Pipelines view's drill-in — Genre → Preset → Edit (owner request
 * 2026-09-28), with every pipeline still reachable through "All pipelines".
 *
 * Kept out of the component for two reasons. The grouping is a handful of
 * pure functions a test can pin without a DOM. And the location is held at
 * MODULE scope (`pipelinesSidebarNav` below), so closing the view and opening
 * it again lands where the person left it: the shell unmounts a view on
 * close, and state inside the component would go with it. In memory only —
 * a reload starts at the genres, which is where someone new to the view
 * should start anyway.
 */

type Preset = Sockets.SessionAdmin.PresetRow

/** Where the view is. One variable, the pattern the sampling view uses. */
export type PipelinesLocation =
	| { level: "genres" }
	| { level: "presets"; genreId: string }
	| { level: "edit"; genreId: string; presetId: number }
	| { level: "library" }
	| { level: "pipeline"; slug: string }

export class PipelinesSidebarNav {
	location = $state<PipelinesLocation>({ level: "genres" })

	/** The genre the location sits under, or null (the genres, the library). */
	get genreId(): string | null {
		const l = this.location
		return l.level === "presets" || l.level === "edit" ? l.genreId : null
	}

	/** Anywhere under "All pipelines". */
	get inLibrary(): boolean {
		const l = this.location
		return l.level === "library" || l.level === "pipeline"
	}

	openGenre(genreId: string) {
		this.location = { level: "presets", genreId }
	}

	/** Only from inside a genre — a preset is always reached through one. */
	openPreset(presetId: number) {
		const genreId = this.genreId
		if (genreId == null) return
		this.location = { level: "edit", genreId, presetId }
	}

	openLibrary() {
		this.location = { level: "library" }
	}

	openPipeline(slug: string) {
		this.location = { level: "pipeline", slug }
	}

	/** One level up. At the genres it stays put. */
	back() {
		const l = this.location
		if (l.level === "edit")
			this.location = { level: "presets", genreId: l.genreId }
		else if (l.level === "pipeline") this.location = { level: "library" }
		else this.location = { level: "genres" }
	}

	/**
	 * Step back past a genre or preset that has gone missing — a plugin
	 * switched off, a preset deleted — rather than render a header over
	 * nothing. `null` means that list has not arrived, and a list that has
	 * not arrived judges nothing.
	 */
	repair(known: { genreIds: string[] | null; presetIds: number[] | null }) {
		const l = this.location
		if (l.level !== "presets" && l.level !== "edit") return
		if (known.genreIds && !known.genreIds.includes(l.genreId)) {
			this.location = { level: "genres" }
			return
		}
		if (
			l.level === "edit" &&
			known.presetIds &&
			!known.presetIds.includes(l.presetId)
		)
			this.location = { level: "presets", genreId: l.genreId }
	}
}

/** The one the view reads — module scope, so it outlives a close. */
export const pipelinesSidebarNav = new PipelinesSidebarNav()

/* ── grouping ───────────────────────────────────────────────────────── */

export interface GenreRow {
	genreId: string
	name: string
	description: string
	presetCount: number
}

/**
 * Every offered genre, in the order the server offers them, with how many
 * presets it has. Only offered genres: a preset whose genre is not offered
 * (its plugin is off) has nowhere to start a session, so it has no row here.
 */
export function genreRows(
	genres: { genreId: string; name: string; description: string }[],
	presets: Preset[]
): GenreRow[] {
	const counts = new Map<string, number>()
	for (const p of presets)
		counts.set(p.genreId, (counts.get(p.genreId) ?? 0) + 1)
	return genres.map((g) => ({
		genreId: g.genreId,
		name: g.name,
		description: g.description,
		presetCount: counts.get(g.genreId) ?? 0
	}))
}

/** A genre's presets — the default first, then by name. */
export function presetsOfGenre(genreId: string, presets: Preset[]): Preset[] {
	return presets
		.filter((p) => p.genreId === genreId)
		.sort(
			(a, b) =>
				Number(b.isDefault) - Number(a.isDefault) ||
				a.name.localeCompare(b.name)
		)
}

/**
 * Which configuration a preset names for a pipeline, or null.
 *
 * ⚠ A mirror of the server's `presetConfigForSpec`
 * (`pipelines/entities/presetBindings.ts`), for display only: a binding's own
 * `config` first, then `configSelections`. Null means the preset names none
 * and a session on it runs whatever the instance has selected.
 */
export function presetConfigFor(preset: Preset, slug: string): number | null {
	for (const bound of Object.values(preset.bindings ?? {}))
		if (bound?.spec === slug && bound.config != null)
			return Number(bound.config)
	const selected = (preset.configSelections ?? {})[slug]
	return selected != null ? Number(selected) : null
}

export interface PresetPipeline {
	slug: string
	name: string
	/** The event ids that bind this pipeline, in the preset's order. */
	events: string[]
	/**
	 * The actions the preset includes from it, by display name — the
	 * declaration's label where the server resolved it, else the key.
	 */
	actions: string[]
	configId: number | null
}

/**
 * The actions a preset includes, as `{ slug, name }` per action.
 *
 * `effectiveIncludedActions` first: the server's resolution of the included
 * set, the companion rule applied where it is `null` (every shipped preset).
 * The rule is NOT re-derived here — a row without the field (a write's
 * single-row answer) falls back to the stated identities alone, which is
 * exact for a stated set and names nothing for `null`.
 */
function includedActionsOf(preset: Preset): { slug: string; name: string }[] {
	if (preset.effectiveIncludedActions)
		return preset.effectiveIncludedActions.map((a) => ({
			slug: a.specSlug,
			name: a.name
		}))
	const out: { slug: string; name: string }[] = []
	for (const identity of preset.includedActions ?? []) {
		const hash = identity.indexOf("#")
		// ⏳ A bare function key names no spec, so it names no pipeline.
		if (hash <= 0) continue
		out.push({ slug: identity.slice(0, hash), name: identity.slice(hash + 1) })
	}
	return out
}

/**
 * Every pipeline a preset reaches, once each: through an event binding,
 * through an included action (stated or by the default rule), or named only
 * by `configSelections`. Event bindings first, in the preset's order, then
 * actions, then the rest.
 */
export function presetPipelines(
	preset: Preset,
	namespaces: Pick<Sockets.Pipelines.Namespace, "slug" | "name">[]
): PresetPipeline[] {
	const order: string[] = []
	const events = new Map<string, string[]>()
	const actions = new Map<string, string[]>()
	const see = (slug: string) => {
		if (!order.includes(slug)) order.push(slug)
	}
	for (const [event, bound] of Object.entries(preset.bindings ?? {})) {
		if (!bound?.spec) continue
		see(bound.spec)
		events.set(bound.spec, [...(events.get(bound.spec) ?? []), event])
	}
	for (const { slug, name } of includedActionsOf(preset)) {
		see(slug)
		actions.set(slug, [...(actions.get(slug) ?? []), name])
	}
	for (const slug of Object.keys(preset.configSelections ?? {})) see(slug)

	const names = new Map(namespaces.map((n) => [n.slug, n.name]))
	return order.map((slug) => ({
		slug,
		name: names.get(slug) ?? slug,
		events: events.get(slug) ?? [],
		actions: actions.get(slug) ?? [],
		configId: presetConfigFor(preset, slug)
	}))
}

/**
 * The Edit level's two groups: the pipelines the preset runs on its own
 * (event bindings, configuration selections), then — under "Actions" — the
 * ones it reaches only through an included action. A pipeline both bound and
 * carrying an action stays in the first group; its row names the action.
 */
export function presetPipelineGroups(
	preset: Preset,
	namespaces: Pick<Sockets.Pipelines.Namespace, "slug" | "name">[]
): { pipelines: PresetPipeline[]; actions: PresetPipeline[] } {
	const all = presetPipelines(preset, namespaces)
	const isAction = (p: PresetPipeline) => !p.events.length && p.actions.length > 0
	return {
		pipelines: all.filter((p) => !isAction(p)),
		actions: all.filter(isAction)
	}
}
