/**
 * **Jump** — the shell's one search across everything a person can already see.
 *
 * Kept in `shared` so BOTH the server handler (`sockets/jump.ts`) and the
 * client's typed-socket map reference one definition. It stays out of the big
 * `sockets/types.ts` `Sockets` namespace, which is mid-refactor;
 * `Handler`/`SocketEventMap` accept any types, so this stands on its own — the
 * placement `sockets/imageGen.ts` uses.
 *
 * ## What it is not
 *
 * It is **not** a `search` family. Every entity already owns `*:searchLibrary`
 * (a browse of a REMOTE card catalogue), and a second meaning of the word on
 * the wire is exactly the collision NOMENCLATURE R1 forbids. _Jump_ is the
 * distinctive word (R2): one overlay, one keystroke, go to the thing.
 *
 * It is **not** a permission surface either. A jump hit is a row the requester
 * could already have reached through the list handler for its kind — the
 * handler reuses each list's own visibility rule rather than writing a second
 * one. A kind whose list is admin-only (`connection`, `user`) is simply not
 * searched for anyone else, and its group is ABSENT rather than empty: an empty
 * group is itself the answer to "does this instance have one".
 */

/**
 * The kinds a jump can reach, in the order their groups are returned.
 *
 * Singular nouns, each the same word its own family already uses — `entry` is a
 * lore entry (8 §1), never a "lore item"; `session` is never a chat.
 */
export const JUMP_KINDS = [
	"session",
	// ⚠ No `persona`: a persona is a character, so a persona hit would be a
	// second kind for the same row. `JumpHit.hint` says which characters are
	// personas instead.
	"character",
	"lorebook",
	"entry",
	"tag",
	"connection",
	"user"
] as const

export type JumpKind = (typeof JUMP_KINDS)[number]

/**
 * The kinds the CLIENT produces out of data it already holds, and which never
 * cross `jump:search`.
 *
 * `doc` is one heading of the compiled documentation. Its search index is a
 * chunk of the browser's own bundle (`loadSearchIndex`), so asking the server
 * for it would be a round trip for something already downloaded — and the
 * documentation is the same for everyone, so there is nothing for a handler to
 * decide.
 *
 * ⚠ Never a member of `JUMP_KINDS`. That tuple is the server's exhaustive
 * `switch` and the order its groups arrive in; a kind no handler can serve
 * belongs in neither. NOMENCLATURE §26: one vocabulary, two producers.
 */
export const CLIENT_JUMP_KINDS = ["doc"] as const

export type ClientJumpKind = (typeof CLIENT_JUMP_KINDS)[number]

/** Every jump kind, whichever side produced it. */
export type AnyJumpKind = JumpKind | ClientJumpKind

/**
 * The kinds whose list handler refuses a non-admin, so this one must too.
 *
 * `connection` — `sockets/connections.ts`'s `if (!socket.user!.isAdmin)`, and
 * the ratified "connections are the administrator's, and to everyone else they
 * do not exist" (`server/connections/visibility.ts`).
 * `user` — `users:list`'s `if (!socket.user!.isAdmin) throw`.
 */
export const ADMIN_ONLY_JUMP_KINDS: ReadonlySet<JumpKind> = new Set<JumpKind>([
	"connection",
	"user"
])

export function isJumpKind(value: unknown): value is JumpKind {
	return (
		typeof value === "string" &&
		(JUMP_KINDS as readonly string[]).includes(value)
	)
}

/** One row a jump can land on. */
export interface JumpHit {
	kind: AnyJumpKind
	id: number | string
	title: string
	/** The row's own second line — its description, or its parent's name. */
	subtitle?: string
	/**
	 * A place INSIDE the thing the id names — today a heading's id on a `doc`
	 * hit, which is the difference between opening a page and landing on the
	 * paragraph that was searched for. Absent when the id addresses the whole.
	 */
	anchor?: string
	/**
	 * The container the hit is addressed INSIDE, when it has one: the lorebook
	 * for an `entry`, the session for anything session-scoped. Absent when the
	 * id alone is the whole address.
	 */
	parentId?: number | string
	/**
	 * A one-word qualifier on the KIND, not a second kind — today only
	 * `"persona"`, on a character the user plays. It exists so a person
	 * searching for the character they PLAY can pick it out of the results;
	 * without it a persona is indistinguishable from any other character.
	 */
	hint?: "persona"
}

export interface JumpGroup {
	kind: JumpKind
	hits: JumpHit[]
}

export interface JumpSearchParams {
	query: string
	/** Omitted means every kind the requester may see. */
	kinds?: JumpKind[]
	/** Per-kind cap; see `JUMP_HITS_PER_KIND`. */
	limit?: number
}

export interface JumpSearchResponse {
	/**
	 * Echoed verbatim.
	 *
	 * A reply leaves through `emitToUser`, which reaches every socket of the
	 * requesting user that declared interest — so a second tab, and a reply
	 * that lands after the person has typed another letter, are both things the
	 * receiver has to be able to recognise. Supersession already suppresses the
	 * stale reply per socket; this is what lets a client be sure.
	 */
	query: string
	/** In `JUMP_KINDS` order. Empty groups are omitted, never sent empty. */
	groups: JumpGroup[]
}

/**
 * Below this, a jump answers with no groups and touches no database.
 *
 * One character matches most of an instance, which is neither a useful answer
 * nor a cheap one. Shared so the client can hold its request rather than send a
 * query it knows the answer to.
 */
export const JUMP_MIN_QUERY_LENGTH = 2

/** Default per-kind cap. */
export const JUMP_HITS_PER_KIND = 8

/** Hard ceiling across every group of one reply. */
export const JUMP_HITS_TOTAL = 40
