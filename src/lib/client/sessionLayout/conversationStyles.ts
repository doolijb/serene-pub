/**
 * WHOSE STYLE A COMPOSER / TURN LINE WEARS (PLAN D8). They wear their target
 * Messages' effective style unless the person pinned their own. The live
 * render keeps this map (placed composer / turn-line instance -> the Messages
 * instance it follows); `WidgetHost` reads it through `styleSourceOf`.
 */
import { SvelteMap } from "svelte/reactivity"
import { widgetStylePins } from "$lib/client/stores/widgetStyles.svelte"

export const conversationStyleSources = new SvelteMap<string, string>()

/** The widget id whose style `id` is drawn in: its target's, unless it has its own pin. */
export function styleSourceOf(id: string): string {
	const target = conversationStyleSources.get(id)
	if (target === undefined) return id
	return widgetStylePins()[id] ? id : target
}

export function clearConversationStyleSources(): void {
	conversationStyleSources.clear()
}
