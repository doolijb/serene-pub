/**
 * What an sp element needs from the page it is on, supplied by the page — never
 * read by the sp element from a store or a socket, so the same sp element works in a
 * session page, the component harness (C3b) and a native test page.
 *
 * - `participant(ref)` — a participant reference's display name and avatar,
 *   for `sp-avatar`. Absent, the avatar is the reference's initial.
 * - `views` — the page's own views by `HOST_VIEW_NAMES` name, for
 *   `sp-host-view` (C0b): snippets the page renders where a widget placed
 *   the element. Absent or unnamed, the element renders nothing. A view is
 *   handed the element's `channel` (host elements 1.1; lair re-plan S1):
 *   the channel the place is for — a channel-pinned conversation's turn
 *   controls are that channel's — or `undefined` for the page's own.
 * - `context` — the page's Svelte contexts (`getAllContexts()`), handed to
 *   every sp element's mount, so what a host view draws reads the page's
 *   contexts as if it were drawn on the page.
 * - the **owner** of a subtree — `core` or a plugin id — is the nearest
 *   `data-sp-owner` attribute above the element; the component host sets it
 *   on each widget box. `sp-frame` resolves `src` against it.
 */

import type { Snippet } from "svelte"
import type { HostViewName } from "@serene-pub/sdk"

export interface HostParticipant {
	name: string
	avatarUrl?: string | null
}

export const hostElementContext = $state<{
	participant?: (ref: string) => HostParticipant | null
	views?: Partial<Record<HostViewName, HostView>>
	context?: Map<unknown, unknown>
}>({})

/** One of the page's views: drawn for a channel, or for the page's own when `undefined`. */
export type HostView = Snippet<[channel?: string]>

/** Supply (or clear) the page's host views and the contexts they draw under. */
export function setHostViews(
	views: Partial<Record<HostViewName, HostView>> | undefined,
	context?: Map<unknown, unknown>
): void {
	hostElementContext.views = views
	hostElementContext.context = views ? context : undefined
}

/** Supply (or clear) the page's participant lookup. */
export function setHostParticipants(fn: ((ref: string) => HostParticipant | null) | undefined): void {
	hostElementContext.participant = fn
}

/** The owner of the subtree an element sits in, or `null` outside any widget box. */
export function ownerOf(el: Element): string | null {
	return el.closest("[data-sp-owner]")?.getAttribute("data-sp-owner") ?? null
}
