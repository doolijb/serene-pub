/**
 * 🚧 `draft`: replace the composer's draft. No `content` empties it. Core's
 * own composer — it refuses nothing — or 🚧 a plugin's widget holding the
 * write grant on the channel the composer is on (D4, ruled Q2:
 * `channel:<slug>:write`, one of its declared channels). A draft names no
 * channel, so the composer's is the one a plugin's is held to: it never
 * moves the composer to another.
 */
import { declaredChannelsOf, holdsWidgetGrant } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

/** What this answer needs of the page's composer. */
export interface DraftDeps {
	setDraft(content: string): void
	/** The channel the composer is on — what a plugin's draft is held to. */
	composerChannel?(): string | null | undefined
}

/** Answer one `draft`, from `from` (absent: core's own composer). */
export function answerDraft(params: unknown, deps: DraftDeps, from?: Parameters<WidgetRequestHandler>[2]): void {
	const p = (params ?? {}) as Record<string, unknown>
	if (from && from.owner !== "core") {
		const channel = deps.composerChannel?.() ?? "main"
		if (!declaredChannelsOf(from).includes(channel))
			throw new Error(`the composer is on '${channel}', which is not one of this widget's channels`)
		if (!holdsWidgetGrant(from, `channel:${channel}:write`))
			throw new Error(`the composer is on '${channel}', and this widget was not granted the write grant 'channel:${channel}:write'`)
	}
	deps.setDraft(String(p.content ?? ""))
}
