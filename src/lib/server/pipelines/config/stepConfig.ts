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
import { buildWorld } from "$lib/server/pipelines/config/world"
import { withCompletionTemplate } from "$lib/server/connections/completionTemplates"
import { withWireMode } from "$lib/server/connections/resolve"
import {
	connectionModelById,
	mergeEndpointModel
} from "$lib/server/connections/models"
import { slotModelId } from "$lib/shared/connections/slotRef"

export interface ResolvedStepConfig {
	/** The configured prompt text per declared field, where one was chosen. */
	prompts: Record<string, string>
	/** Whole rows — these callers construct their own adapters. */
	connection?: AdapterConnection
	/**
	 * The sampling ROW, deliberately not a `ResolvedSampling` (0171). These
	 * callers still need the row itself — its name labels the LLM queue entry —
	 * and each resolves it with `resolveSampling()` at the one point it builds
	 * an adapter, which is where "already resolved" has to be true.
	 */
	sampling?: SelectSamplingConfig
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
	specId: string,
	nodeKeys: string[]
): Promise<Record<string, ResolvedStepConfig>> {
	const world = await buildWorld(db, { specId })
	const sourced: any = resolveConfigSources(world as any, nodeKeys)

	/**
	 * The two reads, spelled per table — mirroring
	 * `connections/capabilityTarget.ts`, whose header gives the reason at
	 * length. One `(table: any, id) => any` helper stood here instead, and it
	 * was the hole in miniature: `any` in, `any` out, so `connection` below was
	 * an `any` for the whole function (every field read off it, and the row
	 * handed to `withCompletionTemplate`/`withWireMode`) and `sampling` was an
	 * `any` satisfying `SelectSamplingConfig` by construction rather than by
	 * checking. Two three-line reads cost less than that.
	 */
	const connectionById = async (id: number | null) =>
		id == null
			? undefined
			: (
					await db
						.select()
						.from(schema.connections)
						.where(eq(schema.connections.id, id))
						.limit(1)
				)[0]

	const samplingConfigById = async (id: number | null) =>
		id == null
			? undefined
			: (
					await db
						.select()
						.from(schema.samplingConfigs)
						.where(eq(schema.samplingConfigs.id, id))
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
		const slot = at?.connection?.[""]?.value
		const connection = await connectionById(refId(slot))
		/**
		 * The MODEL half of the slot's pair (0114), merged onto the row before
		 * anything else touches it.
		 *
		 * ⚠ Merged HERE and not later, because `withCompletionTemplate` reads
		 * `promptFormat` and `withWireMode` reads the capability column, and both
		 * of those are the model's answers once a pair has been formed. Merging
		 * after either would dereference the endpoint's template for a model that
		 * overrides it — the failure `withCompletionTemplate`'s own header
		 * describes, arriving by a new route.
		 *
		 * A slot naming a model that has gone, or that belongs to another
		 * endpoint, resolves WITHOUT it here rather than refusing
		 * the way `resolveCapabilityTarget` does. These two callers are the graph
		 * builder and the history compile: neither has a refusal channel a person
		 * ever sees — `resolveStepConfigs` returns configuration, not a verdict —
		 * so a throw would surface as an unexplained failure mid-build. The
		 * resolver refuses because it CAN say why; this degrades because it
		 * cannot. There is no fallback to any "default" — connections have
		 * none — so a model-less pair merges to the endpoint alone, exactly as
		 * an endpoint with no models at all does.
		 */
		const modelId = slotModelId(slot)
		let model: SelectConnectionModel | undefined
		if (connection) {
			const named =
				modelId == null
					? undefined
					: await connectionModelById(db, modelId)
			model =
				named && named.connectionId === connection.id ? named : undefined
		}
		out[nodeKey] = {
			prompts,
			/**
			 * With its completion template and its wire mode attached, same as
			 * `resolveCapabilityTarget` does for the tier underneath this one —
			 * these two are the only places a connection bound for a text
			 * adapter is loaded, and a row that arrived by one path and not the
			 * other would stop generation on the default's markers for every
			 * admin-authored template, or be handed a payload built for the other
			 * wire shape. See `AdapterConnection`.
			 */
			connection:
				connection &&
				withWireMode(
					await withCompletionTemplate(
						db,
						mergeEndpointModel(connection, model)
					)
				),
			sampling: await samplingConfigById(refId(at?.sampling?.[""]?.value))
		}
	}
	return out
}
