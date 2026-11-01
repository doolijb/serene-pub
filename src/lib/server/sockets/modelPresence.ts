/**
 * 🚧 `models:presence` — which runtimes already hold a model file, so the
 * finder can say "You have this on KoboldCPP" on every row. Admin only
 * (members never touch model plumbing). Failures arrive on the reply's own
 * `error`, as `models:refreshSpeech` does. Also answers
 * `models:machineHardware` (this computer's graphics card and memory).
 */
import type { Handler } from "$lib/shared/events"
import { db } from "$lib/server/db"
import {
	MAX_PRESENCE_QUERIES,
	modelPresence
} from "$lib/server/connections/modelPresence"

export const modelsPresence: Handler<
	Sockets.Models.Presence.Params,
	Sockets.Models.Presence.Response
> = {
	event: "models:presence",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const msg =
				"Access denied. Only admin users can see where models are."
			emitToUser("models:presence:error", { error: msg })
			throw new Error(msg)
		}
		const queries = Array.isArray(params?.queries) ? params.queries : []
		let res: Sockets.Models.Presence.Response
		if (queries.length > MAX_PRESENCE_QUERIES) {
			res = {
				results: [],
				error: `Ask about at most ${MAX_PRESENCE_QUERIES} models at a time.`
			}
		} else {
			try {
				res = { results: await modelPresence(db as any, queries) }
			} catch (error: any) {
				console.error("Model presence error:", error)
				res = {
					results: [],
					error: "Could not check where models are."
				}
			}
		}
		emitToUser("models:presence", res)
		return res
	}
}

export const modelsMachineHardware: Handler<
	Sockets.Models.MachineHardware.Params,
	Sockets.Models.MachineHardware.Response
> = {
	event: "models:machineHardware",
	handler: async (socket, _params, emitToUser) => {
		let res: Sockets.Models.MachineHardware.Response
		if (!socket.user!.isAdmin) {
			res = {
				hardware: null,
				error: "Access denied. Only admin users can see this computer's hardware."
			}
		} else {
			try {
				const { machineHardware } = await import(
					"$lib/server/connections/hardware"
				)
				res = { hardware: await machineHardware() }
			} catch (error: any) {
				console.error("Machine hardware error:", error)
				res = {
					hardware: null,
					error: "Could not read this computer's hardware."
				}
			}
		}
		emitToUser("models:machineHardware", res)
		return res
	}
}

export function registerModelPresenceHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, modelsPresence, emitToUser)
	register(socket, modelsMachineHardware, emitToUser)
}
