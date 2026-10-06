/**
 * The characters-import context: the ONE subscriber to the character-import
 * socket events, and the only place their toasts are shown. Views take the
 * outcome from this context instead of listening to the socket, and never
 * toast an import themselves.
 *
 * `characters:importCard` (and its `:error`) reach every socket the person has
 * open, and a Library import runs the same server path — so it answers with
 * BOTH `characters:importCard` and `characters:importFromLibrary`. When each
 * view listened and toasted for itself, one import showed up to three toasts.
 * Here each event is handled once: one toast per import (the card-import reply
 * announces a Library import too, so the Library reply adds none), one per
 * refusal, then the reply is handed to every registered listener for whatever
 * each view does with it — the Characters view's conflict and lorebook dialogs,
 * the home wizard's selection, the Library's "imported" marks.
 *
 * The events: `characters:importCard`, `characters:importResolve` (the
 * conflict dialog's answer) and `characters:importFromLibrary`, each with its
 * `:error`. Provided by both shells (Layout.svelte, AccessibleShell.svelte) at
 * init. Views register with the `on…` functions below during their own init;
 * the registration is released when they unmount.
 */
import { getContext, setContext } from "svelte"
import { useInterest } from "$lib/client/sockets/interest.svelte"
import { toaster } from "$lib/client/utils/toaster"
import { cardImportedToast } from "$lib/client/utils/cardImportedToast"

type Imported = Sockets.Characters.ImportCard.Response
type Resolved = Sockets.Characters.ImportResolve.Response
type LibraryImported = Sockets.Characters.ImportFromLibrary.Response
type Failed = Sockets.ErrorResponse

export interface CharacterImportsCtx {
	/** Registers a listener for every import reply; returns its release. */
	addImportedListener(listener: (msg: Imported) => void): () => void
	/** Registers a listener for every refused import; returns its release. */
	addFailedListener(listener: (msg: Failed) => void): () => void
	/** Registers a listener for every resolved import conflict. */
	addResolvedListener(listener: (msg: Resolved) => void): () => void
	/** Registers a listener for every refused conflict resolution. */
	addResolveFailedListener(listener: (msg: Failed) => void): () => void
	/** Registers a listener for every Library import reply. */
	addLibraryImportedListener(
		listener: (msg: LibraryImported) => void
	): () => void
	/** Registers a listener for every refused Library import. */
	addLibraryFailedListener(listener: (msg: Failed) => void): () => void
}

export const CHARACTER_IMPORTS_CONTEXT = "characterImportsCtx"

/** Subscribes once and sets the context. Call during a shell's init. */
export function provideCharacterImports(): CharacterImportsCtx {
	const ctx = createCharacterImports()
	setContext(CHARACTER_IMPORTS_CONTEXT, ctx)
	return ctx
}

/** The subscriptions and the listener sets, without the context (testable). */
export function createCharacterImports(): CharacterImportsCtx {
	const imported = new Set<(msg: Imported) => void>()
	const failed = new Set<(msg: Failed) => void>()
	const resolved = new Set<(msg: Resolved) => void>()
	const resolveFailed = new Set<(msg: Failed) => void>()
	const libraryImported = new Set<(msg: LibraryImported) => void>()
	const libraryFailed = new Set<(msg: Failed) => void>()

	useInterest<"characters:importCard">("characters:importCard", (msg) => {
		const toast = cardImportedToast(msg)
		if (toast)
			toaster[toast.kind]({
				title: toast.title,
				description: toast.description
			})
		for (const listener of imported) listener(msg)
	})
	useInterest<"characters:importCard:error">(
		"characters:importCard:error",
		(msg) => {
			toaster.error({
				title: "Import failed",
				description: msg.error ?? "Could not import character card"
			})
			for (const listener of failed) listener(msg)
		}
	)
	// The Characters view's conflict dialog resolves through here: keeping
	// both, or overwriting, is a card that has now imported.
	useInterest<"characters:importResolve">(
		"characters:importResolve",
		(msg) => {
			const toast = cardImportedToast({
				character: msg.character,
				warnings: msg.warnings
			})
			if (toast)
				toaster[toast.kind]({
					title: toast.title,
					description: toast.description
				})
			for (const listener of resolved) listener(msg)
		}
	)
	useInterest<"characters:importResolve:error">(
		"characters:importResolve:error",
		(msg) => {
			toaster.error({
				title: msg.error || "Failed to resolve character import"
			})
			for (const listener of resolveFailed) listener(msg)
		}
	)
	// No toast: the same import's `characters:importCard` reply announced it.
	useInterest<"characters:importFromLibrary">(
		"characters:importFromLibrary",
		(msg) => {
			for (const listener of libraryImported) listener(msg)
		}
	)
	useInterest<"characters:importFromLibrary:error">(
		"characters:importFromLibrary:error",
		(msg) => {
			toaster.error({
				title: msg.error || "Failed to import the character"
			})
			for (const listener of libraryFailed) listener(msg)
		}
	)

	const ctx: CharacterImportsCtx = {
		addImportedListener(listener) {
			imported.add(listener)
			return () => imported.delete(listener)
		},
		addFailedListener(listener) {
			failed.add(listener)
			return () => failed.delete(listener)
		},
		addResolvedListener(listener) {
			resolved.add(listener)
			return () => resolved.delete(listener)
		},
		addResolveFailedListener(listener) {
			resolveFailed.add(listener)
			return () => resolveFailed.delete(listener)
		},
		addLibraryImportedListener(listener) {
			libraryImported.add(listener)
			return () => libraryImported.delete(listener)
		},
		addLibraryFailedListener(listener) {
			libraryFailed.add(listener)
			return () => libraryFailed.delete(listener)
		}
	}
	return ctx
}

/** Runs `listener` for every import reply while the calling view is mounted. */
export function onCardImported(listener: (msg: Imported) => void): void {
	const ctx = getContext<CharacterImportsCtx>(CHARACTER_IMPORTS_CONTEXT)
	$effect(() => ctx.addImportedListener(listener))
}

/** Runs `listener` for every refused import while the calling view is mounted. */
export function onCardImportFailed(listener: (msg: Failed) => void): void {
	const ctx = getContext<CharacterImportsCtx>(CHARACTER_IMPORTS_CONTEXT)
	$effect(() => ctx.addFailedListener(listener))
}

/** Runs `listener` for every resolved import conflict while the view is mounted. */
export function onImportResolved(listener: (msg: Resolved) => void): void {
	const ctx = getContext<CharacterImportsCtx>(CHARACTER_IMPORTS_CONTEXT)
	$effect(() => ctx.addResolvedListener(listener))
}

/** Runs `listener` for every refused conflict resolution while mounted. */
export function onImportResolveFailed(listener: (msg: Failed) => void): void {
	const ctx = getContext<CharacterImportsCtx>(CHARACTER_IMPORTS_CONTEXT)
	$effect(() => ctx.addResolveFailedListener(listener))
}

/** Runs `listener` for every Library import reply while the view is mounted. */
export function onLibraryImported(
	listener: (msg: LibraryImported) => void
): void {
	const ctx = getContext<CharacterImportsCtx>(CHARACTER_IMPORTS_CONTEXT)
	$effect(() => ctx.addLibraryImportedListener(listener))
}

/** Runs `listener` for every refused Library import while the view is mounted. */
export function onLibraryImportFailed(listener: (msg: Failed) => void): void {
	const ctx = getContext<CharacterImportsCtx>(CHARACTER_IMPORTS_CONTEXT)
	$effect(() => ctx.addLibraryFailedListener(listener))
}
