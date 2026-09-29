/**
 * 🚧 `set-sprite-set` (R21): core's scene portraits show a character in
 * another of its card's sprite sets, for this session only — the page's own
 * `sessions:setSpriteSet`, the write the native widget emitted itself. Core's
 * widgets only (the askers table, `./askers.ts`).
 *
 * What this answer adds over the socket:
 *  - it is judged against the `characters.v1` the widget was shown (R77): a
 *    member whose `canChangeSpriteSet` is false is refused here, in words,
 *    before anything is sent — the same rule the server holds, so the menu
 *    is offered only where the write will land;
 *  - a set the card does not have is refused by name;
 *  - the server's own refusal is this request's rejection, never a page-wide
 *    toast (R77: per-widget errors).
 *
 * Resolves once the server has written it; the new set arrives as a
 * `characters` push (every member hears `sessions:spriteSetChanged`), never
 * in the reply.
 */
import type { SessionCharactersV1, WidgetRequests } from "@serene-pub/sdk"
import type { PendingAsks } from "./pendingAsks"

type Params = WidgetRequests["set-sprite-set"]["params"]

/** The page's write: sends `sessions:setSpriteSet` and settles on its reply. */
export type SpriteSetWrite = (ask: {
	sessionId: number
	characterId: number
	set: string | null
}) => Promise<void>

/**
 * Answer one `set-sprite-set` for the page's session `sessionId`, judged
 * against the cast the page projects (`characters`).
 */
export async function answerSetSpriteSet(
	params: unknown,
	characters: SessionCharactersV1 | undefined,
	sessionId: number | null,
	write: SpriteSetWrite
): Promise<void> {
	const p = (params ?? {}) as Partial<Record<keyof Params, unknown>>
	if (typeof p.characterId !== "number" || !Number.isInteger(p.characterId))
		throw new Error("set-sprite-set needs a characterId")
	if (p.set !== null && typeof p.set !== "string")
		throw new Error("set-sprite-set takes a set's name, or null for the card's own")
	if (sessionId == null || !characters) throw new Error("this session's cast has not loaded yet")
	const member = characters.members.find((m) => m.characterId === p.characterId)
	if (!member) throw new Error("that character is not in this session")
	if (member.isPersona)
		throw new Error(`${member.name} is a persona: a session switches its characters' sprite sets only`)
	if (!member.canChangeSpriteSet)
		throw new Error(`only the session's owner or ${member.name}'s owner can change ${member.name}'s sprite set`)
	const set = typeof p.set === "string" ? p.set.trim() || null : null
	if (set !== null && !member.spriteSets.includes(set))
		throw new Error(`${member.name} has no sprite set named "${set}"`)
	await write({ sessionId, characterId: member.characterId, set })
}

/**
 * The reply's key (`../requests/pendingAsks.ts`): one ask per session and
 * character, oldest first — the reply names both and nothing more.
 */
export const spriteSetReplyKey = (reply: { sessionId: number; characterId: number }): string =>
	`${reply.sessionId}:${reply.characterId}`

type SpriteSetAsks = PendingAsks<Sockets.Sessions.SetSpriteSet.Params, Sockets.Sessions.SetSpriteSet.Response>

/**
 * The page's write over its pending-asks table: waits under the reply's own
 * key and turns the server's refusal into this request's rejection.
 */
export const spriteSetWrite =
	(asks: SpriteSetAsks): SpriteSetWrite =>
	async (ask) => {
		const reply = await asks.ask(spriteSetReplyKey(ask), ask)
		if (reply.error) throw new Error(reply.error)
	}

/**
 * The page's standing `sessions:setSpriteSet` listener: a reply a widget's
 * ask waits on is that widget's, refusal included (R77), and is never also
 * a toast; a refusal nobody here asked for (the page's own sprite menu, for
 * this session) is toasted.
 */
export function settleSpriteSetReply(
	reply: Sockets.Sessions.SetSpriteSet.Response,
	asks: SpriteSetAsks,
	sessionId: number | null | undefined,
	toast: (error: string) => void
): void {
	if (asks.deliver(reply)) return
	if (reply.sessionId !== sessionId || !reply.error) return
	toast(reply.error)
}
