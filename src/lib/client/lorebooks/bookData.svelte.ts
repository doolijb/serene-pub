/**
 * The open book's data — ONE copy, read by every lens (plan B4; contract E-9,
 * DESIGN-lorebooks-ui-modularity §4).
 *
 * `LorebooksWorkspace` already asks for the whole book when it opens (every
 * entry type, the scenes, the cast, the suggestions and possible duplicates)
 * and hears every reply and cascade about it. A lens reads THIS: it never
 * asks again on mount, keeps no copy of its own that the shell would also
 * have to patch, and never resolves a row privately (a lens drawing raw
 * names beside one drawing resolved ones is the amended-name class).
 *
 * Provided by context, like the relationship store (`relationships.svelte.ts`)
 * it sits beside. Every field is a getter over the shell's state, so a read
 * inside an effect or a `$derived` follows it. The three `refresh` verbs are
 * the cascades the server does not send by itself (a scene list after a
 * build applied, the cast after a member is deleted) — asked through the
 * shell, never by a lens on its own socket.
 *
 * ⚠ Deviation from E-9, recorded in the plan: `cast` is the binding list as
 * the server lists it (every line), with `resolveCast` beside it, rather than
 * pre-resolved rows — the Cast board diffs its edits against the stored rows
 * and resolves on its own line. `allScenes` and the `loaded` probe are added;
 * `links`, `counts` and `decisions` stay props for now (the shell already
 * passes them, and nothing re-fetches them).
 */

import { getContext, setContext } from "svelte"
import type { BindingWithRelations } from "$lib/client/components/lorebookForms/entryManager"
import type { PoolSource } from "./sections/types"

export interface BookData {
	/** The book open, or null on the list of books. */
	readonly lorebookId: number | null
	/**
	 * The book's entries by entry type, on the line being read and as of the
	 * moment — the shell's one resolver's rows (amended names, dated
	 * archiving). Archived rows are kept: a lens decides whether it draws them.
	 */
	readonly rows: Readonly<Record<string, PoolSource[]>>
	/** The same entries as stored, on every line — for editors' diffs and dating. */
	readonly rawRows: Readonly<Record<string, PoolSource[]>>
	/** The book's cast (the binding list), as the server lists it. */
	readonly cast: readonly BindingWithRelations[]
	/** Cast rows as they read at the moment, on the line (the shell's resolver). */
	resolveCast<T extends { id: number }>(rows: readonly T[]): T[]
	/** The book's scenes on the line being read. */
	readonly scenes: readonly PoolSource[]
	/** Every scene of the book, every line — what a session's own count reads. */
	readonly allScenes: readonly PoolSource[]
	/** The cast's pending suggestions (Loose ends and the Suggestions panel). */
	readonly suggestions: readonly Sockets.BindingSuggestions.Suggestion[]
	/** Pairs of members that may be one person. */
	readonly duplicates: readonly Sockets.NarrativeGraph.DuplicateCandidates.Candidate[]
	/**
	 * Whether a list has arrived for the book: an entry type, `"scenes"` or
	 * `"cast"`. Before it has, an empty list means "not yet", not "none".
	 */
	loaded(what: string): boolean
	/** Ask for the scenes again (the server does not re-send them after every write). */
	refreshScenes(): void
	/** Ask for the cast again (a graph delete or merge does not re-send it). */
	refreshCast(): void
	/** Ask for one entry type's rows again. */
	refreshRows(typeId: string): void
}

const KEY = Symbol("lorebookBookData")

export function setBookData(data: BookData): void {
	setContext(KEY, data)
}

/**
 * The workspace's book data. Call during init, from under `LorebooksWorkspace`
 * (or a test fixture that provides one).
 */
export function getBookData(): BookData {
	const data = getContext<BookData | undefined>(KEY)
	if (!data)
		throw new Error(
			"No book data: this lens is mounted outside LorebooksWorkspace."
		)
	return data
}

/**
 * The context map that provides `data`, for `mount(Lens, { context })` — a
 * test mounting one lens without the workspace.
 */
export function bookDataContext(data: BookData): Map<symbol, BookData> {
	return new Map([[KEY, data]])
}

/**
 * A fixed BookData, for a fixture or a test that mounts one lens: the values
 * are read through getters, so a caller holding them in `$state` gets a live
 * one. Every list absent is "not loaded".
 */
export function staticBookData(
	values: () => Partial<{
		lorebookId: number | null
		rows: Record<string, PoolSource[]>
		rawRows: Record<string, PoolSource[]>
		cast: BindingWithRelations[]
		scenes: PoolSource[]
		allScenes: PoolSource[]
		suggestions: Sockets.BindingSuggestions.Suggestion[]
		duplicates: Sockets.NarrativeGraph.DuplicateCandidates.Candidate[]
	}>,
	verbs: Partial<Pick<BookData, "refreshScenes" | "refreshCast" | "refreshRows">> = {}
): BookData {
	return {
		get lorebookId() {
			return values().lorebookId ?? null
		},
		get rows() {
			return values().rows ?? values().rawRows ?? {}
		},
		get rawRows() {
			return values().rawRows ?? {}
		},
		get cast() {
			return values().cast ?? []
		},
		resolveCast: (rows) => [...rows],
		get scenes() {
			return values().scenes ?? values().allScenes ?? []
		},
		get allScenes() {
			return values().allScenes ?? values().scenes ?? []
		},
		get suggestions() {
			return values().suggestions ?? []
		},
		get duplicates() {
			return values().duplicates ?? []
		},
		loaded(what) {
			const v = values()
			if (what === "cast") return v.cast !== undefined
			if (what === "scenes")
				return v.allScenes !== undefined || v.scenes !== undefined
			return (v.rawRows ?? {})[what] !== undefined
		},
		refreshScenes: verbs.refreshScenes ?? (() => {}),
		refreshCast: verbs.refreshCast ?? (() => {}),
		refreshRows: verbs.refreshRows ?? (() => {})
	}
}
