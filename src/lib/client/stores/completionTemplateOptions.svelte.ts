import { PromptFormats } from "$lib/shared/constants/PromptFormats"
import { useTypedSocket } from "$lib/client/sockets/typedSocket"
import { requestWithInterest } from "$lib/client/sockets/interest.svelte"

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

/** What `stopCompletionTemplateOptions` releases — the one declared key. */
let release: (() => void) | null = null

function onOptions(res: Sockets.CompletionTemplates.Options.Response) {
	// An empty table would be a database with no seeds in it, which is not a
	// state to render as "no formats exist": keep the built-ins.
	if (res?.options?.length) options = res.options
}

/**
 * Declare the interest, then ask — `requestWithInterest` in that order, which
 * is what puts the interest sync on the wire ahead of the request (plan ruling
 * 3) and makes a gated reply reachable at all.
 *
 * BARE: `completionTemplates:options` is not in `SCOPED_EVENTS` — it is the
 * instance's whole selectable set, with nothing to narrow to. STANDING, and
 * that is the point of the store: `refreshCompletionTemplateOptions()` re-asks
 * on the same key after an admin write, and every form on the page reads the
 * one answer.
 *
 * A module store cannot call `getContext`, so this is the plain import of the
 * registry (plan ruling 7) rather than the interest context.
 */
function subscribe() {
	release = requestWithInterest("completionTemplates:options", {}, onOptions)
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

/**
 * Drop the interest. Nothing in the app calls this today — the cache is
 * module-scoped and lives as long as the tab, which is the point, and it is
 * why the old code had no `off` at all — but the release is kept so a teardown
 * is possible, and so it removes THIS store's subscriber rather than every
 * listener for the event. Mirrors `stopWidgetStyles` next door.
 */
export function stopCompletionTemplateOptions() {
	if (!started) return
	release?.()
	release = null
	started = false
}
