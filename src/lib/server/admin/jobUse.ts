/**
 * How this pub uses each job: which ones it NEEDS a model for, and where the
 * pipeline library places the steps that ask for them.
 *
 * ## Needed is a fact about this pub, not about the catalog
 *
 * `demanded` (`combos.ts`) says some node definition requires a job. That is
 * true of image generation on every pub, because the Chat genre ships an Image
 * action, so keying "Needed" on it put a red word on a text-only pub nobody
 * had asked to draw on, while the Overview said nothing needed you (plan
 * less-confusing C1/C2, owner ruling 2026-10-11). A job is **needed** when:
 *
 *   - it is chat (`replies`): every session reply runs on it, from the first
 *     one, so it is needed before anything has run. Gold until set (owner
 *     ruling 2026-10-06) is about its colour, not whether it is needed.
 *   - a step that requires it failed in a real run (`failedRun`): not a
 *     preview, within `NEEDED_WINDOW_MS`. Somebody pressed the button and it
 *     refused. The window lets one attempt age out rather than pin a row to
 *     Needs you for good.
 *
 * Any other unset job is **Off**: the pub runs without it, and the Defaults
 * row says what would use it. The Overview's Models card, its Needs you
 * items, the rail's dot and the Defaults screen all read this one set.
 *
 * `neededJobs` is the judgement and is pure; the two readers gather its
 * inputs.
 */

import { and, eq, gte, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { i18nTextIn } from "$lib/shared/i18n/i18nText"
import {
	NEEDED_WINDOW_DAYS,
	type ComboRow
} from "$lib/shared/capabilities/combos"

type NeededBecause = Sockets.ConnectionDefaults.List.NeededBecause
type JobUse = Sockets.ConnectionDefaults.List.JobUse

/** The job every session reply runs on. */
export const CHAT_JOB = "text->text"

/** How long a failed attempt keeps a job needed. */
export const NEEDED_WINDOW_MS = NEEDED_WINDOW_DAYS * 24 * 60 * 60 * 1000

/** A step's node definition as a run's receipt records it: `id@version`. */
const definitionKey = (site: { definitionId: string; version: number }) =>
	`${site.definitionId}@${site.version}`

/**
 * Which jobs are needed, and why. Pure.
 *
 * `failedDefinitions` holds `id@version` keys of node definitions a real run
 * recently failed in. Only `requiredBy` counts: a step that merely prefers a
 * job runs without it.
 */
export function neededJobs(
	combos: readonly Pick<ComboRow, "id" | "demanded" | "requiredBy">[],
	failedDefinitions: ReadonlySet<string>
): Record<string, NeededBecause> {
	const out: Record<string, NeededBecause> = {}
	for (const c of combos) {
		if (!c.demanded) continue
		if (c.id === CHAT_JOB) out[c.id] = "replies"
		else if (c.requiredBy.some((s) => failedDefinitions.has(definitionKey(s))))
			out[c.id] = "failedRun"
	}
	return out
}

/**
 * The node definitions (`id@version`) that failed in a real run since
 * `since`. Limited to the ones that require some job, so the read stays as
 * narrow as the question.
 */
export async function readFailedDefinitions(
	database: Db,
	combos: readonly Pick<ComboRow, "requiredBy">[],
	since: Date
): Promise<Set<string>> {
	const asked = [
		...new Set(combos.flatMap((c) => c.requiredBy.map(definitionKey)))
	]
	if (!asked.length) return new Set()
	const rows = await database
		.selectDistinct({ definitionId: schema.pipelineRunNodes.definitionId })
		.from(schema.pipelineRunNodes)
		.innerJoin(
			schema.pipelineRuns,
			eq(schema.pipelineRuns.id, schema.pipelineRunNodes.runId)
		)
		.where(
			and(
				eq(schema.pipelineRunNodes.result, "err"),
				eq(schema.pipelineRuns.isPreview, false),
				gte(schema.pipelineRuns.startedAt, since),
				inArray(schema.pipelineRunNodes.definitionId, asked)
			)
		)
	return new Set(rows.map((r) => r.definitionId))
}

/** The needed jobs, read now. */
export async function readNeededJobs(
	database: Db,
	combos: readonly Pick<ComboRow, "id" | "demanded" | "requiredBy">[],
	now = Date.now()
): Promise<Record<string, NeededBecause>> {
	const failed = await readFailedDefinitions(
		database,
		combos,
		new Date(now - NEEDED_WINDOW_MS)
	)
	return neededJobs(combos, failed)
}

/**
 * Where the pipeline library places each job's steps: how many steps ask for
 * it (required or preferred), in which pipelines, and the actions those
 * pipelines offer. Read off each pipeline's ACTIVE version; a disabled
 * plugin's pipelines are left out, as the library list leaves them out.
 *
 * Steps, not node definitions: one definition is placed as many steps
 * (NOMENCLATURE §4), and "Used by N pipeline steps" counts placements.
 */
export async function readJobUse(
	database: Db,
	combos: readonly Pick<ComboRow, "id" | "requiredBy" | "optionalFor">[]
): Promise<Record<string, JobUse>> {
	const rows = await database
		.select({
			definitionId: schema.pipelineNodes.definitionId,
			definitionVersion: schema.pipelineNodes.definitionVersion,
			specId: schema.pipelineSpecs.id,
			specName: schema.pipelineSpecs.name,
			sourcePluginId: schema.pipelineSpecs.sourcePluginId,
			contributes: schema.pipelineSpecVersions.contributes
		})
		.from(schema.pipelineNodes)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecs.activeVersionId, schema.pipelineNodes.specVersionId)
		)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.id, schema.pipelineNodes.specVersionId)
		)
	const { disabledPlugins } = await import("$lib/server/plugins/disabledPlugins")
	const off = await disabledPlugins(database)
	const placed = rows.filter((r) => !off.owns(r.sourcePluginId))

	const out: Record<string, JobUse> = {}
	for (const combo of combos) {
		const keys = new Set(
			[...combo.requiredBy, ...combo.optionalFor].map(definitionKey)
		)
		const steps = placed.filter((r) =>
			keys.has(`${r.definitionId}@${r.definitionVersion}`)
		)
		const pipelines = new Map<number, string>()
		const actions = new Set<string>()
		for (const s of steps) {
			pipelines.set(s.specId, s.specName)
			const declared = (s.contributes as { actions?: unknown[] } | null)
				?.actions
			for (const a of declared ?? []) {
				const action = a as { key?: unknown; label?: unknown }
				const label =
					i18nTextIn(action.label) ??
					(typeof action.key === "string" ? action.key : undefined)
				if (label) actions.add(label)
			}
		}
		out[combo.id] = {
			steps: steps.length,
			pipelines: [...pipelines.values()],
			actions: [...actions]
		}
	}
	return out
}
