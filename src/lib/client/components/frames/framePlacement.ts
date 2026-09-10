/**
 * The frame half of PLACEMENT and EVENTS (PLAN 25, ruled 2026-08-30) — the
 * sibling of `frameStyle.ts`, and built on the same reasoning.
 *
 * A frame widget is a native widget minus the iframe: it gets the same
 * `layout.v1` and the same events, and the only thing that differs is the
 * delivery. Native reads a `$derived` context and subscribes to a bus in this
 * document; a frame receives `{ t: "layout" }` and `{ t: "event" }` on its port.
 *
 * Both are PUSHED, never negotiated, exactly as `style` is: a frame that has
 * never heard of them falls through its own switch and ignores them, which is
 * the whole of the compatibility story. Nothing waits for an ack, so an old
 * frame costs one dropped message and no error.
 *
 * What crosses is a DETACHED PLAIN COPY. The port structured-clones, so a
 * Svelte state proxy or a live geometry object the host keeps mutating would
 * either throw `DataCloneError` or — worse — let a later host-side mutation
 * silently disagree with what the frame was told. `projectLayout` already
 * returns a fresh object, and the event copy here is the same guarantee for the
 * event lane.
 */
import {
	projectLayout,
	type LayoutV1,
	type PlacementInput,
	type WidgetEvent
} from "$lib/shared/widgets/context"

/**
 * Frame protocol v1: the host's placement push. See `PluginFrame.svelte`.
 *
 * Type aliases rather than interfaces for the same reason `FrameStyleMessage`
 * is one — they keep an implicit index signature, and `PluginFrame.post()`
 * takes the protocol's common `Record<string, unknown>`.
 */
export type FrameLayoutMessage = {
	t: "layout"
	layout: LayoutV1
}

/** Frame protocol v1: one host event, the port's analog of the `on` verb. */
export type FrameEventMessage = {
	t: "event"
	event: WidgetEvent
}

/**
 * The `layout` message for a measured placement.
 *
 * Deliberately `projectLayout` and nothing else: the native ctx's
 * `layout.v1` is that same call, so the two deliveries are one projection
 * rather than two implementations that agree until one of them is edited.
 */
export function buildLayoutMessage(
	placement: PlacementInput
): FrameLayoutMessage {
	return { t: "layout", layout: projectLayout(placement) }
}

/**
 * The `event` message for one host event.
 *
 * Copied, not forwarded, so the host's own object never crosses by reference.
 * A shallow copy is the whole of it: every event in the union is flat but
 * `layout:changed`, and that one's payload is a `projectLayout` result — already
 * a detached copy by construction, so there is nothing further to detach.
 */
export function buildEventMessage(event: WidgetEvent): FrameEventMessage {
	return { t: "event", event: { ...event } as WidgetEvent }
}
