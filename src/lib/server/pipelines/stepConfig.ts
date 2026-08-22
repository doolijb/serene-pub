/**
 * A pipeline node's resolved step configuration, for flows the executor does
 * not run yet.
 *
 * Two call sites — the graph builder's five steps and the history compile's
 * synthesis — still execute outside the executor, because their orchestration
 * (cast ledger, resume checkpoints; update-an-existing-entry) has not been
 * decomposed. What must NOT stay outside is the configuration: which model,
 * which sampling profile, which prompt. Those resolve here through the same
 * world and the same five-layer chain every executor-run pipeline uses, so
 * the pipeline panel's controls are real for these flows too.
 *
 * One mechanism on purpose (the `config.ts` lesson): a flow that read a
 * legacy config table while the panel wrote `pipeline_node_overrides` would
 * agree with the user on every screen and run something else.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { resolveConfigSources } from "@serene-pub/sdk"
import { buildWorld } from "./world"

type Db = { select: any }

export interface ResolvedStepConfig {
	/** The configured prompt text per declared field, where one was chosen. */
	prompts: Record<string, string>
	/** Whole rows — these callers construct their own adapters. */
	connection?: any
	sampling?: any
}

/**
 * A slot reference's row id — same acceptance as `host.ts refId`, because the
 * values come from the same config layer.
 */
const refId = (v: unknown): number | null => {
	if (typeof v === "number") return v
	if (typeof v === "string" && /^\d+$/.test(v)) return Number(v)
	if (v && typeof v === "object") {
		const inner = (v as any).ref ?? (v as any).id
		return typeof inner === "number" ? inner : null
	}
	return null
}

/**
 * Resolve the named nodes' connection, sampling and prompt fields for a spec.
 *
 * A node whose connection or sampling was never chosen resolves without one
 * and the caller falls back to the instance default — `dispatchStep`'s rule,
 * and what a person expects the first time they press the button.
 */
export async function resolveStepConfigs(
	db: Db,
	userId: number,
	specId: string,
	nodeKeys: string[]
): Promise<Record<string, ResolvedStepConfig>> {
	const world = await buildWorld(db, { userId, specId })
	const sourced: any = resolveConfigSources(world as any, nodeKeys)

	const rowById = async (table: any, id: number | null) =>
		id == null
			? undefined
			: (
					await db
						.select()
						.from(table)
						.where(eq(table.id, id))
						.limit(1)
				)[0]

	const out: Record<string, ResolvedStepConfig> = {}
	for (const nodeKey of nodeKeys) {
		const at = sourced?.[nodeKey] ?? {}
		// The prompts slot resolves per field; `world.ts` has already
		// dereferenced prompt rows into text at whichever layer won.
		const prompts: Record<string, string> = {}
		for (const [field, entry] of Object.entries(at?.prompts ?? {})) {
			const text = (entry as any)?.value
			if (typeof text === "string" && text.trim()) prompts[field] = text
		}
		out[nodeKey] = {
			prompts,
			connection: await rowById(
				schema.connections,
				refId(at?.connection?.[""]?.value)
			),
			sampling: await rowById(
				schema.samplingConfigs,
				refId(at?.sampling?.[""]?.value)
			)
		}
	}
	return out
}
