/**
 * The host's `lorebook_entries` read: a session's lore, from the books the
 * run may read, memoised per run in the map `createHost` hands it.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	BINDING_VISIBILITY_POLICY,
	ENTRY_TYPE_IDS,
	toEntryRow
} from "$lib/server/utils/lorebookEntries"
import { entryDeclaration, bandOfType } from "$lib/server/entries/declarations"
import { membersAsRead } from "$lib/server/cast/memberAsRead"
import { storedSeatRef } from "$lib/server/state/seatRefs"
import { parseSeatRef, seatOf } from "$lib/server/sessions/seats"
import { inPlay } from "$lib/shared/sessions/inPlay"
import {
	NO_SUCH_CHARACTER,
	speakerIsWired,
	loreVisibilitySubject,
	cardFormOfStored,
	assertScoped,
	hydrateBindings,
	toLoreEntry
} from "./host.helpers"
import type { HostReadArgs } from "./host.types"
import {
	loadEntryKnowledge,
	noteKnowledgeDrop,
	type EntryKnowledgeRead,
	type KnowledgeDrop
} from "$lib/server/lorebooks/entryKnowledge"

import {
	REPLACED_DAY_CAP,
	fitSummaries,
	historyDaysInCast,
	loadSessionSceneCasts,
	loadSpeakerOfRef,
	noteInCastHistory,
	speakerInCastReadOf,
	type InCastHistory,
	type SessionSceneCasts,
	type SpeakerInCastRead
} from "$lib/server/sessions/speakerInCast"

/**
 * 🚧 The participant ref a turn's speaker is read as: `seated-member:<member>`
 * for a card-less seat, else `character:<card>`, else none (reads everything).
 * One ref for the knowledge judgement and the speaker-in-cast judgement.
 */
export function lorebookSpeakerRef(speaker: {
	card: unknown
	member: unknown
}): string | null {
	return speaker.member != null
		? `seated-member:${speaker.member}`
		: speaker.card != null && speaker.card !== NO_SUCH_CHARACTER
			? `character:${speaker.card}`
			: null
}

/** 🚧 One run's memo of `load`, kept on the host's `lorebookReads` map. */
function memoPerRun<T>(
	reads: Map<string, Promise<any>>,
	key: string,
	load: () => Promise<T>
): Promise<T> {
	let pending = reads.get(key)
	if (!pending) {
		pending = load()
		reads.set(key, pending)
		pending.catch(() => reads.delete(key))
	}
	return pending
}

/** 🚧 The session's scenes and stored casts, loaded once per run. */
export function sessionSceneCastsOf(
	db: HostReadArgs["db"],
	sessionId: number,
	reads: Map<string, Promise<any>>
): Promise<SessionSceneCasts> {
	return memoPerRun(reads, `scene-casts:${sessionId}`, () =>
		loadSessionSceneCasts(db, sessionId)
	)
}

/**
 * 🚧 The speaker's judgement over the session's scenes: the scenes and casts
 * once per run, the speaker once per ref. No ref, or a ref naming no cast
 * member: reads everything. Shared by the lore read and the `speaker_in_cast`
 * read.
 */
export async function speakerInCastOf(
	db: HostReadArgs["db"],
	sessionId: number,
	ref: string | null,
	reads: Map<string, Promise<any>>
): Promise<SpeakerInCastRead> {
	if (ref === null) return { kind: "reads-all" }
	const casts = await sessionSceneCastsOf(db, sessionId, reads)
	const speaker = await memoPerRun(
		reads,
		`speaker-in-cast:${sessionId}:${ref}`,
		() => loadSpeakerOfRef(db, sessionId, ref)
	)
	return speakerInCastReadOf(casts, speaker)
}

const HISTORY_LEFT_OUT = new WeakMap<object, number>()

/** 🚧 Records how many history entries a timeline-off read left out, on the rows it returns. */
export function noteHistoryLeftOut(rows: object, count: number): void {
	HISTORY_LEFT_OUT.set(rows, count)
}

/**
 * 🚧 ★ The receipt sentence for the read that returned `rows`; undefined when
 * it left no history entry out.
 */
export function historyLeftOutReceipt(rows: unknown): string | undefined {
	const n =
		typeof rows === "object" && rows !== null
			? HISTORY_LEFT_OUT.get(rows)
			: undefined
	if (!n) return undefined
	return `${n} history ${n === 1 ? "entry" : "entries"} left out: this lorebook keeps no timeline`
}

export async function readLorebookEntries(
	{ db, scope, node, q }: HostReadArgs,
	lorebookReads: Map<string, Promise<any>>
): Promise<unknown> {
	// The session's lorebook, or nothing. A pipeline cannot name a
	// lorebook it was not triggered against — lore is session-scoped
	// data and a spec that could reach any lorebook could read one
	// belonging to another user's session.
	const sessionId = q.sessionId ?? scope.sessionId
	assertScoped(node, q.sessionId, scope.sessionId)
	if (sessionId === undefined) return []

	const [session] = await db
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return []
	/**
	 * The books the session reads (§26): its attached lorebook,
	 * then its own notes (its own book) — each read whole by the
	 * per-book read below, at its own reading, and the union
	 * returned with the notes' rows marked `sessionOnly`, as
	 * every other union read marks them (`sessionEntriesAsRead`).
	 * A session with no book but notes reads its notes.
	 */
	const { lorebooksReadBy } = await import(
		"$lib/server/lorebooks/ownBook"
	)
	const books = await lorebooksReadBy(db, {
		id: sessionId,
		lorebookId: session.lorebookId ?? null
	})
	if (!books.ids.length) return []

	/**
	 * Where the session reads its book (owner ruling 3,
	 * 2026-09-28): its line — the ancestor chain with every
	 * fork cut — at its story clock, or at the head of the
	 * line when it has no clock. Two things follow and both
	 * were missing (findings #135, #143, #144):
	 *
	 *  - **which rows**: shared rows plus the chain's own, a
	 *    dated row cut at the moment and at its step's fork
	 *    (`entryOnReadingSql`). A fork's entry reaching main,
	 *    or a sibling's reaching this line, is lore from a
	 *    story this session is not in;
	 *  - **what they say**: every entry amendment on the line
	 *    that has happened by the moment, applied to the wire
	 *    row before ANY mechanism sees it (`entryAt`) — so the
	 *    keyword scan, the vector gate, the listing and the
	 *    prompt all read the entry as it stands now, not as it
	 *    was first written. (Its stored VECTOR is still the
	 *    base text's — owner ruling R1, see `ragContext.ts`.)
	 *
	 * On main with no clock the rule is `branch_id IS NULL`
	 * and no amendment exists, so a book with no lines reads
	 * exactly what it always did — the parity corpus pins it.
	 */
	const { sessionReadingOf } = await import(
		"$lib/server/state/reading"
	)
	const {
		MAIN_HEAD,
		amendedFieldNames,
		entryAt,
		entryOnReadingSql,
		entryOverlaysFor
	} = await import("$lib/server/state/entriesOnReading")
	// The session's reading: of the attached book, or of its own
	// notes when it reads them alone (a fold can leave it on a line
	// of them). Beside an attached book the notes read at their head.
	const readingOrNone = await sessionReadingOf(db, sessionId)
	const sessionReading = readingOrNone ?? MAIN_HEAD
	// 🚧 `seated-member:<memberId>` is accepted (seat-cast S2) and
	// answered in the card form the subject reads. A member nobody
	// is seated as stays as written, which is no character today.
	// 🚧 A wired speaker that is a card-less seat's `seated-member:`
	// ref is that member's turn (`member`), never a card's.
	const wiredStored =
		typeof q.speaker === "string"
			? await storedSeatRef(db, sessionId, q.speaker)
			: null
	const cardlessSeat =
		wiredStored !== null &&
		parseSeatRef(wiredStored)?.form === "seated-member"
			? await seatOf(db, sessionId, wiredStored)
			: null
	const speaker = loreVisibilitySubject(
		typeof q.speaker === "string"
			? {
					...q,
					speaker:
						(await cardFormOfStored(
							db,
							sessionId,
							wiredStored
						)) ?? q.speaker
				}
			: q,
		cardlessSeat && cardlessSeat.cardId == null
			? (cardlessSeat.castMemberId ?? null)
			: null
	)
	const readBook = async (bookId: number, reading: any) => {
	/**
	 * **The book is read once per run** (plan C4). A respond turn asks
	 * this case up to six times — the three keyword lanes, the vector and
	 * entity arms, the hop — and every one of them read the same book at
	 * the same reading: the overlays, the cast, the seats, the scan.
	 * Everything that does not depend on the asker is now read once and
	 * kept on the host (`lorebookReads`; one host serves one run), keyed
	 * on the session, its book and the reading. The reading is still
	 * asked every time, so a clock the run advanced reads a new moment,
	 * never the old one. Per asker, only the narrowings (one scan each,
	 * also kept) and the speaker's gate run again.
	 *
	 * A run is a snapshot: nothing invalidates the memo except a lore
	 * entry this host itself writes (`core:outlet/create-lore-entry`
	 * clears it), so a run that files a room and then lists the book
	 * sees the room. No content hash moves — the rows are the rows the
	 * reads always produced.
	 */
	const bookKey = `${sessionId}:${bookId}:${JSON.stringify(reading)}`
	let bookPending = lorebookReads.get(bookKey)
	if (!bookPending) {
		bookPending = (async () => {
			const overlays = await entryOverlaysFor(
				db,
				bookId,
				reading
			)
			const amended = amendedFieldNames(overlays)

			/**
			 * Each row as the reading sees it, keyed by id — the wire
			 * shape (`toEntryRow`), with the keys left as the stored
			 * LIST: joining them for the wire and splitting them again
			 * in the matcher tore a regex `{1,3}` in two (finding
			 * #146). The editor now sends amendment `keys` as a list
			 * too; an amendment stored before that may still hold the
			 * comma string, and the matcher reads both.
			 */
			// 🚧 ★5 (ties T3): the fields the rules fed onto the attached book while the session may not write it — its notes' rule-fed overlay.
			const ruleFed =
				bookId === books.attachedId && books.ownBookId != null
					? ((await (await import("$lib/server/rulesets/ties")).ruleFedOverlayOf(db, sessionId))?.entryFields ?? null)
					: null
			const { declaredFields } = await import("$lib/server/entries/declarations")
			const resolvedOf = (row: any) => {
				const seen = entryAt(
					{
						...toEntryRow(row),
						keys: row.keys ?? [],
						secondaryKeys: row.secondaryKeys ?? []
					} as any,
					overlays,
					reading
				)
				const fed = ruleFed?.[String(row.id)]
				if (!fed) return seen
				const own = new Set(declaredFields(row.typeId))
				return { ...seen, ...Object.fromEntries(Object.entries(fed).filter(([k]) => own.has(k))) }
			}

			/**
			 * Normalized here, at the read, for the same reason
			 * `session_messages` honours `isHidden` here rather than in
			 * each binding: a new Query type cannot forget it.
			 *
			 * Two transforms, and **both were missing on the pipeline
			 * path entirely** — found by mapping what only the legacy
			 * engines called. `@@` decorator lines were reaching models
			 * as literal text while `handlebarsLint.ts` promises users
			 * they are stripped, and `{{char:1}}` binding placeholders
			 * were arriving unsubstituted. The still-legacy token-count
			 * preview *did* strip them, so the number on screen and the
			 * prompt actually sent disagreed on any session using either.
			 *
			 * The legacy function is reused rather than reimplemented.
			 * A second copy of "what a lore entry looks like once it is
			 * ready" is exactly the drift this branch keeps finding —
			 * and this one would show up as a prompt difference nobody
			 * could localise. It relocates with the module when the
			 * legacy split happens; it does not get rewritten.
			 */
			const bindings = await db
				.select({
					id: schema.lorebookBindings.id,
					lorebookId: schema.lorebookBindings.lorebookId,
					binding: schema.lorebookBindings.binding,
					characterId:
						schema.lorebookBindings.characterId,
					name: schema.lorebookBindings.name
				})
				.from(schema.lorebookBindings)
				.where(
					eq(
						schema.lorebookBindings.lorebookId,
						bookId
					)
				)
			/**
			 * Every card of each member's (plan A25): the linked one and
			 * each a dated change draws them with, on any line and at
			 * any date. A seat holding any of them is that member, so
			 * the private-lore gate below reads them as `memberCards`
			 * on the binding.
			 */
			const { castMemberCards } = await import(
				"$lib/server/utils/castMemberCards"
			)
			const { cardsOf } = await castMemberCards(
				db,
				bookId
			)
			/**
			 * Each member as the session's reading has them (plan A19):
			 * a cast version by then renames them (`membersAsRead`), and
			 * a tag reads as the member's name as read — nickname first —
			 * else the card their version in force draws them with
			 * (`character`). `characterId` stays the member's own: it is
			 * the key a seat holds, and the private-lore gate below
			 * reads it.
			 */
			const memberReads = await membersAsRead(
				db,
				bindings.map((b) => b.id),
				{ reading }
			)
			const atReading = bindings.map((b) => {
				const read = memberReads.get(b.id)
				return {
					id: b.id,
					lorebookId: b.lorebookId,
					binding: b.binding,
					name: read?.name ?? b.name ?? null,
					shownName: read?.shownName ?? null,
					characterId: read?.activeCardId ?? null
				}
			})
			const hydrated = (await hydrateBindings(db, atReading)).map(
				(m, i) => {
					// A deleted card is nobody in a lorebook (plan A25): a
					// member who read the card's words reads as their own
					// name on the book's row instead.
					const goneCard =
						m.characterId != null && m.character == null
					const read = memberReads.get(m.id)
					return {
						...m,
						name:
							goneCard && read?.follows.includes("name")
								? (bindings[i].name ?? null)
								: (m.name ?? null),
						shownName: goneCard ? null : m.shownName,
						characterId: bindings[i].characterId,
						memberCards: cardsOf.get(m.id) ?? []
					}
				}
			)
			/**
			 * Which character each binding names, for character lore's
			 * co-occurrence signal.
			 *
			 * Resolved here because the rows are already in hand — the
			 * ranker asking for them again would be a second query per
			 * turn for a fact this read has already paid for. A binding
			 * naming nobody resolves to null, which is what legacy's
			 * `binding?.characterId` test does.
			 *
			 * The card is the one this session SEATS of the member's
			 * (plan A25) — the signal asks whether that card spoke, and
			 * a seat holding the keeper's card speaks as it — else the
			 * linked card. The linked card wins when both are seated.
			 * 🚧 A seat that seats the member by id (seat-cast S2) is
			 * found first, whatever card mapping says; the card
			 * mapping answers for a seat that seats nobody yet.
			 */
			const seatRows = await db
				.select({
					characterId:
						schema.sessionCharacters.characterId,
					castMemberId:
						schema.sessionCharacters.castMemberId,
					removedAt: schema.sessionCharacters.removedAt,
					isActive: schema.sessionCharacters.isActive
				})
				.from(schema.sessionCharacters)
				.where(
					eq(
						schema.sessionCharacters.sessionId,
						sessionId
					)
				)
				.orderBy(
					asc(schema.sessionCharacters.position),
					asc(schema.sessionCharacters.id)
				)
			const seated = new Set(seatRows.map((r) => r.characterId))
			const bindingCharacter = new Map<number, number | null>(
				bindings.map((b) => {
					const held = seatRows
						.filter(
							(r) =>
								r.castMemberId === b.id &&
								r.characterId != null
						)
						.map((r) => r.characterId)
					return [
						b.id,
						held.length
							? b.characterId != null &&
								held.includes(b.characterId)
								? b.characterId
								: held[0]
							: b.characterId != null &&
								  seated.has(b.characterId)
								? b.characterId
								: ((cardsOf.get(b.id) ?? []).find((c) =>
										seated.has(c)
									) ??
									b.characterId ??
									null)
					]
				})
			)
			const boundCharacterOf = (e: any) =>
				e?.lorebookBindingId != null
					? (bindingCharacter.get(e.lorebookBindingId) ??
						null)
					: null
			// The visibility rule below reads the session's personas, so
			// they are part of the shape it is handed.
			const sessionPersonas = await db
				.select()
				.from(schema.sessionPersonas)
				.where(eq(schema.sessionPersonas.sessionId, sessionId))
			const asSession = {
				lorebookId: bookId,
				lorebook: {
					id: bookId,
					lorebookBindings: hydrated
				},
				sessionPersonas: sessionPersonas.map((cp) => ({
					persona: { id: cp.personaId },
					castMemberId: cp.castMemberId,
					removedAt: cp.removedAt,
					isActive: cp.isActive
				})),
				// ★4: seated = a seat in play of either table holds the
				// member (benched reads as background, owner 2026-11-10);
				// the gate reads background as "not seated".
				// A seat that names no member (an older, member-less seat)
				// still seats the member whose card it holds — linked, or
				// one a dated change draws them with (`memberCards`).
				seatedMemberIds: (() => {
					const liveCards = new Set<number>(
						[
							...seatRows
								.filter((r) => inPlay(r))
								.map((r) => r.characterId),
							...sessionPersonas
								.filter((cp) => inPlay(cp))
								.map((cp) => cp.personaId)
						].filter((id): id is number => id != null)
					)
					return [
						...seatRows
							.filter((r) => inPlay(r))
							.map((r) => r.castMemberId),
						...sessionPersonas
							.filter((cp) => inPlay(cp))
							.map((cp) => cp.castMemberId),
						...bindings
							.filter(
								(b) =>
									(b.characterId != null &&
										liveCards.has(b.characterId)) ||
									(cardsOf.get(b.id) ?? []).some((c) =>
										liveCards.has(c)
									)
							)
							.map((b) => b.id)
					].filter((id): id is number => id != null)
				})()
			} as any

			const {
				populateLorebookEntryBindings,
				isCharacterLoreEntryVisible,
				castTagName
			} = await import(
				"$lib/server/pipelines/prompt/characterLore"
			)
			const ready = (e: any) =>
				populateLorebookEntryBindings(e, asSession)
			/**
			 * The cast member an anchored row is bound to, named as the
			 * reading has them (`castTagName` — the name its cast tag
			 * reads as). Assemble's `characterLore` shows it beside the
			 * entry, so a template placing the block apart from the
			 * cards still says whose each secret is. Null for a row
			 * bound to nobody.
			 */
			const hydratedById = new Map(
				hydrated.map((b: any) => [b.id, b])
			)
			const castMemberOf = (e: any): string | null => {
				const b =
					e?.lorebookBindingId != null
						? hydratedById.get(e.lorebookBindingId)
						: undefined
				return (b && castTagName(b)) || null
			}

			/**
			 * The annotation lane's own content hash, borrowed whole —
			 * see `entrySourceHash`. Imported the way this case imports
			 * everything else it needs, so the module graph a socket
			 * pulls in is unchanged.
			 */
			const { entrySourceHash } = await import(
				"$lib/server/annotations"
			)

			/**
			 * Each row as the reading sees it, made ready for a prompt
			 * (`ready` rewrites the content in place, so it runs once
			 * per row per run, never once per asker).
			 */
			const entries = new Map<number, any>()
			const entryOf = (row: { id: number }) => {
				let entry = entries.get(row.id)
				if (!entry) {
					entry = ready(resolvedOf(row))
					entries.set(row.id, entry)
				}
				return entry
			}
			return {
				amended,
				entryOf,
				asSession,
				boundCharacterOf,
				castMemberOf,
				entrySourceHash,
				isCharacterLoreEntryVisible,
				scans: new Map<
					string,
					Promise<Array<typeof schema.lorebookEntries.$inferSelect>>
				>()
			}
		})()
		lorebookReads.set(bookKey, bookPending)
		// A failed read is not a snapshot: the next asker reads again.
		bookPending.catch(() => lorebookReads.delete(bookKey))
	}
	const {
		amended,
		entryOf,
		asSession,
		boundCharacterOf,
		castMemberOf,
		entrySourceHash,
		isCharacterLoreEntryVisible,
		scans
	} = await bookPending


	/**
	 * The five optional narrowings, added for
	 * `core:query/lorebook-entries@1` — the **listing** door.
	 *
	 * Every one of them is a no-op when the caller omits it, so
	 * the retrieval path (`loreFor`, `lorebook-triggers@1`,
	 * which pass `sessionId` and `currentCharacterId` and
	 * nothing else) reads exactly the SQL it always did: the
	 * whole book, no `LIMIT`, disabled and archived rows
	 * included. That last part is load-bearing rather than
	 * incidental — the keyword scan reports a disabled entry on
	 * `skipped` with a reason, which is how a person is told
	 * why their lore did not come in, and a filter here would
	 * turn that sentence into silence.
	 *
	 * The listing asks for the other posture — `enabled: true`,
	 * `archived: false` — because it answers *does this exist*
	 * and *pick one of these*, where a switched-off room must
	 * not exist and a shelved suspect must not be picked.
	 * `archived`'s own column comment is the rule: *don't
	 * retrieve it and don't show it to me.*
	 */
	const wheres = [
		eq(schema.lorebookEntries.lorebookId, bookId),
		entryOnReadingSql(reading)
	]
	/**
	 * The narrowings an amendment can move — the title, Off,
	 * archived — are asked of the RESOLVED row once one of the
	 * line's amendments sets that field: the stored column is
	 * then not what the entry says. Otherwise they stay in SQL,
	 * and so does the row ceiling below.
	 */
	const afterResolve: Array<(e: any) => boolean> = []
	// Bare type ids, no `@version`: a type's rows are its rows
	// across versions, and `type_version` is its own column.
	// An id no type declares matches nothing, which is the
	// honest answer to a typo.
	const wantedTypes = Array.isArray(q.entryTypes)
		? q.entryTypes.filter(
				(t: unknown) =>
					typeof t === "string" && t.length > 0
			)
		: []
	if (wantedTypes.length)
		wheres.push(
			inArray(schema.lorebookEntries.typeId, wantedTypes)
		)
	/**
	 * Exact, case-insensitive, both ends trimmed — never a
	 * substring and never a pattern. The question this answers
	 * is "is there an entry called X", and a match that also
	 * returned "X Door" would answer one nobody asked; the
	 * search-shaped reading of this is the keyword scan, which
	 * already exists.
	 *
	 * `title` is the column the `title` **field role** names on
	 * both types that declare one (`core-catalog/entries.ts`).
	 * History declares no title at all, so a named read lists
	 * no history — the same `null` `toEntryRow` already
	 * publishes for it.
	 */
	if (typeof q.name === "string" && q.name.trim() !== "") {
		const wanted = q.name.trim().toLowerCase()
		if (amended.has("name"))
			afterResolve.push(
				(e) =>
					typeof e.name === "string" &&
					e.name.trim().toLowerCase() === wanted
			)
		else
			wheres.push(
				sql`lower(btrim(${schema.lorebookEntries.title})) = ${wanted}`
			)
	}
	if (typeof q.enabled === "boolean") {
		const want = q.enabled
		if (amended.has("enabled"))
			afterResolve.push((e) => (e.enabled !== false) === want)
		else
			wheres.push(
				eq(schema.lorebookEntries.enabled, want)
			)
	}
	if (typeof q.archived === "boolean") {
		const want = q.archived
		if (amended.has("archived"))
			afterResolve.push((e) => (e.archived === true) === want)
		else
			wheres.push(
				eq(schema.lorebookEntries.archived, want)
			)
	}

	/**
	 * One scan of one table for every type.
	 *
	 * Ordered by id because a single scan interleaves the
	 * types, and partitioning in memory preserves whatever
	 * order the heap gave, which is arbitrary. Id order is the
	 * one deterministic choice.
	 *
	 * Under a ceiling the NEWEST rows are the ones kept (plan
	 * A27): read from the newest down, then put back in id
	 * order. A book past the ceiling otherwise dropped the room
	 * Answer the door had just built from the next turn's
	 * `{{knownLocations}}`.
	 */
	const capped = typeof q.limit === "number"
	const scan = db
		.select()
		.from(schema.lorebookEntries)
		.where(and(...wheres))
		.orderBy(
			capped
				? desc(schema.lorebookEntries.id)
				: asc(schema.lorebookEntries.id)
		)
	/**
	 * A ceiling on **rows read**, and the gate below may still
	 * reduce it: a caller asking for 50 and speaking as a
	 * character can be handed fewer, because the 50 cheapest
	 * rows to fetch are chosen before anyone asks who may see
	 * them. Limiting after the gate would mean reading the
	 * whole book to honour a cap, which is the cost the cap
	 * exists to avoid. In the case the listing exists for —
	 * narrator-shaped, nothing gated — the count is exact.
	 */
	// One scan per set of narrowings per run (C4): the retrieval
	// lanes all ask the bare book and share it.
	const scanKey = JSON.stringify([
		wantedTypes,
		typeof q.name === "string" ? q.name.trim().toLowerCase() : null,
		typeof q.enabled === "boolean" ? q.enabled : null,
		typeof q.archived === "boolean" ? q.archived : null,
		capped ? q.limit : null
	])
	let scanned = scans.get(scanKey)
	if (!scanned) {
		scanned = (async () => {
			let rows: Array<typeof schema.lorebookEntries.$inferSelect>
			if (afterResolve.length === 0) {
				rows = await (capped ? scan.limit(q.limit) : scan)
			} else {
				// A narrowing an amendment moved: every candidate is
				// resolved before it is asked, and the ceiling counts
				// what survived — never rows an amendment turned away.
				rows = []
				for (const row of await scan) {
					if (capped && rows.length >= q.limit) break
					if (!afterResolve.every((keep) => keep(entryOf(row))))
						continue
					rows.push(row)
				}
			}
			// Back in id order: the ceiling chose which rows, never their order.
			if (capped) rows.reverse()
			return rows
		})()
		scans.set(scanKey, scanned)
		scanned.catch(() => scans.delete(scanKey))
	}
	const rows = await scanned


	/**
	 * Character lore is private self-knowledge.
	 *
	 * An entry bound to a character is visible only while
	 * generating *as* that character; one bound to nothing is
	 * the Narrator's alone. The legacy engines have always
	 * enforced this and the pipeline path never did — so every
	 * character's private lore has been competing for the same
	 * ranking budget as world lore on every turn, and would
	 * have leaked outright the moment character lore was wired
	 * into the cast cards.
	 *
	 * `currentCharacterId` is `null` in narrator mode, which the
	 * rule treats as omniscient. A read that does not supply it
	 * is therefore narrator-shaped by default — the callers all
	 * pass it, and the coalesce keeps `undefined` from silently
	 * meaning "some character".
	 *
	 * ## `speaker` — per-speaker scope (W1, 2026-09-17)
	 *
	 * The run has ONE scope and a gather runs ONCE, so without
	 * a per-speaker subject every voice of a multi-agent turn
	 * would be handed every character's private lore (Whodunit
	 * would leak its suspects to each other).
	 * `core:query/character-lore@1` and
	 * `core:query/lorebook-triggers@1` declare a `speaker`
	 * in-port for that — a participant reference the spec wires
	 * INSIDE the clause — and it is the subject here, in place
	 * of the scope's.
	 *
	 * ⚠ A wired `speaker` never widens the gate. Absent, null or
	 * empty (the port unwired, which is every spec written
	 * before this — and a free-form side character, whose
	 * context publishes null), the scope decides exactly as it
	 * did. Wired and naming a character row, that character
	 * decides. Wired and naming anybody else — an envoy, a
	 * role, a bare name — the subject is
	 * `NO_SUCH_CHARACTER`, a value no binding can carry, so the
	 * voice reads no private lore at all. That third case is
	 * the one that must not fall back to `null`: `null` is the
	 * omniscient narrator, and "this voice is nobody" would
	 * then mean "this voice knows everything", which is the
	 * leak the port exists to close.
	 */
	const visible = (e: any) =>
		isCharacterLoreEntryVisible(
			e,
			asSession,
			speaker.card,
			speaker.member
		)

	// Tagged with their source rather than returned as three lists,
	// because every consumer downstream — scoring, budgeting, the
	// receipt — keys on source, and splitting them again at each
	// step is three chances to forget one.
	//
	// ⚠ World, then character, then history — the order the
	// three concatenated lists had. Nothing downstream is
	// documented to depend on it, which is exactly why it is
	// not the thing to change here.
	const out: any[] = []
	// Each row's type's place in ENTRY_TYPE_IDS, beside it: the
	// union below orders two books' rows by it.
	const outTypes: number[] = []
	for (const [typeIndex, typeId] of ENTRY_TYPE_IDS.entries()) {
		const decl = entryDeclaration(typeId)
		// The privacy gate is the type's declared anchor
		// policy, not a branch on which shape this is. World
		// lore declares no anchor, so it is not asked; history
		// declares none either. Types select policies and never
		// author them, and this is the one core implements.
		const gated =
			decl?.roles.anchor?.policy ===
			BINDING_VISIBILITY_POLICY
		const source = bandOfType(typeId) as
			| "worldLore"
			| "characterLore"
			| "history"
		for (const row of rows) {
			if (row.typeId !== typeId) continue
			const entry = entryOf(row)
			if (gated && !visible(entry)) continue
			out.push(
				toLoreEntry(
					entry,
					source,
					boundCharacterOf(entry),
					gated ? castMemberOf(entry) : null,
					// ⚠ `row`, not `entry`. The stored columns
					// are what a later reader can hash again;
					// the hydrated entry is not reproducible
					// from the database alone.
					entrySourceHash(row)
				)
			)
			outTypes.push(typeIndex)
		}
	}
	return {
		out,
		outTypes,
		entryOf,
		asSession,
		isCharacterLoreEntryVisible
	}
	}

	const read = new Map<
		number,
		Awaited<ReturnType<typeof readBook>>
	>()
	for (const bookId of books.ids)
		read.set(
			bookId,
			await readBook(
				bookId,
				bookId === readingOrNone?.lorebookId ? sessionReading : MAIN_HEAD
			)
		)
	/**
	 * The union, still world, then character, then history
	 * (the order one book's listing has always had): the books
	 * are concatenated, then stably ordered by type. The
	 * notes' rows are marked "this session only".
	 */
	const tagged: Array<{ e: any; t: number }> = []
	for (const bookId of books.ids) {
		const { out: rows, outTypes } = read.get(bookId)!
		rows.forEach((e, i) =>
			tagged.push({
				e:
					bookId === books.ownBookId
						? { ...e, sessionOnly: true }
						: e,
				t: outTypes[i]
			})
		)
	}
	if (books.ids.length > 1) tagged.sort((a, b) => a.t - b.t)
	let out: any[] = tagged.map(({ e }) => e)

	/**
	 * 🚧 The timeline is off (owner ruling D55, 2026-11-16): no history entry
	 * reaches a run. Left out here, once, of the rows already read — the
	 * lanes, the listing, the scan, the vector gate, the tools and a link's far
	 * end all read this. Nothing is deleted; switched on again they are back.
	 * Counted for the receipt only when retrieval could have used them.
	 */
	const timelineOff = readingOrNone?.timelineOff === true
	let historyLeft = 0
	if (timelineOff) {
		const { timelessNull } = await import("$lib/server/state/storyTime")
		out = out
			.filter((e) => {
				if (e.source !== "history") return true
				if (e.enabled !== false && e.archived !== true) historyLeft++
				return false
			})
			// A row's stored Beginning (*began*) is a story date too (D56):
			// null with no timeline, whatever is stored. Nothing ranks or
			// orders on it for a row that is not history.
			.map((e) =>
				e.year == null && e.month == null && e.day == null
					? e
					: {
							...e,
							year: timelessNull(timelineOff, e.year),
							month: timelessNull(timelineOff, e.month),
							day: timelessNull(timelineOff, e.day)
						}
			)
	}

	/**
	 * `knownToSpeaker` (a literal `true`; the lanes pass it unless a pipeline
	 * turns it off): leave out what the speaker does not know — the rule in
	 * `entryKnowledge.ts`. Judged once per run and speaker; the drop is noted
	 * on the returned rows for the receipt, and a left-out entry is unseen as
	 * a far end below too. No speaker ref reads everything.
	 */
	let leftOut = new Set<number>()
	let knowledgeDrop: KnowledgeDrop | undefined
	const ref = lorebookSpeakerRef(speaker)
	if (q.knownToSpeaker === true) {
		if (ref === null) knowledgeDrop = { kind: "reads-all" }
		else {
			const key = `knowledge:${sessionId}:${ref}`
			let pending = lorebookReads.get(key)
			if (!pending) {
				pending = loadEntryKnowledge(db, { sessionId, speaker: ref })
				lorebookReads.set(key, pending)
				pending.catch(() => lorebookReads.delete(key))
			}
			const judged: EntryKnowledgeRead = await pending
			if (judged.kind === "judged") {
				leftOut = new Set(judged.leftOut.map((l) => l.entryId))
				const cause = new Map(
					judged.leftOut.map((l) => [l.entryId, l.cause])
				)
				let notKnown = 0
				let keptFrom = 0
				const kept: any[] = []
				for (const e of out) {
					const c = cause.get(e.id)
					if (c === undefined) kept.push(e)
					else if (c === "kept-from") keptFrom++
					else notKnown++
				}
				out = kept
				knowledgeDrop = {
					kind: "judged",
					name: judged.name,
					notKnown,
					keptFrom,
					leftOut: judged.leftOut
				}
			} else knowledgeDrop = { kind: judged.kind }
		}
	}

	/**
	 * 🚧 `speakerInCast` (on unless the query says `false`; every read that
	 * asks has its own param, `false` turns it off for that read): a History day this session's scenes are
	 * compiled into reads, for the speaker, as the scenes the speaker was in
	 * (rule 3 of `sessions/speakerInCast.ts`). Done once here, so every path
	 * that reads lore (the lanes, search by meaning, entity search, the
	 * triggers read, a keyword chain, the listing) reads the judged day. The
	 * replaced row is a new object: the book read is shared by every asker in
	 * the run. A left-out day is unseen as a far end below too. Nothing is
	 * loaded unless a history row is read; the outcome is noted on the rows
	 * for the history lane's receipt.
	 */
	let inCastHistory: InCastHistory | undefined
	if (q.speakerInCast !== false) {
		if (ref === null) inCastHistory = { kind: "reads-all" }
		else if (out.some((e) => e.source === "history")) {
			const casts = await sessionSceneCastsOf(db, sessionId, lorebookReads)
			const behind = new Set(
				casts.scenes
					.filter((sc) => sc.historyEntryId !== null)
					.map((sc) => sc.historyEntryId as number)
			)
			if (out.some((e) => e.source === "history" && behind.has(e.id))) {
				const judged = await speakerInCastOf(
					db,
					sessionId,
					ref,
					lorebookReads
				)
				if (judged.kind === "speaker") {
					const days = historyDaysInCast(judged.view)
					let shown = 0
					let cut = 0
					let dropped = 0
					const kept: any[] = []
					for (const e of out) {
						const day =
							e.source === "history" ? days.get(e.id) : undefined
						if (!day || day.kind === "whole") {
							kept.push(e)
							continue
						}
						if (day.kind === "none") {
							dropped++
							leftOut.add(e.id)
							continue
						}
						const fit = fitSummaries(
							day.summaries,
							REPLACED_DAY_CAP * String(e.content ?? "").length
						)
						shown++
						if (fit.cut) cut++
						kept.push({ ...e, content: fit.text })
					}
					out = kept
					inCastHistory = {
						kind: "judged",
						name: judged.view.name,
						shown,
						cut,
						leftOut: dropped
					}
				} else inCastHistory = { kind: "reads-all" }
			}
		}
	}

	/**
	 * `withLinks` (places plan B2): each listed row's lore
	 * links, said from that row — `LoreLinkRow[]` on `links`.
	 *
	 * The relationship hop's own reading (`readGraphEntryLinks`:
	 * the session's line at its moment, standing and not
	 * secret, both ends live), projected per row by
	 * `loreLinkRowsOf` — so a room's ways out in a prompt and
	 * the hop never disagree. Absent, rows carry no `links`
	 * key at all.
	 *
	 * ⚠ **A far end is named for the WIRED speaker only.** A
	 * listing with no `speaker` wired is read once and may be
	 * shared by every voice in the turn — the Lair's rooms are
	 * (B6 review round): one read feeds the narration, the
	 * planner and each delver's prompt. The scope's subject is
	 * then whoever heads the turn, or nobody on an envoy's
	 * turn (`null`, the omniscient narrator) — not the one
	 * reading. So, unwired, gated character lore that is not
	 * itself listed is named as a far end only when
	 * `NO_SUCH_CHARACTER` may see it: when any voice may (a
	 * persona's lore). Wired, the speaker decides, as for a
	 * listed row. A far end the listing itself carries is
	 * named either way — the output already holds it.
	 */
	if (q.withLinks === true && out.length) {
		const { readGraphEntryLinks, loreLinkRowsOf } =
			await import("$lib/server/utils/graphEntryLinks")
		const standing =
			(await readGraphEntryLinks(db, sessionId)) ?? []
		const listed = new Set(out.map((e) => e.id))
		const farIds = [
			...new Set(
				standing.flatMap((l) =>
					[l.from, l.to]
						.filter(
							(end) =>
								end.kind === "entry" &&
								!listed.has(end.id)
						)
						.map((end) => end.id)
				)
			)
		]
		// Listed rows passed the gate already; a far end the
		// listing did not carry is asked here, by its type's
		// declared anchor policy — for the wired speaker, or
		// for any voice when none is wired (above).
		const seen = new Set<number>(listed)
		const farRows = farIds.length
			? await db
					.select()
					.from(schema.lorebookEntries)
					.where(
						inArray(schema.lorebookEntries.id, farIds)
					)
			: []
		const farSubject = speakerIsWired(q)
			? speaker
			: { card: NO_SUCH_CHARACTER, member: null }
		for (const row of farRows) {
			if (leftOut.has(row.id)) continue
			if (timelineOff && bandOfType(row.typeId) === "history") continue
			const gated =
				entryDeclaration(row.typeId)?.roles.anchor
					?.policy === BINDING_VISIBILITY_POLICY
			if (!gated) {
				seen.add(row.id)
				continue
			}
			// Gated by its own book's cast — a far end in a
			// book this session does not read is unseen.
			const own = read.get(row.lorebookId)
			if (
				own &&
				own.isCharacterLoreEntryVisible(
					own.entryOf(row),
					own.asSession,
					farSubject.card,
					farSubject.member
				)
			)
				seen.add(row.id)
		}
		// A listed row the gate withheld is not in `out`, so
		// it is unseen here too: `listed` is what went out.
		for (const e of out)
			e.links = loreLinkRowsOf(e.id, standing, (id) =>
				seen.has(id)
			)
	}
	if (knowledgeDrop) noteKnowledgeDrop(out, knowledgeDrop)
	if (historyLeft > 0) noteHistoryLeftOut(out, historyLeft)
	if (inCastHistory) noteInCastHistory(out, inCastHistory)
	return out
}
