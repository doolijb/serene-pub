/**
 * 🚧 What a genre's session-view frame is handed beyond what every frame gets (M0 L8 + the M1 fix): the `lore`
 * grant when the genre declares a lorebook, and the session's own channels with a write grant on each, so a
 * total-conversion frame (`shape.view`, usually with `composer: 'none'`) can `send` its own lines — core's
 * composer is absent there. The server still judges every send as the viewer's own, exactly as core's composer.
 */
import { parseChannel, type WidgetSectionScope, type WidgetWriteGrant } from "@serene-pub/sdk"

export interface SessionViewHanded {
	/** What the request door hears as the frame's channels (`WireInputs.writeChannels`): one slug per channel. */
	writeChannels: string[]
	grants: (WidgetSectionScope | WidgetWriteGrant)[]
}

export function sessionViewHanded(o: { declaresLorebook: boolean; channels: readonly string[] }): SessionViewHanded {
	const slugs = [...new Set(o.channels.map((c) => parseChannel(c).slug))]
	return {
		writeChannels: slugs,
		grants: [
			...(o.declaresLorebook ? (["lore"] as const) : []),
			...slugs.map((s) => `channel:${s}:write` as const)
		]
	}
}
