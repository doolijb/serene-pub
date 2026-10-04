/**
 * Admin › Updates — the in-app updater over sockets (CONTRACT §C5, §C11).
 *
 * Every event answers with the whole `Sockets.Updates.State`, so the section
 * renders one shape whatever happened. Progress while a download runs is
 * pushed as `updates:progress` to every admin socket that declared it — the
 * download outlives the request that started it, so it has no socket of its
 * own to answer.
 *
 * Admin only, every handler: an update replaces the whole application.
 * `updates:` is restricted interest as well (`shared/sockets/interest.ts`).
 */
import type { Handler } from "$lib/shared/events"
import { emitToInterested } from "./utils/broadcastHelpers"

function requireAdmin(socket: any): void {
	if (!socket.user?.isAdmin) throw new Error("Unauthorized")
}

type State = Sockets.Updates.State

let pushIo: any = null
let pushing = false

/** One listener per process, pushing to whichever io the last admin used. */
async function ensureProgressPush(socket: any) {
	if (socket?.io) pushIo = socket.io
	if (pushing) return
	pushing = true
	const { getUpdater } = await import("$lib/server/updater")
	const updater = await getUpdater()
	updater.onChange(() => {
		if (!pushIo) return
		try {
			emitToInterested(pushIo, "updates:progress", updater.state(), (s) => !!s.user?.isAdmin)
		} catch (err) {
			console.warn("[updates] progress not sent:", err)
		}
	})
}

async function current(): Promise<State> {
	const { getUpdater } = await import("$lib/server/updater")
	return (await getUpdater()).state()
}

function verb(
	event: string,
	act: (socket: any) => Promise<void>
): Handler<Record<string, never>, State> {
	return {
		event,
		handler: async (socket, _params, emitToUser) => {
			requireAdmin(socket)
			await ensureProgressPush(socket)
			await act(socket)
			const res = await current()
			emitToUser(event, res)
			return res
		}
	}
}

export const updatesGet = verb("updates:get", async () => {})

export const updatesDownload = verb("updates:download", async () => {
	const { getUpdater } = await import("$lib/server/updater")
	await (await getUpdater()).download()
})

export const updatesCancel = verb("updates:cancel", async () => {
	const { getUpdater } = await import("$lib/server/updater")
	;(await getUpdater()).cancel()
})

export const updatesDiscard = verb("updates:discard", async () => {
	const { getUpdater } = await import("$lib/server/updater")
	await (await getUpdater()).discard()
})

/** Writes the apply marker, answers, and the process exits 75 shortly after. */
export const updatesApply: Handler<Record<string, never>, State> = {
	event: "updates:apply",
	handler: async (socket, _params, emitToUser) => {
		requireAdmin(socket)
		const { getUpdater } = await import("$lib/server/updater")
		const updater = await getUpdater()
		await updater.apply(socket.user?.id ?? null)
		const res = updater.state()
		emitToUser("updates:apply", res)
		return res
	}
}

export function registerUpdateHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, updatesGet, emitToUser)
	register(socket, updatesDownload, emitToUser)
	register(socket, updatesCancel, emitToUser)
	register(socket, updatesDiscard, emitToUser)
	register(socket, updatesApply, emitToUser)
}
