/**
 * Why a star may not be pressed: the ONE judgement every door that registers
 * an instance-wide active connection asks before it writes.
 *
 * Two socket handlers move a star: `connections:setDefault` (the Connections
 * view's star, Use and Make active, and the Ollama and KoboldCPP one-click
 * paths that forward to it) and `connectionDefaults:set` (Admin → Defaults).
 * Neither keeps a copy of these checks. A choice one screen refuses and
 * another accepts is a registration that fails every run it names, so both
 * handlers ask this function and only their wording of the answer (which
 * events carry it) is their own.
 *
 * The checks, in order — each later one assumes the earlier ones passed:
 *
 *   1. the connection exists;
 *   2. a local ONNX connection needs a machine that can load the runtime —
 *      asked before the model, because a model's own state is moot where
 *      nothing can run it;
 *   3. a MODEL is named — connections have no default model, so "the
 *      endpoint, whichever model" is not a registration;
 *   4. the model exists, belongs to that connection, is switched on, and is
 *      still listed by its host (`missing_since`);
 *   5. a local ONNX model has its files on this disk — nothing fetches them on
 *      use, so one that isn't downloaded points every embed or scan at
 *      nothing;
 *   6. the PAIR can do the capability (`capabilityRefusal` over
 *      `mergeEndpointModel`, the merge the resolver performs), so the screen
 *      and the run agree about what was registered.
 *
 * Clearing a star (`connectionId: null`) is never judged: it names no
 * connection, and refusing to un-star would be a trap. A person can always
 * switch away.
 *
 * ⚠ Judgement only. The write, and the consequence of the star it moves
 * (`withStarConsequences`), stay with the caller: Admin → Defaults writes the
 * sampling half through the same handler, which this function has no say in.
 */

import type { CapabilityId } from "@serene-pub/sdk"
import { capabilityRefusal } from "$lib/server/pipelines/runtime/capabilityGuard"
import {
	localModelState,
	onnxModalityOf
} from "$lib/server/localModels/onnxCache"
import { localOnnxRefusal } from "$lib/server/localModels/onnxRuntime"
import { connectionModelById, mergeEndpointModel } from "./models"

/** The registration a door is about to write, as the two handlers name it. */
export interface StarChoice {
	/** A `CapabilityId` — in practice always a transform id. */
	capability: string
	/** The endpoint. `null` clears the star, and is never refused. */
	connectionId: number | null
	/** The model on that endpoint; required whenever `connectionId` is set. */
	connectionModelId?: number | null
}

/** The sentence a door answers with, or null where the star may be pressed. */
export async function starRefusal(
	db: Db,
	choice: StarChoice
): Promise<string | null> {
	const { connectionId, connectionModelId } = choice
	if (connectionId == null) return null

	const row = await db.query.connections.findFirst({
		where: (c, { eq }) => eq(c.id, connectionId),
		columns: {
			id: true,
			name: true,
			type: true,
			// The merge resolves capabilities through the preset too, so the
			// pair is judged in the same key space the pickers greyed it in.
			preset: true,
			capabilities: true
		}
	})
	if (!row) return "Connection not found."

	const onnx = onnxModalityOf(row.type) != null
	if (onnx) {
		const unrunnable = await localOnnxRefusal()
		if (unrunnable) return unrunnable
	}

	if (connectionModelId == null)
		return "Choose a model on this connection — connections have no default model."
	const model = await connectionModelById(db, connectionModelId)
	if (!model) return "That model no longer exists."
	if (model.connectionId !== connectionId)
		return "That model is not on the connection you chose."
	if (!model.enabled)
		return "That model is switched off. Switch it on, or choose another."
	if (model.missingSince)
		return "That model is no longer listed by its host. Refresh the connection's models, or choose another."

	// Every other endpoint's models are a host's, and `localModelState`
	// answers null for them.
	if (onnx) {
		const local = await localModelState(db, row, model)
		if (local && local.state !== "on_disk")
			return local.state === "downloading"
				? "That model is still downloading. Make it active once it has finished."
				: "That model isn't downloaded yet. Download it first, then make it active."
	}

	// Judged as the PAIR (0114): one host serves a vision checkpoint and a
	// text-only one at the same base URL, so judging the bare endpoint would
	// star the text-only one for vision and fail at the first image.
	return capabilityRefusal(
		mergeEndpointModel(row as any, model) as any,
		choice.capability as CapabilityId
	)
}
