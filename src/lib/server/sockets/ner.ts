/**
 * The entity lane's one question: what is starred, is it up, and how much is
 * annotated.
 *
 * ⚠ One handler, and the absences are the design. There is no `enable`, no
 * `setModel`, no `loadModel` and no `startQueue` here: an entity backend is an
 * ordinary connection, so creating and editing one is
 * `connections:create`/`update`, choosing which one runs is
 * `connections:setDefault`, and the consequence of moving that star is
 * `applyNerStarChange` inside that handler rather than a button of its own. The
 * annotation lane needs no start control at all — it is unconditionally enabled,
 * because the lexical tier costs a regex.
 *
 * The count rides here rather than on an event of its own (the embedding side
 * has a separate `vectorization:reindexCost`) because this event is NOT polled:
 * it is asked on panel mount and again before the switch confirmation, which are
 * exactly the two moments the count is wanted.
 */

import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"
import { resolveNerTarget } from "$lib/server/ner/target"
import { nerReannotateCost } from "$lib/server/ner/reindex"
import {
	getLoadedNerModelId,
	getNerLastUsedAt,
	getNerLoadError,
	getNerTtlMinutes,
	unloadNerModel
} from "$lib/server/ner"

/**
 * The one question, plus the three residency facts an Unload button needs
 * beside it.
 *
 * ⚠ `modelReady` and `loaded` are DIFFERENT and both are here. `modelReady` is
 * star-compared — a model left resident from a previous star is not this
 * connection being up. `loaded` is bare residency — that same model is still
 * occupying memory and is still what Unload would free.
 */
async function buildNerStatus(): Promise<Sockets.Ner.Status.Response> {
	const target = await resolveNerTarget(db)
	const { rows } = await nerReannotateCost(db)
	return {
		starred: target !== null,
		modelId: target?.modelId ?? null,
		modelReady: target !== null && getLoadedNerModelId() === target.modelId,
		loadError: getNerLoadError(),
		annotatedRows: rows,
		loaded: getLoadedNerModelId() !== null,
		lastUsedAt: getNerLastUsedAt(),
		// The starred connection's own window when there is one, and the value
		// the lane is armed with otherwise — the order the loader applies them.
		ttlMinutes: target?.ttlMinutes ?? getNerTtlMinutes()
	}
}

export const nerStatus: Handler<
	Sockets.Ner.Status.Params,
	Sockets.Ner.Status.Response
> = {
	event: "ner:status",
	handler: async (socket, _params, emitToUser) => {
		// Connections are admin-only everywhere else, and this reports which one
		// is starred and why it failed to load.
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const res = await buildNerStatus()
		emitToUser("ner:status", res)
		return res
	}
}

/**
 * Free the entity model now.
 *
 * ⚠ The lane is NOT stopped. Annotation is unconditionally enabled and the
 * broker loads on demand, exactly as it does after an idle timeout — a queue
 * never owns model lifecycle. The next row that needs a model gets one.
 */
export const nerUnloadModel: Handler<
	Sockets.Ner.UnloadModel.Params,
	Sockets.Ner.UnloadModel.Response
> = {
	event: "ner:unloadModel",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		unloadNerModel("by request")
		const res = await buildNerStatus()
		emitToUser("ner:unloadModel", res)
		return res
	}
}

export function registerNerHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, nerStatus, emitToUser)
	register(socket, nerUnloadModel, emitToUser)
}
