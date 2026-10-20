/**
 * A loadout's **consequence line** (I12; DESIGN-image-generation §12
 * suggestion 2, ruled): what a run on it WOULD say in its receipt — *JSON by
 * instruction (no schema door)* · *tools by instruction (no native tool
 * calls)* · *references dropped* — never a grade. Describes, never judges.
 *
 * Pure and shared: the Loadouts grid, the loadout sheet and the Pipelines
 * settings group's picker rows all say the same words for the same pair.
 */

/** A capability set as stored on a connection: capability id → grade. */
export type GradeSet = Partial<Record<string, number>>

/** What a step needs, derived from its wiring (never declared). */
export interface StepNeeds {
	/** A structured answer port (`generate-json`, a schema in). */
	structured?: boolean
	/** A tools port. */
	tools?: boolean
	/** Reference pictures wired in. */
	references?: boolean
}

/**
 * The *Best with* words for a `prefers.tier` — the Pipelines Loadout row's
 * and the loadout editor's, one list.
 */
export const TIER_WORDS: Readonly<Record<string, string>> = {
	fast: "a fast model",
	cheap: "a cheap model",
	best: "the best model"
}

/** The loadouts core ships that imply a need, by seed key. */
const IMPLIED: Record<string, StepNeeds> = {
	"core:loadout/extraction@1": { structured: true },
	"core:loadout/scene-prompt@1": { structured: true },
	"core:loadout/tool-calling@1": { tools: true },
	"core:loadout/portrait@1": { references: true },
	"core:loadout/sprites@1": { references: true }
}

/** The needs a loadout implies on its own (core's set), for its tile. */
export function impliedNeeds(seedKey: string | null | undefined): StepNeeds {
	return (seedKey && IMPLIED[seedKey]) || {}
}

/**
 * The consequence words for a pair against a step's needs, or `[]` when the
 * pair answers every need natively.
 */
export function consequencesFor(
	grades: GradeSet | null | undefined,
	needs: StepNeeds
): string[] {
	const g = grades ?? {}
	const out: string[] = []
	if (needs.structured && !((g["json_schema"] ?? 0) > 0))
		out.push("JSON by instruction (no schema door)")
	if (needs.tools && !((g["tools"] ?? 0) >= 2))
		out.push("tools by instruction (no native tool calls)")
	if (needs.references && !((g["text+image->image"] ?? 0) > 0))
		out.push("references dropped")
	return out
}

/**
 * The one line a loadout tile shows: unfilled → where it falls back; filled →
 * its first consequence, or nothing.
 */
export function consequenceLine(opts: {
	filled: boolean
	fallbackName?: string | null
	grades?: GradeSet | null
	needs: StepNeeds
}): string | null {
	if (!opts.filled)
		return opts.fallbackName
			? `Unfilled — falls back to ${opts.fallbackName}`
			: "Unfilled — nothing to fall back to yet"
	const c = consequencesFor(opts.grades, opts.needs)
	return c.length ? c.join(" · ") : null
}

/**
 * Step 3's swap rule (§12 suggestion 4, ruled): on a pair change, a sampling
 * config whose shape the new pair does not speak is swapped for the
 * transform's seeded default — and the sheet SAYS so. Returns the config to
 * keep and the notice, or `null` notice when nothing moved.
 */
export function samplingAfterPairChange(opts: {
	current: { id: number; name: string; shape: string } | null
	/** The shape the new pair's sampling speaks (the transform's, or a workflow's). */
	wantedShape: string | null
	/** The transform's seeded default config, if any. */
	seededDefault: { id: number; name: string; shape: string } | null
}): { samplingConfigId: number | null; notice: string | null } {
	const { current, wantedShape, seededDefault } = opts
	if (!current || !wantedShape || current.shape === wantedShape)
		return { samplingConfigId: current?.id ?? null, notice: null }
	const next =
		seededDefault && seededDefault.shape === wantedShape ? seededDefault : null
	return {
		samplingConfigId: next?.id ?? null,
		notice: next
			? `${current.name} does not fit this model, so sampling is now ${next.name}.`
			: `${current.name} does not fit this model, so sampling is cleared — the model's own defaults apply.`
	}
}
