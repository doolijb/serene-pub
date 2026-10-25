/**
 * A job's **sheet** — the job picker grown to the three questions a person
 * asks about a job, in the order they ask them (plan 2026-10-11, lane B):
 *
 *   1. **Which model answers** — the job picker's own content (`jobPicker.ts`).
 *   2. **How it writes** — the job's default sampling config, for a job whose
 *      output has a sampling vocabulary (`samplingShapeForCapability`); an
 *      image job reads **How it draws**. Absent for one that has none
 *      (embeddings, entities): an empty picker would read as "we lost your
 *      configs" (see `samplingShapeForCapability`).
 *   3. **Where this applies** — every session, and the pipelines that pick a
 *      sampling config of their own, each a door to Pipelines.
 *
 * Every heading, sentence, row and verb the sheet's sections 2 and 3 show is
 * decided here, so the components assemble and branch on nothing.
 *
 * ⚠ Nothing here emits. Choosing a radio is the sheet's one
 * `samplingConfigs:setDefaultFor`; the ★ reads the shell's
 * `capabilityDefaults`, which moves when that write lands.
 */
import {
	outputKindOf,
	samplingShapeForCapability,
	samplingShapesForCapability
} from "$lib/shared/capabilities/samplingShape"
import {
	samplingSettingsOn,
	shapeOf,
	type SamplingListRow,
	type SamplingPipelineUse
} from "$lib/client/components/sidebars/samplingList"
import { jobLabel } from "./jobPicker"
import { S } from "@serene-pub/sdk"

/** The sheet's quiet word over its title: what the title names. */
export const SHEET_EYEBROW = "Loadout"

/** The sheet's title: the default loadout's name, "Reply". */
export function sheetTitle(capability: string): string {
	return jobLabel(capability)
}

/** One numbered section of the sheet. */
export interface SheetSection {
	key: "model" | "sampling" | "where"
	/** "1", "2", "3" — drawn small and monospaced beside the heading. */
	number: string
	heading: string
}

/**
 * "How it writes" for text, "How it draws" for images, "How it speaks" for
 * speech: the sampling section's heading in the job's own verb. Null where
 * the job has no sampling vocabulary, and the section is not drawn.
 */
export function samplingHeading(capability: string): string | null {
	if (!samplingShapeForCapability(capability)) return null
	switch (outputKindOf(capability)) {
		case "image":
			return "How it draws"
		case "audio":
			return "How it speaks"
		default:
			return "How it writes"
	}
}

/**
 * The sheet's sections in order, numbered as drawn: the sampling one only
 * where the job has a sampling vocabulary, so a job without one counts
 * 1, 2 rather than skipping a number.
 */
export function sheetSections(capability: string): SheetSection[] {
	const sampling = samplingHeading(capability)
	const keyed: Array<Omit<SheetSection, "number">> = [
		{ key: "model", heading: "Which model answers" },
		...(sampling ? [{ key: "sampling" as const, heading: sampling }] : []),
		{ key: "where", heading: "Where this applies" }
	]
	return keyed.map((s, i) => ({ ...s, number: String(i + 1) }))
}

/**
 * 🚧 O7: a job that writes more than one kind — a spoken reply — takes one
 * sampling per kind. The sheet picks the first (how it writes); this is the
 * line naming where the second comes from: the voice is the Narration
 * loadout's sampling, unless a pipeline step picks its own speech sampling.
 * Null for a job that writes one kind.
 */
export function speechSamplingNote(capability: string): string | null {
	const shapes = samplingShapesForCapability(capability)
	if (shapes.length < 2 || !shapes.includes(S.tts)) return null
	return "How it speaks — the voice and its speed — comes from the Narration loadout's sampling, unless a step picks its own."
}

/** The sampling section's quiet line beside its heading. */
export const SAMPLING_SUBLINE = "a sampling config · used by this loadout"

/**
 * The "Where this applies" sentence. A job with a sampling vocabulary names
 * both halves a pipeline configuration may override; one without names the
 * model only.
 */
export function whereSentence(capability: string): string {
	return samplingShapeForCapability(capability)
		? "Every session, unless a pipeline configuration names its own model or sampling."
		: "Every session, unless a pipeline configuration names its own model."
}

/** One sampling config as a radio row in the sheet. */
export interface SamplingChoiceRow {
	id: number
	name: string
	builtIn: boolean
	/** "Built in · 6 settings on", "No settings on". */
	line: string
	/** The ★: the config this job's default names now. */
	isDefault: boolean
}

/**
 * The configs of the job's shape, the server's order kept (built-ins first,
 * then by name), each with its row line and whether it holds this job's
 * default. Empty for a job without a sampling vocabulary.
 */
export function samplingChoiceRows(
	rows: readonly SamplingListRow[],
	capability: string,
	defaultId: number | null | undefined
): SamplingChoiceRow[] {
	const shape = samplingShapeForCapability(capability)
	if (!shape) return []
	return rows
		.filter((r) => shapeOf(r) === shape)
		.map((r) => ({
			id: r.id,
			name: r.name,
			builtIn: !!r.isImmutable,
			line: [r.isImmutable ? "Built in" : null, samplingSettingsOn(r)]
				.filter(Boolean)
				.join(" · "),
			isDefault: r.id === defaultId
		}))
}

/** A radio row's accessible name: what it is, and what choosing it does. */
export function samplingChoiceLabel(
	row: SamplingChoiceRow,
	capability: string
): string {
	const job = jobLabel(capability)
	return row.isDefault
		? `${row.name}, used by the ${job} loadout`
		: `Use ${row.name} in the ${job} loadout`
}

/**
 * What the section says when the job names no config: nothing is sent, so
 * the connection's own defaults apply — Admin › Defaults' words for an
 * unset choice.
 */
export const NO_SAMPLING_DEFAULT_SENTENCE =
	"None picked: the connection's own defaults apply."

/** The section's one line when the shape has no configs at all. */
export const NO_SAMPLING_CONFIGS_SENTENCE = "No sampling configs for this yet."

/** The verbs under the radio list. */
/**
 * The one door out of step 2: the checked config opens in the Sampling view
 * (owner 2026-10-11: the Sampling view stays; the sheet picks, it edits).
 */
export const OPEN_IN_SAMPLING_VERB = "Open in Sampling"

/** One pipeline that picks its own sampling config of the job's shape. */
export interface OverridingPipeline {
	label: string
	/** Null when the pipeline is not listed (its plugin is off). */
	slug: string | null
	/** The config it picks. */
	configName: string
}

/**
 * The pipelines whose `sampling` slot picks a config of the job's shape —
 * so the job's default does not reach them. One entry per pipeline and
 * config, ordered by pipeline label. Empty for a job without a sampling
 * vocabulary.
 */
export function overridingPipelines(
	rows: readonly SamplingListRow[],
	pipelines:
		| Record<number, readonly SamplingPipelineUse[]>
		| null
		| undefined,
	capability: string
): OverridingPipeline[] {
	const shape = samplingShapeForCapability(capability)
	if (!shape || !pipelines) return []
	const out: OverridingPipeline[] = []
	for (const row of rows) {
		if (shapeOf(row) !== shape) continue
		for (const p of pipelines[row.id] ?? [])
			out.push({ label: p.label, slug: p.slug, configName: row.name })
	}
	return out.sort(
		(a, b) =>
			a.label.localeCompare(b.label) ||
			a.configName.localeCompare(b.configName)
	)
}

/**
 * The line over the pipelines list: "2 pipelines pick their own sampling
 * config:", or that none does.
 */
export function overridesSentence(count: number): string {
	if (!count) return "No pipeline picks its own sampling config."
	return count === 1
		? "1 pipeline picks its own sampling config:"
		: `${count} pipelines pick their own sampling config:`
}

/** A pipeline link's accessible name. */
export function pipelineLinkLabel(p: OverridingPipeline): string {
	return p.slug
		? `Open ${p.label} in Admin › Pipelines`
		: `Open Admin › Pipelines (${p.label} is not listed)`
}

/** The toast a radio pick says once its write lands. */
export function samplingDefaultToast(
	configName: string | null,
	capability: string
): { title: string; description: string } {
	return {
		title: "Loadout sampling updated",
		description: `The ${jobLabel(capability)} loadout uses ${configName ?? "the config"} now.`
	}
}

/** The sheet's foot: where the same defaults are kept as an inventory. */
export const OPEN_IN_ADMIN = { label: "Open in Admin", href: "/admin/defaults" }
