import { PromptFormats } from "$lib/shared/constants/PromptFormats"
import { useTypedSocket } from "$lib/client/sockets/typedSocket"

/**
 * The connection format picker's options — **from the table**, not from a
 * constant beside it.
 *
 * ## What this replaces
 *
 * Eight connection forms each rendered `PromptFormats.options`: a hand-written
 * array of `{value,label}` pairs living next to a table an admin can add rows
 * to. Two lists, with only a unit test keeping them equal — so the moment a
 * template could be authored, it could be saved, referenced by a connection and
 * rendered, and never appear in the control that selects it. A feature whose
 * whole surface is a picker, missing from the picker.
 *
 * The server filters on `is_selectable`, which is how `split_session` stays out
 * of it: a transport bridge is not a text format a person chooses.
 *
 * ## The constant survives as the FALLBACK, and only as that
 *
 * Until the reply lands — and on any instance where the socket call fails —
 * the picker shows the eight built-ins. That is strictly better than an empty
 * dropdown next to a connection someone is trying to save, and it is honest:
 * those eight rows are seeded on every boot, so they are the one part of the
 * table that is guaranteed to be there.
 *
 * ## Module-scoped, and refreshed rather than cached-forever
 *
 * One fetch serves every form on the page. `refresh()` re-asks — the admin
 * screens call it after a write so a template saved in one tab is offered in
 * the next form the same session opens, without a reload.
 */

const FALLBACK = PromptFormats.options

let options = $state<{ value: string; label: string }[]>(FALLBACK)
let started = false

function subscribe() {
	const socket = useTypedSocket()
	socket.on(
		"completionTemplates:options",
		(res: Sockets.CompletionTemplates.Options.Response) => {
			// An empty table would be a database with no seeds in it, which is
			// not a state to render as "no formats exist": keep the built-ins.
			if (res?.options?.length) options = res.options
		}
	)
	socket.emit("completionTemplates:options", {})
}

/**
 * The options, live. Call from a component; the first caller starts the fetch.
 *
 * Returns a getter object rather than the array so a `$derived` in the caller
 * re-runs when the reply lands.
 */
export function completionTemplateOptions() {
	if (!started) {
		started = true
		subscribe()
	}
	return {
		get value() {
			return options
		}
	}
}

/**
 * Re-ask, after a write on the admin screens.
 *
 * A no-op until something has actually subscribed, and that is the right
 * answer rather than a missed refresh: nothing has fetched, so nothing is
 * stale, and the next form to mount fetches for itself. It matters in the one
 * case where it does not — a connection form opened earlier in the same SPA
 * session, whose cached list would otherwise not know about the template just
 * saved.
 */
export function refreshCompletionTemplateOptions() {
	if (!started) return
	useTypedSocket().emit("completionTemplates:options", {})
}
