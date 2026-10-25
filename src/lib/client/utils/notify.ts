/**
 * `notify` — the one place a TOAST is decided (PLAN-0-5-polish-parity L4.4
 * and L13.6, 2026-10-24; STYLE-GUIDE §6.21).
 *
 * The walk found 427 toast calls in 121 files, each deciding for itself, and
 * the cost on screen: two red toasts from a background poll sat on every
 * screen for twenty minutes, and a mode switch said "Light mode enabled" over
 * the switch that had just shown it. `notify` is `toaster` with the rules:
 *
 * - **Durations** are the toaster's own (`TOAST_DURATION_MS`): 8s for an
 *   error or a warning, 4s for a success or an info.
 * - **`source`** — repeats from one source REPLACE the toast on screen, never
 *   stack. Name the thing that speaks (`"socket:ollama:version:error"`,
 *   `"connections:sync"`), not the sentence.
 * - **`silent`** — the control that caused it already shows the new state
 *   (a switch, a theme, a row that moved): say nothing.
 * - **`fromPoll`** — raised by an ask nobody pressed for (a status poll, a
 *   reconnect's re-ask, a broadcast from another tab). Never a toast: the
 *   surface that polls already shows the state (the row's dot), and a toast
 *   would greet every screen with it.
 *
 * ⚠ Not a **notification** (NOMENCLATURE §25, 2026-10-24): a notification is a
 * stored row about one person, raised by the SERVER and read by the Activity
 * view and its rail dot (`client/notifications/notifications.svelte.ts`). This
 * raises nothing there — the client store only reads and dismisses.
 *
 * ⚠ It calls `toaster.error` / `.warning` / `.success` / `.info`, never
 * `toaster.create`, so a test that mocks `$lib/client/utils/toaster` with
 * those four keeps catching what is said.
 */
import { toaster } from "./toaster"

export type NotifyLevel = "error" | "warning" | "success" | "info"

export interface NotifyOptions {
	title: string
	description?: string
	/** Repeats from one source replace one another. See the header. */
	source?: string
	/** The control already shows it: no toast. */
	silent?: boolean
	/** Raised by a poll nobody pressed for: never a toast. */
	fromPoll?: boolean
	/** Overrides the type's default (`TOAST_DURATION_MS`). */
	duration?: number
}

/** The toast id a source dedupes on. Exported for tests. */
export function toastIdFor(source: string): string {
	return `notify:${source}`
}

function raise(level: NotifyLevel, options: NotifyOptions): void {
	const { source, silent, fromPoll, ...toast } = options
	if (silent) return
	if (fromPoll) {
		// TODO(L4.4): a poll's failure belongs on the Activity dot, which only
		// the server can raise today (notifications are stored rows); the
		// polling surface already shows the state, so this is logged and dropped.
		console.info(
			`[notify] ${level} from a poll, not toasted: ${toast.title}` +
				(toast.description ? ` — ${toast.description}` : "")
		)
		return
	}
	toaster[level]({
		...toast,
		...(source ? { id: toastIdFor(source) } : {})
	})
}

export const notify = {
	error: (options: NotifyOptions) => raise("error", options),
	warning: (options: NotifyOptions) => raise("warning", options),
	success: (options: NotifyOptions) => raise("success", options),
	info: (options: NotifyOptions) => raise("info", options)
}
