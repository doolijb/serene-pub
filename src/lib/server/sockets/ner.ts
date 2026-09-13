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
import { getLoadedNerModelId, getNerLoadError } from "$lib/server/ner"

export const nerStatus: Handler<
	Sockets.Ner.Status.Params,
	Sockets.Ner.Status.Response
> = {
	event: "ner:status",
	handler: async (socket, _params, emitToUser) => {
		// Connections are admin-only everywhere else, and this reports which one
		// is starred and why it failed to load.
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const target = await resolveNerTarget(db)
		const { rows } = await nerReannotateCost(db)
		const res: Sockets.Ner.Status.Response = {
			starred: target !== null,
			modelId: target?.modelId ?? null,
			// Compared against the STAR rather than reported bare: a model left
			// resident from a previous star is not this connection being up.
			modelReady:
				target !== null && getLoadedNerModelId() === target.modelId,
			loadError: getNerLoadError(),
			annotatedRows: rows
		}
		emitToUser("ner:status", res)
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
}
