/**
 * What a list of sampling configs says about each one, pure so it is tested
 * (`samplingList.test.ts`): how the rows group, which jobs and pipelines pick
 * a config, the row's second line, what its glyphs and the Delete dialog say,
 * and which config opens first. Read by a job's sheet in the Models view
 * (`connections/JobPickerDialog`) and by Admin › Sampling; the Sampling view
 * they were written for is gone (plan 2026-10-11).
 *
 * The ★ ("Default for …") reads EVERY job's `connection_defaults` row, never
 * one canonical transform per shape: a config that is the default for Vision
 * but not for Chat holds a default, and the ★ says so.
 */

import {
	S,
	samplingSchemaFor,
	type SettingsSchema
} from "@serene-pub/sdk"
import { samplingShapeForCapability } from "$lib/shared/capabilities/samplingShape"
import {
	modalityLabel,
	modalityOfShape
} from "$lib/shared/constants/ConnectionTypes"
import { countEnabled } from "./samplingFields"
import { defaultLoadoutName } from "$lib/shared/loadouts/defaultLoadoutName"

export interface SamplingListRow {
	id: number
	name: string
	isImmutable?: boolean | null
	shape?: string | null
	values?: Record<string, unknown> | null
	enabled?: readonly string[] | null
}

export type SamplingJob = Sockets.SamplingConfigs.UsedBy.Job
export type SamplingPipelineUse = Sockets.SamplingConfigs.UsedBy.Pipeline

type LiveDefaults = Record<
	string,
	{ samplingConfigId?: number | null } | undefined
>

/**
 * The view's memory, at module scope so closing the view and opening it again
 * lands on the config last open: the shell unmounts a view on close. In
 * memory only; a reload starts from the desk's own pick.
 */
export const samplingSidebarMemory: { selectedId: number | null } = {
	selectedId: null
}

/** The list's groups, in this order; any other shape follows. */
const GROUPS: ReadonlyArray<{ shape: string; label: string }> = [
	{ shape: S.textGen, label: "Large language models" },
	{ shape: S.imageGen, label: "Image generation" },
	{ shape: S.tts, label: "Speech" }
]

/** A row's shape; a row without one speaks text. */
export const shapeOf = (row: { shape?: string | null }): string =>
	row.shape || S.textGen

/** A row's schema: the SDK's vocabulary for its shape. */
export function schemaOfShape(shape: string | null | undefined): SettingsSchema {
	return samplingSchemaFor(shape)
}

/** The heading a shape's configs list under. */
export function samplingGroupLabel(shape: string): string {
	const known = GROUPS.find((g) => g.shape === shape)
	if (known) return known.label
	const word = modalityLabel(modalityOfShape(shape))
	return word.charAt(0).toUpperCase() + word.slice(1)
}

export interface SamplingListGroup {
	shape: string
	label: string
	rows: SamplingListRow[]
}

/**
 * The rows by shape, the server's order kept inside each group (built-ins
 * first, then by name). `filter` matches the name, any case; a group the
 * filter empties is left out.
 */
export function groupSamplingConfigs(
	rows: readonly SamplingListRow[],
	filter = ""
): SamplingListGroup[] {
	const q = filter.trim().toLowerCase()
	const kept = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows
	const order = [
		...GROUPS.map((g) => g.shape),
		...new Set(
			kept.map(shapeOf).filter((s) => !GROUPS.some((g) => g.shape === s))
		)
	]
	return order
		.map((shape) => ({
			shape,
			label: samplingGroupLabel(shape),
			rows: kept.filter((r) => shapeOf(r) === shape)
		}))
		.filter((g) => g.rows.length > 0)
}

/**
 * What a person calls a transform's default: its default loadout's name,
 * "Reply", "Images", "Vision" (owner 2026-10-12: loadouts, never nicknames).
 */
export function jobLabel(capability: string): string {
	return defaultLoadoutName(capability)
}

/** "the Reply loadout" · "the Reply and Vision loadouts". */
function loadoutsWords(capabilities: readonly string[]): string {
	const names = wordList(capabilities.map(jobLabel))
	return `the ${names} ${capabilities.length === 1 ? "loadout" : "loadouts"}`
}

/** Chat first (the job that blocks play), then by label. */
export function sortJobs<T extends { capability: string }>(
	jobs: readonly T[]
): T[] {
	return [...jobs].sort((a, b) => {
		if (a.capability === "text->text") return -1
		if (b.capability === "text->text") return 1
		return jobLabel(a.capability).localeCompare(jobLabel(b.capability))
	})
}

/**
 * The jobs the server listed, with the config each holds read from the live
 * `capabilityDefaults` (pushed after every default write, from any screen)
 * when that map is loaded. A live row naming a config for a transform the
 * server did not list is added, so the ★ never trails a write made
 * elsewhere.
 */
export function jobsWithLiveDefaults(
	jobs: readonly SamplingJob[],
	live: LiveDefaults | null | undefined
): SamplingJob[] {
	if (!live) return [...jobs]
	const out = jobs.map((j) => ({
		...j,
		samplingConfigId: live[j.capability]?.samplingConfigId ?? null
	}))
	for (const [capability, d] of Object.entries(live)) {
		if (d?.samplingConfigId == null) continue
		if (out.some((j) => j.capability === capability)) continue
		const shape = samplingShapeForCapability(capability)
		if (!shape) continue
		out.push({ capability, shape, samplingConfigId: d.samplingConfigId })
	}
	return out
}

export interface SamplingUse {
	/** The jobs whose default names this config, chat first. */
	jobs: SamplingJob[]
	/** The pipelines whose `sampling` slot picks it. */
	pipelines: SamplingPipelineUse[]
}

export function samplingUseOf(
	id: number,
	jobs: readonly SamplingJob[],
	pipelines: Record<number, readonly SamplingPipelineUse[]> | null | undefined
): SamplingUse {
	return {
		jobs: sortJobs(jobs.filter((j) => j.samplingConfigId === id)),
		pipelines: [...(pipelines?.[id] ?? [])]
	}
}

/** "Chat", "Chat and Vision", "Chat, Vision and Images". */
function wordList(words: readonly string[]): string {
	if (words.length <= 1) return words.join("")
	return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
}

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`

/**
 * How many settings a config turns on, in words: "6 settings on", "1 setting
 * on", "No settings on". The row line's first part, and Admin › Sampling's
 * Settings column, so the two never say it differently.
 */
export function samplingSettingsOn(row: SamplingListRow): string {
	const { on } = countEnabled(schemaOfShape(shapeOf(row)), row.enabled)
	return on ? `${plural(on, "setting", "settings")} on` : "No settings on"
}

/**
 * The row's second line, in words: how many settings it turns on, then what
 * uses it. "6 settings on · default for Chat, Vision", "… · used by 2
 * pipelines", "… · unused". The editor's Used by card names the same jobs
 * and pipelines, so the row says "used by" too.
 */
export function samplingRowLine(
	row: SamplingListRow,
	use: SamplingUse
): string {
	const parts = [samplingSettingsOn(row)]
	if (use.jobs.length)
		parts.push(
			`in ${loadoutsWords(use.jobs.map((j) => j.capability))}`
		)
	if (use.pipelines.length)
		parts.push(
			`used by ${plural(use.pipelines.length, "pipeline", "pipelines")}`
		)
	if (!use.jobs.length && !use.pipelines.length) parts.push("unused")
	return parts.join(" · ")
}

/** What the row's lock says, on hover and to a screen reader. */
export const BUILT_IN_GLYPH_WORDS = "Built in. Duplicate it to edit."

/**
 * What the row's star says: the jobs this config is the default for, Chat
 * first ("Default for Chat, Vision"). Null when it holds no default, so the
 * star is not drawn.
 */
export function samplingStarWords(use: SamplingUse): string | null {
	if (!use.jobs.length) return null
	const words = loadoutsWords(use.jobs.map((j) => j.capability))
	return `In ${words}`
}

/**
 * What deleting a config changes, one sentence per consequence, for the
 * Delete dialog. A job whose default names it loses that sampling choice
 * (`connection_defaults.sampling_config_id` is ON DELETE SET NULL), and a
 * null choice sends nothing, so the connection's own defaults apply: the
 * words Admin › Defaults shows for an unset choice. A pipeline that picks it
 * is left without that choice. Empty when nothing uses it.
 */
export function samplingDeleteWarnings(use: SamplingUse): string[] {
	const out: string[] = []
	if (use.jobs.length) {
		const words = loadoutsWords(use.jobs.map((j) => j.capability))
		const one = use.jobs.length === 1
		out.push(
			`${words.charAt(0).toUpperCase()}${words.slice(1)} ${one ? "uses" : "use"} it, so ${one ? "it" : "they"} will use the connection's own defaults until you set another.`
		)
	}
	if (use.pipelines.length)
		out.push(
			`${plural(use.pipelines.length, "pipeline uses", "pipelines use")} it and will need another choice.`
		)
	return out
}

/**
 * The config the desk opens on: the one last open, else the text config
 * Chat's default names, else any text config holding a default, else the
 * first text config, else the first row.
 */
export function initialSamplingId(
	rows: readonly SamplingListRow[],
	jobs: readonly SamplingJob[],
	remembered: number | null
): number | null {
	if (remembered != null && rows.some((r) => r.id === remembered))
		return remembered
	const text = rows.filter((r) => shapeOf(r) === S.textGen)
	const chat = jobs.find(
		(j) => j.capability === "text->text"
	)?.samplingConfigId
	const held = new Set(jobs.map((j) => j.samplingConfigId))
	return (
		text.find((r) => r.id === chat)?.id ??
		text.find((r) => held.has(r.id))?.id ??
		text[0]?.id ??
		rows[0]?.id ??
		null
	)
}

/** What the New dialog asks, and starts as each time it opens. */
export interface SamplingNewSeed {
	name: string
	shape: string
	/** The config to copy, or null for nothing switched on. */
	fromId: number | null
}

/** "Balanced copy", or "Balanced copy 2" when that is taken in the shape. */
export function uniqueCopyName(
	base: string,
	shape: string,
	rows: readonly SamplingListRow[]
): string {
	const taken = new Set(
		rows
			.filter(
				(r) => modalityOfShape(shapeOf(r)) === modalityOfShape(shape)
			)
			.map((r) => r.name.trim().toLowerCase())
	)
	let candidate = `${base} copy`
	for (let i = 2; taken.has(candidate.toLowerCase()); i++)
		candidate = `${base} copy ${i}`
	return candidate
}

/** Whether `name` is taken by another config of the shape's modality. */
export function nameTaken(
	name: string,
	shape: string,
	rows: readonly SamplingListRow[],
	exceptId?: number
): boolean {
	const wanted = name.trim().toLowerCase()
	return rows.some(
		(r) =>
			r.id !== exceptId &&
			modalityOfShape(shapeOf(r)) === modalityOfShape(shape) &&
			r.name.trim().toLowerCase() === wanted
	)
}
