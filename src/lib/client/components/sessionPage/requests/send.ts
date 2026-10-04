/**
 * 🚧 `send` (core only): send a line through the page's composer. Core's own
 * composer only (the askers table, `./askers.ts`): a plugin's widget writes
 * through its own actions, never as the viewer's line.
 *
 * The content becomes the composer's draft; a channel this session has
 * becomes the composer's, one it lacks is ignored; a numeric `personaId`
 * switches persona first. 🚧 `trayItemIds` are the composer's ready tray
 * items, sent as the line's attachments (composer attachments §3.1); with
 * any, an empty line is a line. A send the composer refuses (said with a
 * toast) is refused here too, and the composer keeps its draft.
 */

/** What this answer needs of the page's composer. */
export interface SendDeps {
	setDraft(content: string): void
	channels: readonly string[]
	setChannel(channel: string): void
	switchPersona(personaId: number): void
	/** Send the draft and these tray items; false when the composer refused it. */
	send(trayItemIds: string[]): boolean
}

/** The tray item ids a `send` names — strings only, de-duplicated, in order. */
export function trayItemIdsOf(raw: unknown): string[] {
	if (!Array.isArray(raw)) return []
	return [...new Set(raw.filter((id): id is string => typeof id === "string" && id.length > 0))]
}

/** Answer one `send`. */
export function answerSend(params: unknown, deps: SendDeps): void {
	const p = params as Record<string, unknown>
	deps.setDraft(String(p.content ?? ""))
	if (typeof p.channel === "string" && deps.channels.includes(p.channel)) deps.setChannel(p.channel)
	if (typeof p.personaId === "number") deps.switchPersona(p.personaId)
	// Refused (said with a toast): the composer keeps its draft.
	if (!deps.send(trayItemIdsOf(p.trayItemIds))) throw new Error("the line was not sent")
}
