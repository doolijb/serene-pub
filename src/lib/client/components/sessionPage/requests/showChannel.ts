/**
 * `show-channel`: a Messages instance tells the page which channel it shows,
 * so the live layout can point a Composer / Turn line at it. Core's widgets
 * only (the askers table, `./askers.ts`). Holds no listener and never toasts.
 */
import { SvelteMap } from "svelte/reactivity"

/** The channel each Messages instance last said it shows (`show-channel`), by instance id — read by the live layout to point a Composer / Turn line at it. */
export const shownChannels = new SvelteMap<string, string>()

/** Answer one `show-channel`. Throws, in words, on a channel that is not text of a sensible size. */
export function answerShowChannel(
	params: unknown,
	from: { widgetId: string }
): void {
	const channel = ((params ?? {}) as { channel?: unknown }).channel
	if (typeof channel !== "string" || channel.trim() === "")
		throw new Error("show-channel needs the channel's name as text")
	if (channel.length > 200)
		throw new Error("A channel's name is at most 200 characters.")
	if (shownChannels.get(from.widgetId) === channel) return
	shownChannels.set(from.widgetId, channel)
}

/** Forget every instance's channel (page teardown). */
export function clearShownChannels(): void {
	shownChannels.clear()
}
