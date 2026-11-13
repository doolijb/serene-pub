/**
 * 🚧 The characters-rows context: the ONE subscriber to the Characters view's
 * page events, and the only place a refused page is toasted. The view takes
 * each reply from this context instead of listening to the socket, and never
 * toasts a page itself.
 *
 * The events: `characters:page` (one page of rows) and `characters:page:error`.
 * Both answer the asking socket only and carry the `requestId` the view sent, so
 * each view matches its own reply and ignores the rest. A page shows no toast.
 * A refusal for an out-of-date cursor (`CHARACTER_ROWS_STALE_CURSOR`) shows none
 * either — the view silently asks for the first page again; any other refusal is
 * one toast, however many views listen. Then the reply is handed to every
 * registered listener.
 *
 * Provided by both shells (Layout.svelte, AccessibleShell.svelte) at init.
 * Views register with the `on…` functions below during their own init; the
 * registration is released when they unmount.
 */
import { getContext, setContext } from "svelte"
import { useInterest } from "$lib/client/sockets/interest.svelte"
import { notify } from "$lib/client/utils/notify"
import { CHARACTER_ROWS_STALE_CURSOR } from "$lib/shared/characters/characterRows"

type Page = Sockets.Characters.Page.Response
type Failed = Sockets.Characters.Page.ErrorResponse

export interface CharacterRowsCtx {
	/** Registers a listener for every page reply; returns its release. */
	addPageListener(listener: (msg: Page) => void): () => void
	/** Registers a listener for every refused page; returns its release. */
	addPageFailedListener(listener: (msg: Failed) => void): () => void
}

export const CHARACTER_ROWS_CONTEXT = "characterRowsCtx"

/** Subscribes once and sets the context. Call during a shell's init. */
export function provideCharacterRows(): CharacterRowsCtx {
	const ctx = createCharacterRows()
	setContext(CHARACTER_ROWS_CONTEXT, ctx)
	return ctx
}

/** The subscriptions and the listener sets, without the context (testable). */
export function createCharacterRows(): CharacterRowsCtx {
	const pages = new Set<(msg: Page) => void>()
	const failed = new Set<(msg: Failed) => void>()

	useInterest<"characters:page">("characters:page", (msg) => {
		for (const listener of pages) listener(msg)
	})
	useInterest<"characters:page:error">("characters:page:error", (msg) => {
		// No toast for a stale cursor: the view asks for the first page again.
		if (msg.error !== CHARACTER_ROWS_STALE_CURSOR)
			notify.error({
				title: msg.error || "Couldn't load the characters.",
				source: "socket:characters:page:error"
			})
		for (const listener of failed) listener(msg)
	})

	return {
		addPageListener(listener) {
			pages.add(listener)
			return () => pages.delete(listener)
		},
		addPageFailedListener(listener) {
			failed.add(listener)
			return () => failed.delete(listener)
		}
	}
}

/** Runs `listener` for every page reply while the calling view is mounted. */
export function onCharactersPage(listener: (msg: Page) => void): void {
	const ctx = getContext<CharacterRowsCtx>(CHARACTER_ROWS_CONTEXT)
	$effect(() => ctx.addPageListener(listener))
}

/** Runs `listener` for every refused page while the calling view is mounted. */
export function onCharactersPageFailed(listener: (msg: Failed) => void): void {
	const ctx = getContext<CharacterRowsCtx>(CHARACTER_ROWS_CONTEXT)
	$effect(() => ctx.addPageFailedListener(listener))
}
