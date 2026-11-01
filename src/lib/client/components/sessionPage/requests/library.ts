import type { WidgetRequests } from "@serene-pub/sdk"
import { v4 as uuid } from "uuid"
import { awaitReply } from "$lib/client/utils/awaitReply"
import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

/**
 * 🚧 M2c: the applet API's library requests — the person's characters,
 * lorebooks and sessions as the asking package may see them, and its two
 * writes. Modelled on `userAnnex.ts`: the owner is the frame's own
 * (`from.owner`); the server resolves the person from the socket and judges
 * the grant (`openAppletDoor` + `personMay`, S's handlers; briefs/m2-S-to-U.md
 * §7). Each socket replies `{ requestId, pluginId, result }` on its own event
 * and refuses on `<event>:error { error, requestId, pluginId }`.
 */
function ask(event: string, params: unknown, from: { owner: string }): Promise<any> {
	if (from.owner === "core")
		throw new Error("Only an extension's own frames read the person's library.")
	const requestId = uuid()
	return awaitReply({
		socket: useTypedSocket(),
		event: event as any,
		errorEvent: `${event}:error` as any,
		params: { ...(params as object), pluginId: from.owner, requestId } as any,
		match: (r: any) => r?.requestId === requestId,
		matchError: (e) => (e as { requestId?: string } | null)?.requestId === requestId,
		timeoutMs: 30_000
	}).then((res: any) => res.result)
}

type Req<K extends keyof WidgetRequests> = WidgetRequests[K]

export const answerLibraryCharacters = (p: Req<"library-characters">["params"], from: { owner: string }): Promise<Req<"library-characters">["result"]> =>
	ask("appletApi:libraryCharacters", p, from)

export const answerUpdateCharacter = (p: Req<"update-character">["params"], from: { owner: string }): Promise<Req<"update-character">["result"]> =>
	ask("appletApi:updateCharacter", p, from)

export const answerLibraryLorebooks = (p: Req<"library-lorebooks">["params"], from: { owner: string }): Promise<Req<"library-lorebooks">["result"]> =>
	ask("appletApi:libraryLorebooks", p, from)

export const answerLibrarySessions = (p: Req<"library-sessions">["params"], from: { owner: string }): Promise<Req<"library-sessions">["result"]> =>
	ask("appletApi:librarySessions", p, from)

export const answerUpdateSession = (p: Req<"update-session">["params"], from: { owner: string }): Promise<Req<"update-session">["result"]> =>
	ask("appletApi:updateSession", p, from)
