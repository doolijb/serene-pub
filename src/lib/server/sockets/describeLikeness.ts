/**
 * 🚧 **Describe from image** — the Likeness tab's socket
 * (DESIGN-image-generation §5; follow-up D1).
 *
 * `characters:describeLikeness`, the card's owner or an admin:
 *
 *  - `{ characterId, probe: true }` answers `{ available }` only — whether a
 *    model that reads pictures is set up, so the tab knows to show the
 *    button. Nothing runs.
 *  - `{ characterId, imageMediaId? }` runs `core:spec/describe-likeness`
 *    and answers `{ available: true, prompt }` — the tag line for the
 *    Likeness prompt field. Nothing is saved. Stop is the ordinary
 *    `pipelines:cancelRun` with the run id.
 *
 * Every reply and error carries `characterId` top-level (SCOPED on it).
 */

import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"

export const charactersDescribeLikeness: Handler<
	Sockets.Characters.DescribeLikeness.Params,
	Sockets.Characters.DescribeLikeness.Response
> = {
	event: "characters:describeLikeness",
	handler: async (socket, params, emitToUser) => {
		const characterId = params.characterId
		try {
			const userId = socket.user!.id
			const { mayFillSprites } = await import("$lib/server/sprites/attach")
			if (!(await mayFillSprites(db, userId, characterId)))
				throw new Error(
					"Only the card's owner or an admin can describe its likeness."
				)
			const { describeLikeness, describeLikenessAvailable } = await import(
				"$lib/server/characters/describeLikeness"
			)
			if (params.probe) {
				const res = {
					characterId,
					available: await describeLikenessAvailable(db)
				}
				emitToUser("characters:describeLikeness", res)
				return res
			}
			const { v4: uuidv4 } = await import("uuid")
			const runId =
				typeof params.runId === "string" && params.runId ? params.runId : uuidv4()
			const runRegistry = await import("$lib/server/pipelines/runtime/runRegistry")
			const { DESCRIBE_LIKENESS_SPEC_ID } = await import("@serene-pub/core-catalog")
			const handle = runRegistry.start({
				runId,
				userId,
				specId: DESCRIBE_LIKENESS_SPEC_ID,
				kind: "action"
			})
			let prompt: string
			try {
				prompt = await describeLikeness(db, {
					characterId,
					userId,
					imageMediaId:
						params.imageMediaId === null
							? null
							: typeof params.imageMediaId === "number"
								? params.imageMediaId
								: undefined,
					runId,
					signal: handle.controller.signal,
					cancelSignal: () => runRegistry.cancellation(handle)
				})
			} finally {
				runRegistry.finish(runId)
			}
			const res = { characterId, available: true, prompt, runId }
			emitToUser("characters:describeLikeness", res)
			return res
		} catch (error: any) {
			emitToUser("characters:describeLikeness:error", {
				error: error?.message || "Could not describe the picture.",
				characterId
			})
			throw error
		}
	}
}

export function registerDescribeLikenessHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, charactersDescribeLikeness, emitToUser)
}
