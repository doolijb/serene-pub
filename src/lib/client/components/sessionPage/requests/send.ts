/**
 * 🚧 `send`: send a line through the page's composer. Core's own composer,
 * or 🚧 a plugin's widget holding the write grant on the channel it names
 * (D4, ruled Q2: `channel:<slug>:write`, one of its declared channels — the
 * askers table, `./askers.ts`). A plugin's line is held tighter than core's:
 * it must name a channel this session has (never falls back to the
 * composer's), goes as the viewer's current persona (switching is core's,
 * `switch-persona`), and carries no tray items (the viewer's uploads are
 * core's to send, `attach-files`).
 *
 * The content becomes the composer's draft; a channel this session has
 * becomes the composer's, one it lacks is ignored; a numeric `personaId`
 * switches persona first. 🚧 `trayItemIds` are the composer's ready tray
 * items, sent as the line's attachments (composer attachments §3.1); with
 * any, an empty line is a line. A send the composer refuses (said with a
 * toast) is refused here too, and the composer keeps its draft.
 */

import { formatChannel, parseChannel } from "@serene-pub/sdk"
import { holdsWidgetGrant } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

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

/**
 * The channel a `send` names, canonical, when it is a lane of one of this
 * session's channels (`parley:2` is a lane of `parley`; lane 1 is the bare
 * slug), else null. The session's channels are declared slugs; their lanes
 * are runtime and never listed (ruling 2026-09-09).
 */
export function sessionChannelOf(raw: unknown, channels: readonly string[]): string | null {
	if (typeof raw !== "string" || !raw.trim()) return null
	const ref = parseChannel(raw)
	if (ref.warning || !channels.some((c) => parseChannel(c).slug === ref.slug)) return null
	return formatChannel(ref)
}

/** Answer one `send`, from `from` (absent: core's own composer). */
export function answerSend(params: unknown, deps: SendDeps, from?: Parameters<WidgetRequestHandler>[2]): void {
	const p = (params ?? {}) as Record<string, unknown>
	if (from && from.owner !== "core") {
		// Asked again here, not only at the door: the write grant on the channel it names.
		// A lane of a channel is that channel's: the grant is the slug's.
		const channel = sessionChannelOf(p.channel, deps.channels)
		if (channel === null)
			throw new Error(`'send' writes to '${String(p.channel)}', which is not one of this session's channels`)
		const slug = parseChannel(channel).slug
		if (!holdsWidgetGrant(from, `channel:${slug}:write`))
			throw new Error(`'send' writes to the '${slug}' channel, and this widget was not granted the write grant 'channel:${slug}:write'`)
		if (typeof p.personaId === "number")
			throw new Error("a plugin's widget sends as the viewer's current persona — switching persona is core's")
		if (trayItemIdsOf(p.trayItemIds).length)
			throw new Error("a plugin's widget sends no tray items — the viewer's uploads are core's to send")
	}
	deps.setDraft(String(p.content ?? ""))
	const channel = sessionChannelOf(p.channel, deps.channels)
	if (channel !== null) deps.setChannel(channel)
	if (typeof p.personaId === "number") deps.switchPersona(p.personaId)
	// Refused (said with a toast): the composer keeps its draft.
	if (!deps.send(trayItemIdsOf(p.trayItemIds))) throw new Error("the line was not sent")
}
