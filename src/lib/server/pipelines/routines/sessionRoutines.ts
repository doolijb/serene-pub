/**
 * 🚧 **A session's routines, as host doors read them** (PLAN-layering D7,
 * R37; lane 6, 2026-10-20) — what replaced the host's task-name lookups
 * (lane 5a's ⏳ `sessions/tasks.ts` shim, retired here). A door that obeys a
 * switch reads the registration that holds it:
 *
 * | door | reads |
 * |---|---|
 * | the ruleset handler's timed expiry (`rulesets/resolve.ts`) | the duties *End what runs out*, *Track conditions* of the session's routine with a reckoning-duties step |
 * | *Mark goals reached* (`sessions/goalsReached.ts`) | the duty *Mark goals reached* of its routine with a sweep-duties step |
 * | the memory tools and their door (`tools/writeTools.ts`, `host.ts`) | the *Remember things* routine's mode (core's pipeline, as the catalogue's object) |
 *
 * Duties are found by the contract a routine's pipeline declares, never by a
 * spelled step key; each at the routine's mode (R37): a duty that is on runs
 * at it, off is off, and a routine the session does not have answers null —
 * its reader keeps its old behaviour.
 */
import { and, eq } from "drizzle-orm"
import { getDefinition, type EffectiveRegistration } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { dutyModes, isDutiesContract } from "$lib/server/pipelines/runtime/duties"

export type RoutineMode = "full" | "review" | "off"

/** The session's routine that runs `pipeline` — the first in order — or null. */
export async function sessionRoutineOf(
	db: Db,
	sessionId: number,
	pipeline: string
): Promise<EffectiveRegistration | null> {
	const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
	const resolved = await effectiveRegistrations(db, sessionId)
	return resolved?.effective.find((r) => r.trigger.family === "routine" && r.pipeline === pipeline) ?? null
}

/** A routine's mode (R37) — `full` when it states none; null when the session has no such routine. */
export async function sessionRoutineMode(db: Db, sessionId: number, pipeline: string): Promise<RoutineMode | null> {
	const reg = await sessionRoutineOf(db, sessionId, pipeline)
	return reg ? (reg.mode ?? "full") : null
}

/** A pipeline's duties step — its key and contract — read off its published document, never spelled. */
async function dutiesStepOf(db: Db, pipeline: string): Promise<{ node: string; contract: string } | null> {
	const { loadPublished } = await import("$lib/server/pipelines/boot/bootstrap")
	const doc = await loadPublished(db, pipeline)
	for (const n of (doc?.nodes ?? []) as Array<{ key: string; definitionId: string; definitionVersion: number }>) {
		const contract = `${n.definitionId}@${n.definitionVersion}`
		if (isDutiesContract(contract)) return { node: n.key, contract }
	}
	return null
}

/**
 * A duties step's params in this session: its contract's declared defaults <
 * the registration's values (genre ⊕ preset ⊕ the session's own rows) < ⏳ a
 * session override from before registrations (`pipeline_node_overrides`).
 */
export async function dutyParamsOf(
	db: Db,
	sessionId: number,
	reg: EffectiveRegistration,
	at: { node: string; contract: string }
): Promise<Record<string, unknown>> {
	const declared =
		(getDefinition(at.contract) as { slots?: Record<string, { schema?: Record<string, { default?: unknown }> }> } | undefined)
			?.slots?.params?.schema ?? {}
	const out: Record<string, unknown> = {}
	for (const [k, d] of Object.entries(declared)) out[k] = d?.default
	const fromValues = (reg.values?.[at.node] as Record<string, unknown> | undefined)?.params
	if (fromValues && typeof fromValues === "object") Object.assign(out, fromValues)
	const [spec] = await db
		.select({ id: schema.pipelineSpecs.id })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, reg.pipeline))
		.limit(1)
	if (spec) {
		const rows = await db
			.select({ path: schema.pipelineNodeOverrides.path, value: schema.pipelineNodeOverrides.value })
			.from(schema.pipelineNodeOverrides)
			.where(
				and(
					eq(schema.pipelineNodeOverrides.specId, spec.id),
					eq(schema.pipelineNodeOverrides.scopeKind, "session"),
					eq(schema.pipelineNodeOverrides.scopeId, sessionId),
					eq(schema.pipelineNodeOverrides.nodeKey, at.node),
					eq(schema.pipelineNodeOverrides.slot, "params")
				)
			)
		for (const r of rows as Array<{ path: string | null; value: unknown }>) if (r.path) out[r.path] = r.value
	}
	return out
}

/**
 * The duty modes of the session's routine whose duties step is `contract`
 * (`core:task/reckoning-duties@1`, …) — the first such routine, in order —
 * each duty at the routine's mode, or `off`. Null when the session has none:
 * found by what the pipeline declares, so a package's reckoning answers as
 * core's does.
 */
export async function sessionDutiesOf(
	db: Db,
	sessionId: number,
	contract: string
): Promise<Record<string, RoutineMode> | null> {
	const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
	const resolved = await effectiveRegistrations(db, sessionId)
	for (const reg of resolved?.effective ?? []) {
		if (reg.trigger.family !== "routine") continue
		const at = await dutiesStepOf(db, reg.pipeline)
		if (!at || at.contract !== contract) continue
		const params = await dutyParamsOf(db, sessionId, reg, at)
		return dutyModes(at.contract, params, { mode: reg.mode ?? "full" }).modes
	}
	return null
}

/**
 * 🚧 **The mode the session's reply carries changes at** (PLAN-genres-seams
 * S2, ★B, 2026-10-23): the reply that answers a message in this session
 * (its registrations on `message-respond` whose `when` holds), read off the
 * first whose pipeline has a reply-duties step — `full` while its `changes`
 * duty (*Replies carry changes*) is on, else `off`. An event registration
 * carries no mode (R37), so on is Full. What the reckoning's duties step
 * reads (`dutyModes`' facts), so *Keep the sheets* and *Track conditions*
 * step aside while the reply files what the scene changed.
 */
export async function sessionReplyChangesMode(db: Db, sessionId: number): Promise<RoutineMode> {
	const { registrationsOn } = await import("$lib/server/pipelines/registrations/resolve")
	const { sessionEvents } = await import("@serene-pub/sdk")
	const C = await import("@serene-pub/contracts")
	const { run } = await registrationsOn(db, sessionId, sessionEvents.messageRespond)
	for (const reg of run) {
		const at = await dutiesStepOf(db, reg.pipeline)
		if (!at || at.contract !== C.replyDuties.id) continue
		const params = await dutyParamsOf(db, sessionId, reg, at)
		return dutyModes(at.contract, params, null).modes["reply-changes"] ?? "off"
	}
	return "off"
}

/**
 * The duty modes of the session's routine that runs `pipeline` — each duty
 * at the routine's mode, or `off` — keyed as its duties step publishes them
 * (`timed-expiry`, `goal-reached`, …). Null when the session has no such
 * routine (or its pipeline has no duties step).
 */
export async function sessionRoutineDuties(
	db: Db,
	sessionId: number,
	pipeline: string
): Promise<Record<string, RoutineMode> | null> {
	const reg = await sessionRoutineOf(db, sessionId, pipeline)
	if (!reg) return null
	const at = await dutiesStepOf(db, reg.pipeline)
	if (!at) return null
	const params = await dutyParamsOf(db, sessionId, reg, at)
	return dutyModes(at.contract, params, { mode: reg.mode ?? "full" }).modes
}
