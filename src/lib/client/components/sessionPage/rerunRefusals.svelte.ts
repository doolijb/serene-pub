/**
 * 🚧 The session page's rerun refusals (2026-10-16): a swipe, retry or
 * extend the server refused in a sentence — "This message is a question, not
 * a reply — …" — answers on the verb's own event with `{ error }` and no id.
 * The page's inbox is the one listener (`sessionPageInbox`); this store is
 * registered on it, toasts the sentence once — only in the tab that pressed —
 * and remembers the row, so the line's `rerunnable` goes false and its rerun
 * affordances leave (`canRerunMessage`).
 */
import { SvelteSet } from "svelte/reactivity"
import { toaster } from "$lib/client/utils/toaster"
import type { SessionPageInbox } from "$lib/client/components/sessionPage/sessionPageInbox.svelte"

/** The verbs a row reruns by, as their socket events. */
export const RERUN_EVENTS = [
	"sessionMessages:swipeRight",
	"sessionMessages:swipeLeft",
	"sessionMessages:regenerate",
	"sessionMessages:extend"
] as const
export type RerunEvent = (typeof RERUN_EVENTS)[number]

/** Registers on the inbox at once; call during the page's init. */
export function createRerunRefusals(inbox: Pick<SessionPageInbox, "on">) {
	/** The row each verb was last pressed on in THIS tab, until it answers. */
	const pending = new Map<RerunEvent, number>()
	const refused = new SvelteSet<number>()

	const hear = (event: RerunEvent) => (msg: { error?: string; sessionMessage?: unknown }) => {
		const id = pending.get(event)
		// Another tab's press answers here too (`emitToUser`): not ours to say.
		if (id === undefined) return
		pending.delete(event)
		if (!msg?.error) return
		refused.add(id)
		toaster.error({ title: msg.error })
	}
	for (const event of RERUN_EVENTS) inbox.on(event, hear(event) as any)

	return {
		/** A rerun verb is about to be sent for row `id`. */
		asked(event: RerunEvent, id: number) {
			pending.set(event, id)
		},
		/** The server refused a rerun of this row. */
		isRefused(id: number): boolean {
			return refused.has(id)
		},
		/** For a projection's cache key: changes whenever a row is refused. */
		get key(): string {
			return [...refused].join(",")
		}
	}
}
export type RerunRefusals = ReturnType<typeof createRerunRefusals>

/** Whether a row carries a form block anywhere in its parts — a question put to somebody. */
export function rowAsks(msg: { parts?: ReadonlyArray<{ data?: unknown }> | null }): boolean {
	const walk = (blocks: unknown, depth: number): boolean =>
		Array.isArray(blocks) &&
		depth < 8 &&
		blocks.some(
			(b) =>
				!!b &&
				typeof b === "object" &&
				((b as { kind?: unknown }).kind === "form" ||
					walk((b as { blocks?: unknown }).blocks, depth + 1))
		)
	return (msg.parts ?? []).some((p) => walk((p?.data as { blocks?: unknown } | null)?.blocks, 0))
}
