/**
 * `jump:search` — one search across everything the requester can already see.
 *
 * ## The one rule
 *
 * **A jump never returns a row its kind's own list handler would have refused.**
 * Every kind below names the list handler it borrows its visibility from, with
 * the line, and repeats that handler's where-clause rather than writing a
 * second one that agrees with it today. A cross-entity search is the surface
 * where a *read* leaks — the same shape as the review card that handed a
 * non-admin a connection blob every write path was busy guarding
 * (`server/connections/visibility.ts`) — so the check lives beside the query
 * that could leak, in the borrowed spelling, where a reviewer can diff the two.
 *
 * The two admin-only kinds are ABSENT for anyone else rather than empty. An
 * empty `connection` group answers "does this instance have connections", which
 * is a fact about the administrator's compute; a missing one answers nothing.
 *
 * ## Supersession, and what it does and does not buy here
 *
 * A jump fires per keystroke, so the same `withSupersession` wrapper
 * `characters:searchLibrary` uses keeps one in flight per socket. The signal
 * means something WEAKER here: PGlite/Drizzle have no query cancellation, so an
 * abort does not stop the work, it suppresses the reply. That is still the
 * point — without it a slow "al" can land after a fast "alder" and the overlay
 * shows the answer to a question the person has already moved past.
 */

import { db } from "$lib/server/db"
import {
	and,
	asc,
	eq,
	exists,
	ilike,
	inArray,
	or,
	sql,
	type SQL
} from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { onLineSql } from "$lib/server/state/lineSql"
import { MAIN_LINE } from "$lib/shared/lorebooks/lineReading"
import type { Handler } from "$lib/shared/events"
import { withSupersession } from "$lib/server/cardSources/inFlightRequests"
import { SessionTypes } from "$lib/shared/constants/SessionTypes"
import {
	ADMIN_ONLY_JUMP_KINDS,
	isJumpKind,
	JUMP_HITS_PER_KIND,
	JUMP_HITS_TOTAL,
	JUMP_KINDS,
	JUMP_MIN_QUERY_LENGTH,
	type JumpGroup,
	type JumpHit,
	type JumpKind,
	type JumpSearchParams,
	type JumpSearchResponse
} from "$lib/shared/sockets/jump"

/**
 * How many words of a query are honoured.
 *
 * Every word adds one OR-group per kind, so an unbounded query is an unbounded
 * SQL expression built from client text. Eight is far past what "brother alder"
 * needs and far short of anything a planner minds.
 */
const MAX_TERMS = 8

/** A second line, short enough to be one. */
const SUBTITLE_LENGTH = 100

/**
 * `%`, `_` and `\` are ILIKE's own vocabulary, so a person who types one means
 * the character rather than the wildcard — a search for `%` must find the rows
 * containing a percent sign, not every row there is.
 *
 * ⚠ The backslash goes FIRST. Escaping it after the other two would also escape
 * the backslashes this function had just added, turning `%` into a literal
 * backslash followed by a live wildcard — the exact bug the escaping is for.
 * `\` is ILIKE's default escape character in Postgres, so no ESCAPE clause is
 * needed; Drizzle parameterises the pattern, so nothing else reinterprets it.
 */
function escapeLike(term: string): string {
	return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
}

/**
 * The words of a query, as `%word%` patterns.
 *
 * Splitting is what makes "brother alder" find a row whose name holds one word
 * and whose description holds the other — see `everyTermMatches`.
 */
function patternsOf(query: string): string[] {
	return query
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, MAX_TERMS)
		.map((term) => `%${escapeLike(term)}%`)
}

/**
 * Every word must match SOMEWHERE in the row's searched fields — an AND of ORs,
 * which is what a person means by typing two words.
 *
 * `patterns` is never empty: the handler answers a query shorter than
 * `JUMP_MIN_QUERY_LENGTH` before it gets here, and a trimmed string of two
 * characters has at least one word in it.
 */
function everyTermMatches(
	patterns: readonly string[],
	fieldsFor: (pattern: string) => (SQL | undefined)[]
): SQL {
	return and(...patterns.map((pattern) => or(...fieldsFor(pattern))!))!
}

function snippet(text: string | null | undefined): string | undefined {
	const trimmed = text?.trim()
	if (!trimmed) return undefined
	return trimmed.length > SUBTITLE_LENGTH
		? `${trimmed.slice(0, SUBTITLE_LENGTH - 1)}…`
		: trimmed
}

/* ------------------------------------------------------------------ *
 * One query per kind. Each names the list handler it borrows from.
 * ------------------------------------------------------------------ */

/**
 * Sessions the requester owns or is a guest of.
 *
 * Visibility borrowed from `buildSessionsListFor` (`sockets/sessions.ts:290`
 * and `:348`): the guest ids are pre-read from the junction and `inArray`'d,
 * guarded on length because Drizzle's `inArray` with an empty array is unsafe,
 * and the list is `ROLEPLAY` only (`sessions.ts:281`). Written as that handler
 * writes it, not as a correlated `EXISTS` that would mean the same thing — the
 * two have to be diffable by eye.
 *
 * The cast is searched too, because a session is far more often remembered by
 * who is in it than by what it was named, and the names are already in the list
 * payload this borrows from (`sessions.ts:300-338`) — no new disclosure. As
 * `EXISTS` rather than a join so two words may match two different cast
 * members; a join would make them match within one product row or not at all.
 */
async function searchSessions(
	userId: number,
	patterns: string[],
	limit: number
): Promise<JumpHit[]> {
	const guestSessions = await db.query.sessionGuests.findMany({
		where: eq(schema.sessionGuests.userId, userId),
		columns: { sessionId: true }
	})
	const guestSessionIds = guestSessions.map((g) => g.sessionId)

	const visible =
		guestSessionIds.length > 0
			? or(
					eq(schema.sessions.userId, userId),
					inArray(schema.sessions.id, guestSessionIds)
				)!
			: eq(schema.sessions.userId, userId)

	const castMatches = (pattern: string) =>
		or(
			exists(
				db
					.select({ one: sql`1` })
					.from(schema.sessionCharacters)
					.innerJoin(
						schema.characters,
						eq(
							schema.characters.id,
							schema.sessionCharacters.characterId
						)
					)
					.where(
						and(
							eq(
								schema.sessionCharacters.sessionId,
								schema.sessions.id
							),
							ilike(schema.characters.name, pattern)
						)
					)
			),
			exists(
				db
					.select({ one: sql`1` })
					.from(schema.sessionPersonas)
					.innerJoin(
						schema.characters,
						eq(
							schema.characters.id,
							schema.sessionPersonas.personaId
						)
					)
					.where(
						and(
							eq(
								schema.sessionPersonas.sessionId,
								schema.sessions.id
							),
							ilike(schema.characters.name, pattern)
						)
					)
			)
		)!

	const rows = await db
		.select({ id: schema.sessions.id, name: schema.sessions.name })
		.from(schema.sessions)
		.where(
			and(
				visible,
				eq(schema.sessions.sessionType, SessionTypes.ROLEPLAY),
				everyTermMatches(patterns, (pattern) => [
					ilike(schema.sessions.name, pattern),
					castMatches(pattern)
				])
			)
		)
		.orderBy(asc(schema.sessions.name), asc(schema.sessions.id))
		.limit(limit)

	return rows.map((row) => ({
		kind: "session" as const,
		id: row.id,
		// A session may legitimately have no name, and a cast match reaches one
		// that has none at all.
		title: row.name?.trim() || "Untitled session"
	}))
}

/**
 * Visibility borrowed from `buildCharactersList` (`sockets/characters.ts:152`):
 * owner, and never a soft-deleted row.
 *
 * Fields are the sidebar's first two (`CharactersSidebar.svelte:130-140`). Its
 * third — tag names — stays out: `tag` is its own jump kind, and folding tag
 * matches into characters makes one shared tag return every character wearing
 * it, crowding every other group out of the total cap.
 */
async function searchCharacters(
	userId: number,
	patterns: string[],
	limit: number
): Promise<JumpHit[]> {
	const rows = await db
		.select({
			id: schema.characters.id,
			name: schema.characters.name,
			description: schema.characters.description,
			isPersona: schema.characters.isPersona
		})
		.from(schema.characters)
		.where(
			and(
				eq(schema.characters.userId, userId),
				eq(schema.characters.isDeleted, false),
				everyTermMatches(patterns, (pattern) => [
					ilike(schema.characters.name, pattern),
					ilike(schema.characters.description, pattern)
				])
			)
		)
		.orderBy(asc(schema.characters.name), asc(schema.characters.id))
		.limit(limit)

	return rows.map((row) => ({
		kind: "character" as const,
		id: row.id,
		title: row.name,
		subtitle: snippet(row.description),
		// The one thing retiring the `persona` jump kind would otherwise have
		// cost: a person searching for the character they PLAY can still tell
		// it apart from the rest of the results.
		...(row.isPersona ? { hint: "persona" as const } : {})
	}))
}

// ⚠ There is no `searchPersonas`: a persona is a character, so it would be the
// same query over the same rows under a second kind. `searchCharacters` above
// carries the `persona` hint instead.

/**
 * Visibility borrowed from `buildLorebooksList` (`sockets/lorebooks.ts:157`):
 * owner. Lorebooks carry no soft-delete column.
 */
async function searchLorebooks(
	userId: number,
	patterns: string[],
	limit: number
): Promise<JumpHit[]> {
	const rows = await db
		.select({
			id: schema.lorebooks.id,
			name: schema.lorebooks.name,
			description: schema.lorebooks.description
		})
		.from(schema.lorebooks)
		.where(
			and(
				eq(schema.lorebooks.userId, userId),
				everyTermMatches(patterns, (pattern) => [
					ilike(schema.lorebooks.name, pattern)
				])
			)
		)
		.orderBy(asc(schema.lorebooks.name), asc(schema.lorebooks.id))
		.limit(limit)

	return rows.map((row) => ({
		kind: "lorebook" as const,
		id: row.id,
		title: row.name,
		subtitle: snippet(row.description)
	}))
}

/**
 * An entry is visible through its book, which is how `entries:list` reads it
 * too — `findOwnedBook` (`sockets/entries.ts:196`) proves the book's owner
 * before a single row is read. Here that is the same predicate as an inner join
 * onto `lorebooks` with the book's own where-clause on it, which also supplies
 * the subtitle, so an entry is never read except through a book this user owns.
 *
 * `keys` is a `text[]` (28's escape-free keywords), so it is flattened for the
 * match the way the client's own pool filter flattens it
 * (`lorebooks/poolFilter.ts:134`).
 *
 * ⚠ **What the workspace a jump opens would list** (2026-09-28): a jump opens
 * the book on main (the hit names no line), and the default list shows
 * neither archived rows nor another line's own. So both are out here too — a
 * hit that opens onto a list without it is a jump to nowhere. A line-aware
 * jump needs the hit to carry the line it was found on.
 */
async function searchEntries(
	userId: number,
	patterns: string[],
	limit: number
): Promise<JumpHit[]> {
	const keysAsText = sql<string>`array_to_string(${schema.lorebookEntries.keys}, ' ')`

	const rows = await db
		.select({
			id: schema.lorebookEntries.id,
			title: schema.lorebookEntries.title,
			keys: schema.lorebookEntries.keys,
			lorebookId: schema.lorebookEntries.lorebookId,
			lorebookName: schema.lorebooks.name
		})
		.from(schema.lorebookEntries)
		.innerJoin(
			schema.lorebooks,
			eq(schema.lorebooks.id, schema.lorebookEntries.lorebookId)
		)
		.where(
			and(
				eq(schema.lorebooks.userId, userId),
				eq(schema.lorebookEntries.archived, false),
				// Main's line: shared rows only (`onLineSql(…, MAIN_LINE)`).
				onLineSql(schema.lorebookEntries.branchId, MAIN_LINE),
				everyTermMatches(patterns, (pattern) => [
					ilike(schema.lorebookEntries.title, pattern),
					ilike(keysAsText, pattern)
				])
			)
		)
		.orderBy(
			asc(schema.lorebookEntries.title),
			asc(schema.lorebookEntries.id)
		)
		.limit(limit)

	return rows.map((row) => ({
		kind: "entry" as const,
		id: row.id,
		// `title` is nullable, and a keyword match reaches an entry with none.
		title: row.title?.trim() || row.keys[0] || "Untitled entry",
		subtitle: row.lorebookName,
		parentId: row.lorebookId
	}))
}

/** Visibility borrowed from `buildTagsList` (`sockets/tags.ts:32`): owner. */
async function searchTags(
	userId: number,
	patterns: string[],
	limit: number
): Promise<JumpHit[]> {
	const rows = await db
		.select({
			id: schema.tags.id,
			name: schema.tags.name,
			description: schema.tags.description
		})
		.from(schema.tags)
		.where(
			and(
				eq(schema.tags.userId, userId),
				everyTermMatches(patterns, (pattern) => [
					ilike(schema.tags.name, pattern)
				])
			)
		)
		.orderBy(asc(schema.tags.name), asc(schema.tags.id))
		.limit(limit)

	return rows.map((row) => ({
		kind: "tag" as const,
		id: row.id,
		title: row.name,
		subtitle: snippet(row.description)
	}))
}

/**
 * ⚠ **Admin only, and unscoped by design.** Connections belong to the instance,
 * not to a user — `buildConnectionsList` (`sockets/connections.ts:117`) takes
 * no `userId` and has no ownership clause, because "the list is the same for
 * every admin, and only admins are answered". The admin test is the caller's,
 * at `runJumpSearch`, for the same reason `modelGate` keeps its own: the kind is
 * never reached at all for anyone else.
 *
 * A model match returns the ENDPOINT, since that is what a jump can open; as
 * `EXISTS` rather than a join so one connection cannot appear once per model.
 */
async function searchConnections(
	patterns: string[],
	limit: number
): Promise<JumpHit[]> {
	const modelMatches = (pattern: string) =>
		exists(
			db
				.select({ one: sql`1` })
				.from(schema.connectionModels)
				.where(
					and(
						eq(
							schema.connectionModels.connectionId,
							schema.connections.id
						),
						or(
							ilike(schema.connectionModels.name, pattern),
							ilike(schema.connectionModels.model, pattern)
						)
					)
				)
		)

	const rows = await db
		.select({ id: schema.connections.id, name: schema.connections.name })
		.from(schema.connections)
		.where(
			everyTermMatches(patterns, (pattern) => [
				ilike(schema.connections.name, pattern),
				modelMatches(pattern)
			])
		)
		.orderBy(asc(schema.connections.name), asc(schema.connections.id))
		.limit(limit)

	return rows.map((row) => ({
		kind: "connection" as const,
		id: row.id,
		title: row.name
	}))
}

/**
 * ⚠ **Admin only** — `users:list` is `if (!socket.user!.isAdmin) throw`
 * (`sockets/users.ts:535`), and this borrows its `isDeleted` clause
 * (`users.ts:549`).
 *
 * It does NOT borrow that handler's search predicate: `users:list` matches with
 * `like` against a `.toLowerCase()`d pattern (`users.ts:556-561`), so an account
 * named `Alice` is invisible to a search for `alice` there. Fixed here rather
 * than copied — `ilike` is what every case-insensitive match in this file uses.
 */
async function searchUsers(
	patterns: string[],
	limit: number
): Promise<JumpHit[]> {
	const rows = await db
		.select({
			id: schema.users.id,
			username: schema.users.username,
			displayName: schema.users.displayName
		})
		.from(schema.users)
		.where(
			and(
				eq(schema.users.isDeleted, false),
				everyTermMatches(patterns, (pattern) => [
					ilike(schema.users.username, pattern),
					ilike(schema.users.displayName, pattern)
				])
			)
		)
		.orderBy(asc(schema.users.username), asc(schema.users.id))
		.limit(limit)

	return rows.map((row) => {
		const displayName = row.displayName?.trim()
		return {
			kind: "user" as const,
			id: row.id,
			title: displayName || row.username,
			// Which account a display name belongs to, when the two differ.
			subtitle: displayName ? row.username : undefined
		}
	})
}

/* ------------------------------------------------------------------ */

/**
 * Which kinds this request asks for, intersected with what it may have.
 *
 * ⚠ The admin intersection is here and NOT at each query, so there is one place
 * to read for "could a non-admin ever reach this table". A kind filtered out
 * here is never searched, so its group is absent rather than empty — the whole
 * point (see the module header).
 *
 * `kinds` arrives from a client, so only its ABSENCE means "every kind". A
 * `kinds` that is present but unusable — not an array, or an array of nothing
 * this recognises — means the request named no kind this can answer, and the
 * reply is empty. A junk array and a junk non-array have to agree: the one
 * reading where they differ is the one where a malformed field quietly widens
 * a request that was trying to narrow.
 */
function requestedKinds(
	params: JumpSearchParams,
	isAdmin: boolean
): JumpKind[] {
	const asked =
		params?.kinds === undefined
			? undefined
			: Array.isArray(params.kinds)
				? params.kinds.filter(isJumpKind)
				: []
	const wanted = asked === undefined ? [...JUMP_KINDS] : asked
	const wantedSet = new Set(wanted)
	// Walked in JUMP_KINDS order rather than the caller's, so the group order of
	// a reply is the contract's and not the client's.
	return JUMP_KINDS.filter(
		(kind) =>
			wantedSet.has(kind) && (isAdmin || !ADMIN_ONLY_JUMP_KINDS.has(kind))
	)
}

/**
 * Anything that is not a real number falls back to the default rather than
 * reaching `.limit()` — a client is what supplies this, and `Number.isFinite`
 * does not coerce, so `"40"`, `null` and `NaN` all land on the default.
 */
function perKindLimit(limit: number | undefined): number {
	if (typeof limit !== "number" || !Number.isFinite(limit))
		return JUMP_HITS_PER_KIND
	// Clamped at the total, which is the ceiling a reply cannot pass anyway.
	return Math.min(Math.max(1, Math.floor(limit)), JUMP_HITS_TOTAL)
}

async function runJumpSearch(
	socket: any,
	params: JumpSearchParams
): Promise<JumpSearchResponse> {
	// `params` is whatever the socket sent. A query that is not a string is
	// answered as an empty one rather than thrown on — the reply's `query` is
	// what a client matches its own request against, so it has to be a string
	// in every reply, including this one.
	const query = typeof params?.query === "string" ? params.query.trim() : ""
	if (query.length < JUMP_MIN_QUERY_LENGTH) return { query, groups: [] }

	const userId = socket.user!.id
	// The same spelling the connections and users handlers use, so the three
	// read as one rule rather than three opinions.
	const isAdmin = !!socket.user!.isAdmin
	const patterns = patternsOf(query)
	const limit = perKindLimit(params.limit)
	const kinds = requestedKinds(params, isAdmin)

	const searched = await Promise.all(
		kinds.map(async (kind): Promise<[JumpKind, JumpHit[]]> => {
			switch (kind) {
				case "session":
					return [kind, await searchSessions(userId, patterns, limit)]
				case "character":
					return [
						kind,
						await searchCharacters(userId, patterns, limit)
					]
				case "lorebook":
					return [
						kind,
						await searchLorebooks(userId, patterns, limit)
					]
				case "entry":
					return [kind, await searchEntries(userId, patterns, limit)]
				case "tag":
					return [kind, await searchTags(userId, patterns, limit)]
				case "connection":
					return [kind, await searchConnections(patterns, limit)]
				case "user":
					return [kind, await searchUsers(patterns, limit)]
			}
		})
	)

	// `kinds` is already in JUMP_KINDS order, and Promise.all preserves it.
	const groups: JumpGroup[] = []
	let total = 0
	for (const [kind, hits] of searched) {
		if (hits.length === 0) continue
		const room = JUMP_HITS_TOTAL - total
		if (room <= 0) break
		const kept = hits.length > room ? hits.slice(0, room) : hits
		groups.push({ kind, hits: kept })
		total += kept.length
	}

	return { query, groups }
}

export const jumpSearch: Handler<
	JumpSearchParams,
	// | undefined: a superseded request (see withSupersession) resolves with no
	// response at all rather than throwing — the same honest widening
	// `charactersSearchLibrary` takes, since register() never reads a handler's
	// resolved value.
	JumpSearchResponse | undefined
> = {
	event: "jump:search",
	handler: async (socket, params, emitToUser) => {
		return withSupersession(socket.id, "jump:search", async (signal) => {
			try {
				const res = await runJumpSearch(socket, params ?? {})
				if (signal.aborted) {
					// A newer keystroke from this same socket already asked a
					// different question. Emitting now would overwrite its
					// answer with a stale one; routine, not worth logging.
					return undefined
				}
				emitToUser("jump:search", res)
				return res
			} catch (error: any) {
				if (signal.aborted) return undefined
				console.error("Jump search error:", error)
				emitToUser("jump:search:error", {
					error: "Failed to search."
				})
				throw error
			}
		})
	}
}

export function registerJumpHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, jumpSearch, emitToUser)
}
