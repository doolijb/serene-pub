/**
 * **Jump** — the shell's one search, and the registry the views hand it to.
 *
 * The layout owns the component; the VIEW owns the search input state. A
 * sidebar view that already has a filter box registers that box here, and while
 * the overlay is scoped to that view its input **is** the view's filter state:
 * the same getter and the same setter, so the list behind the overlay narrows
 * as you type and stays narrowed when the overlay closes. A view that registers
 * nothing gets the shell's own Everywhere search, held in `#query` below.
 *
 * This is a registry rather than a second search box because two boxes over
 * one list is two states to keep in step, and the first thing that goes
 * wrong is the one nobody is looking at.
 *
 * ## Scope
 *
 * A **scope** is what the next keystroke searches. It is resolved, not stored,
 * so it follows the view and the route by itself — except when a person has
 * said otherwise, which is what `source: "manual"` records. A manual scope
 * (the chip backspaced away, or a `kind:` prefix typed) sticks until the
 * overlay closes, because the alternative is a scope that snaps back under the
 * cursor.
 *
 * ## Names
 *
 * The feature is **Jump**, the component is the **Jump overlay**, and the thing
 * at the left of its input is the **scope chip**. None of them is a "panel":
 * that word means a session widget (docs/session-layout.md).
 */

import { SvelteMap } from "svelte/reactivity"
import {
	CLIENT_JUMP_KINDS,
	isJumpKind,
	type AnyJumpKind,
	type JumpHit,
	type JumpKind
} from "$lib/shared/sockets/jump"

/**
 * What one view tells the shell about its own filter box.
 *
 * `getHits` is the view's CURRENTLY FILTERED rows, already narrowed by
 * `getQuery()` — the overlay renders what the list behind it is showing rather
 * than running a second search over the same data.
 */
export interface JumpScopeRegistration {
	/** The scope chip's word, and the pill's: "Characters". */
	label: string
	/** The overlay input's placeholder: "Filter characters". */
	placeholder?: string
	getQuery: () => string
	setQuery: (q: string) => void
	/** The view's filtered rows as jump hits. The overlay shows the first 8. */
	getHits: () => JumpHit[]
	/** What the view does when one of its own rows is picked. */
	onPick?: (hit: JumpHit) => void | Promise<void>
}

/**
 * Where the scope came from — and, for "manual", that nothing may change it
 * until the overlay closes.
 */
export type JumpScopeSource = "view" | "route" | "manual"

export interface JumpScope {
	/** A view key, a `JumpKind`, `"admin"`, or null for Everywhere. */
	key: string | null
	label: string
	source: JumpScopeSource
}

export const EVERYWHERE_LABEL = "Everywhere"
export const ADMIN_SCOPE_KEY = "admin"
export const ADMIN_SCOPE_LABEL = "Admin"

/** A scope that names one kind of row, or the admin pages. */
export type JumpKindScopeKey = AnyJumpKind | typeof ADMIN_SCOPE_KEY

/**
 * What a `kind:` scope is called on the chip.
 *
 * Plural, because a scope is a set of things rather than one of them, and each
 * word is the one its own family already uses. "Lorebooks" and not the rail's
 * "Lorebooks+" — the suffix is that nav entry's badge, not the noun.
 *
 * "Documentation" is the one mass noun: the plural rule asks for the SET, and
 * the set of docs is called the documentation everywhere else in the app
 * (NOMENCLATURE §27) — "Docs" would be a second word for it.
 */
export const KIND_SCOPE_LABELS: Record<JumpKindScopeKey, string> = {
	session: "Sessions",
	character: "Characters",
	lorebook: "Lorebooks",
	entry: "Entries",
	tag: "Tags",
	connection: "Connections",
	user: "Users",
	doc: "Documentation",
	admin: ADMIN_SCOPE_LABEL
}

export function isKindScopeKey(value: string): value is JumpKindScopeKey {
	return (
		value === ADMIN_SCOPE_KEY ||
		isJumpKind(value) ||
		// A client kind is a scope like any other — only its hits come from
		// here rather than from the wire.
		(CLIENT_JUMP_KINDS as readonly string[]).includes(value)
	)
}

/**
 * The WIRE kind a scope searches, or null when it is not one.
 *
 * ⚠ `doc` is a scope key and not an answer here: it names a client kind, whose
 * hits the overlay builds itself and which no `jump:search` reply ever carries.
 * A `doc` treated as a wire kind would look for a group that cannot arrive.
 */
export function kindOfScope(key: string | null): JumpKind | null {
	return key !== null && isJumpKind(key) ? key : null
}

export interface ParsedKindPrefix {
	key: JumpKindScopeKey
	/** The query with the prefix taken off. */
	rest: string
}

/**
 * `character:ana` → search characters for "ana".
 *
 * Only at the START of the query, and only for a word this app has a scope
 * for: a colon is an ordinary character in a lorebook entry's name, and
 * swallowing "note: fix later" as a scope for a kind called "note" would be a
 * search that silently found nothing. An unrecognised word is left alone and
 * searched verbatim.
 */
export function parseKindPrefix(query: string): ParsedKindPrefix | null {
	const match = /^([A-Za-z]+):[ \t]*/.exec(query)
	if (!match) return null
	const key = match[1].toLowerCase()
	if (!isKindScopeKey(key)) return null
	return { key, rest: query.slice(match[0].length) }
}

/** `/admin`, `/admin/users`, … — the admin tree, and nothing that merely starts with those letters. */
export function isAdminPath(pathname: string): boolean {
	return pathname === "/admin" || pathname.startsWith("/admin/")
}

/**
 * `/docs`, `/docs/getting-around`, … — the documentation read as a full page.
 *
 * Not `/document-view/docs`: that mirror is its own surface with its own
 * inline search, and it does not carry the shell (there is no Jump on it).
 */
export function isDocsPath(pathname: string): boolean {
	return pathname === "/docs" || pathname.startsWith("/docs/")
}

/**
 * The scope, from the four things that decide it.
 *
 * Pure, and exported for its own test: this is the rule the whole overlay
 * reads from, and every part of it is a precedence that is easy to get subtly
 * backwards.
 */
export function resolveScope(input: {
	/** A scope the person chose, which outranks everything until the overlay closes. */
	manual: JumpScope | null
	activeView: string | null
	/** The active view's registered label, or null when it registered nothing. */
	viewLabel: string | null
	pathname: string
}): JumpScope {
	if (input.manual) return input.manual
	if (input.activeView !== null && input.viewLabel !== null)
		return {
			key: input.activeView,
			label: input.viewLabel,
			source: "view"
		}
	if (isAdminPath(input.pathname))
		return {
			key: ADMIN_SCOPE_KEY,
			label: ADMIN_SCOPE_LABEL,
			source: "route"
		}
	// Reading the documentation as a full page is the same standing as having
	// the Help view open, which registers this label for itself.
	if (isDocsPath(input.pathname))
		return {
			key: "doc",
			label: KIND_SCOPE_LABELS.doc,
			source: "route"
		}
	// Session pages are not a scope yet: with no view open, a session is
	// Everywhere like any other page.
	return { key: null, label: EVERYWHERE_LABEL, source: "route" }
}

/** What the controller has to ask the shell about. */
export interface JumpCtxDeps {
	getActiveView: () => string | null
	getPathname: () => string
}

export interface JumpCtx {
	readonly isOpen: boolean
	readonly scope: JumpScope
	/** The registration backing the current scope, when a view owns it. */
	readonly registration: JumpScopeRegistration | null
	/** The overlay input's placeholder for the current scope. */
	readonly placeholder: string
	/**
	 * The query. Reads and writes the SCOPED VIEW's own filter state whenever
	 * one is registered — that two-way binding is the point of the registry —
	 * and the shell's own box otherwise.
	 */
	query: string
	registerScope: (viewKey: string, reg: JumpScopeRegistration) => () => void
	open: (opts?: { scope?: string | null }) => void
	close: () => void
	/** Pin the scope by hand (a `kind:` prefix, or the chip's ×, which passes null). */
	setScope: (key: string | null) => void
}

class JumpController implements JumpCtx {
	#deps: JumpCtxDeps
	#open = $state(false)
	#manual = $state<JumpScope | null>(null)
	/** The shell's own search box, used whenever no view's state is standing in. */
	#query = $state("")
	/**
	 * `SvelteMap`, not `Map`: the scope is derived from what is registered, so
	 * a view registering on mount has to move the chip it just earned.
	 */
	#registrations = new SvelteMap<string, JumpScopeRegistration>()

	constructor(deps: JumpCtxDeps) {
		this.#deps = deps
	}

	#scope = $derived.by<JumpScope>(() => {
		const activeView = this.#deps.getActiveView()
		return resolveScope({
			manual: this.#manual,
			activeView,
			viewLabel:
				(activeView !== null &&
					this.#registrations.get(activeView)?.label) ||
				null,
			pathname: this.#deps.getPathname()
		})
	})

	get isOpen(): boolean {
		return this.#open
	}

	get scope(): JumpScope {
		return this.#scope
	}

	get registration(): JumpScopeRegistration | null {
		const key = this.#scope.key
		// View keys are plural and kind keys singular ("characters" vs
		// "character"), so one map cannot answer the wrong question here.
		return key === null ? null : (this.#registrations.get(key) ?? null)
	}

	get placeholder(): string {
		const reg = this.registration
		if (reg?.placeholder) return reg.placeholder
		const scope = this.#scope
		return scope.key === null ? "Jump to anything" : `Search ${scope.label}`
	}

	get query(): string {
		const reg = this.registration
		return reg ? reg.getQuery() : this.#query
	}

	set query(next: string) {
		const reg = this.registration
		if (reg) reg.setQuery(next)
		else this.#query = next
	}

	registerScope(viewKey: string, reg: JumpScopeRegistration): () => void {
		this.#registrations.set(viewKey, reg)
		return () => {
			// Only if it is still OURS: a view that remounts before the old
			// instance's teardown runs would otherwise delete the new one's.
			if (this.#registrations.get(viewKey) === reg)
				this.#registrations.delete(viewKey)
		}
	}

	setScope(key: string | null): void {
		if (key === null) {
			this.#manual = {
				key: null,
				label: EVERYWHERE_LABEL,
				source: "manual"
			}
			return
		}
		const reg = this.#registrations.get(key)
		if (reg) {
			this.#manual = { key, label: reg.label, source: "manual" }
			return
		}
		if (isKindScopeKey(key)) {
			this.#manual = {
				key,
				label: KIND_SCOPE_LABELS[key],
				source: "manual"
			}
			return
		}
		this.#manual = { key: null, label: EVERYWHERE_LABEL, source: "manual" }
	}

	open(opts: { scope?: string | null } = {}): void {
		const scoped = "scope" in opts
		// Ctrl K on an already-open overlay focuses it (the input is
		// autofocused and the dialog is modal, so it already has focus) rather
		// than wiping what is typed.
		if (this.#open && !scoped) return
		if (scoped) this.setScope(opts.scope ?? null)
		// Only the SHELL's box starts empty. A view's filter is the view's, and
		// clearing it would undo a narrowing the person can see behind the
		// overlay.
		if (!this.registration) this.#query = ""
		this.#open = true
	}

	close(): void {
		this.#open = false
		// A manual scope lives as long as the overlay it was chosen in.
		this.#manual = null
	}
}

export function createJumpCtx(deps: JumpCtxDeps): JumpCtx {
	return new JumpController(deps)
}

/** The context key the layout sets and every registering view reads. */
export const JUMP_CONTEXT = "jumpCtx"
