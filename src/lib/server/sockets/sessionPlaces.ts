/**
 * 🚧 `sessions:places` (PLAN-core-widgets W4, 2026-10-11) — the door core's
 * Places widget asks through, by way of its page
 * (`sessionPage/requests/sessionPlaces.ts`). The lorebook's Places lens draws
 * from the workspace's own rows, which only the book's owner may list; a
 * session's places are the session's to read, so this is a thin read over
 * what the session's other readers already use — nothing here decides which
 * places or ways a session has:
 *
 * - the places: `entriesAsRead` over `core:entry/location` entries at the
 *   session's reading (its line, its story clock), with **place sight**
 *   `"session"` (`placesOnReading`'s rule: a place archived or switched Off
 *   by then is not there; a renamed one is read by its name then). Their
 *   category is the entry's, as the line's amendments leave it by then;
 * - the tints: the categories of every place the book's own pages see
 *   (`"book"` sight, as the lens draws them), sorted as the lens sorts
 *   them — so a category is dealt the same hue in the session as on the
 *   book's map;
 * - the ways and what else is linked: `readGraphEntryLinks` — the
 *   relationships the session's reading has, standing, never secret, both
 *   ends live (the list the prompt's *From here:* is said from). A way is a
 *   relationship with a seen place at each end; anything else touching a
 *   seen place — a cast member, other lore, never a character's own lore —
 *   is a **linked** thing. Each is said by `relationshipSentence`, the one
 *   sentence the lorebook and the prompt say a relationship with.
 *
 * Who: anyone in the session (a guest too — the session's prompt names its
 * places to every voice). Every answer — reply and refusal — carries the
 * ask's `request` token back: the reply reaches every tab of the person, and
 * only the token tells an ask its own answer.
 */
import { and, eq, inArray } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import type {
	PlaceLinkV1,
	PlaceV1,
	SessionPlacesV1,
	StoryTime,
	WayV1
} from "@serene-pub/sdk"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { sessionReadingOf } from "$lib/server/state/reading"
import {
	MAIN_HEAD,
	entriesAsRead,
	entryAt,
	entryOverlaysFor
} from "$lib/server/state/entriesOnReading"
import {
	readGraphEntryLinks,
	type GraphEntryLink,
	type GraphEntryLinkEnd
} from "$lib/server/utils/graphEntryLinks"
import {
	CHARACTER_LORE_TYPE_ID,
	LOCATION_TYPE_ID
} from "$lib/shared/entries/types"
import {
	relationshipSentence,
	type RelationshipEndLike
} from "$lib/shared/lorebooks/linkVocabulary"
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"

/** A refusal said to the asker in words (not a fault of the server's). */
export class PlacesRefusal extends Error {}

const tokenOf = (params: { request?: unknown }) =>
	typeof params?.request === "string" ? { request: params.request } : {}

const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "")
const categoryKey = (v: string) => v.toLowerCase()

/** A story date as the SDK's time, with only the parts it has. */
function storyTimeOf(d: StoryDate | null): StoryTime | null {
	if (!d || typeof d.year !== "number") return null
	return {
		year: d.year,
		...(d.month != null ? { month: d.month } : {}),
		...(d.month != null && d.day != null ? { day: d.day } : {})
	}
}

/**
 * The session's places and the ways between them, as the session reads them
 * (see the module note). Refused to anyone not in the session.
 */
export async function readSessionPlaces(
	sessionId: number,
	userId: number
): Promise<SessionPlacesV1> {
	const access = await checkSessionAccess(sessionId, userId)
	if (!access.hasAccess)
		throw new PlacesRefusal("This session is not one you are in.")
	const reading = await sessionReadingOf(db, sessionId)
	// 🚧 The session's own notes' places come after the book's, marked
	// "this session only" (PLAN-rulesets §26) — and are all a session with
	// no book has.
	const own = await ownBookPlaces(sessionId)
	const ownPlaces = own.places
	const lorebookId = reading?.lorebookId ?? null

	const [bookPlaces, sessionPlaces] = reading
		? await Promise.all([
				entriesAsRead(db, reading.lorebookId, reading, "book", [LOCATION_TYPE_ID]),
				entriesAsRead(db, reading.lorebookId, reading, "session", [LOCATION_TYPE_ID])
			])
		: [[], []]
	const live = bookPlaces.filter((p) => !p.unseen).map((p) => p.entryId)
	const seen = sessionPlaces.filter((p) => !p.unseen)

	// Each live place's category, as the line's amendments leave it by then.
	const category = new Map<number, string>()
	if (live.length && reading && lorebookId != null) {
		const e = schema.lorebookEntries
		const [rows, overlays] = await Promise.all([
			db
				.select({ id: e.id, fields: e.fields })
				.from(e)
				.where(and(eq(e.lorebookId, lorebookId), inArray(e.id, live))),
			entryOverlaysFor(db, lorebookId, reading, live)
		])
		for (const r of rows) {
			const fields = (r.fields ?? {}) as Record<string, unknown>
			const at = entryAt(
				{ id: r.id, category: fields.category },
				overlays,
				reading
			)
			const name = trimmed(at.category)
			if (name) category.set(r.id, name)
		}
	}
	// The lens's order: one category per spelling-insensitive key, named as
	// first written (entry order), sorted.
	const firstWritten = new Map<string, string>()
	for (const id of live) {
		const name = category.get(id)
		if (name && !firstWritten.has(categoryKey(name)))
			firstWritten.set(categoryKey(name), name)
	}
	const tintOf = new Map(
		[...firstWritten.values()]
			.sort((a, b) =>
				a.localeCompare(b, undefined, { sensitivity: "base" })
			)
			.map((name, i) => [categoryKey(name), i])
	)

	// The notes' places are places too: a way between two of them, or from
	// one to the book's, is drawn like any other (the links read is the union).
	const seenIds = new Set([...seen.map((p) => p.entryId), ...ownPlaces.map((p) => p.id)])
	const links = ((await readGraphEntryLinks(db, sessionId)) ?? []).filter(
		(l) =>
			(l.from.kind === "entry" && seenIds.has(l.from.id)) ||
			(l.to.kind === "entry" && seenIds.has(l.to.id))
	)
	// The far entries' types: a character's own lore is never shown, and an
	// entry the session does not see is no end at all.
	const farEntryIds = [
		...new Set(
			links.flatMap((l) =>
				[l.from, l.to]
					.filter(
						(end) => end.kind === "entry" && !seenIds.has(end.id)
					)
					.map((end) => end.id)
			)
		)
	]
	const farRead = [
		...(reading && farEntryIds.length
			? await entriesAsRead(db, reading.lorebookId, reading, "session", null, farEntryIds)
			: []),
		...(own.ownBookId != null && farEntryIds.length
			? await entriesAsRead(db, own.ownBookId, MAIN_HEAD, "session", null, farEntryIds)
			: [])
	]
	const farTypes = new Map(
		farRead.filter((x) => !x.unseen).map((x) => [x.entryId, x.typeId])
	)

	/** An end as a sentence reads it: an entry carries its type, so a place reads apart. */
	const sayable = (end: GraphEntryLinkEnd): RelationshipEndLike =>
		end.kind === "cast"
			? { kind: "cast", bindingId: end.id }
			: {
					kind: "entry",
					entryId: end.id,
					typeId: seenIds.has(end.id)
						? LOCATION_TYPE_ID
						: (farTypes.get(end.id) ?? undefined)
				}
	const say = (l: GraphEntryLink, from: GraphEntryLinkEnd) =>
		relationshipSentence(
			{
				from: sayable(l.from),
				to: sayable(l.to),
				relationshipType: l.relationshipType,
				reverseRelationshipType: l.reverseRelationshipType,
				name: l.name
			},
			{ kind: from.kind, id: from.id },
			(end) =>
				end.kind === l.from.kind && end.id === l.from.id
					? l.from.name
					: l.to.name
		)

	const ways: WayV1[] = []
	const linked = new Map<number, PlaceLinkV1[]>()
	for (const l of [...links].sort((a, b) => a.id - b.id)) {
		const fromPlace = l.from.kind === "entry" && seenIds.has(l.from.id)
		const toPlace = l.to.kind === "entry" && seenIds.has(l.to.id)
		if (fromPlace && toPlace) {
			if (l.from.id === l.to.id) continue
			const back = trimmed(l.reverseRelationshipType)
			ways.push({
				id: l.id,
				from: l.from.id,
				to: l.to.id,
				bothWays: !!back,
				name: trimmed(l.name) || null,
				fromSays: say(l, l.from) ?? "",
				toSays: back ? (say(l, l.to) ?? null) : null
			})
			continue
		}
		// One end a place, the other something else of the book's.
		const [here, other] = fromPlace ? [l.from, l.to] : [l.to, l.from]
		if (other.kind === "entry") {
			const type = farTypes.get(other.id)
			if (
				!type ||
				type === CHARACTER_LORE_TYPE_ID ||
				type === LOCATION_TYPE_ID
			)
				continue
		}
		const says = say(l, here)
		if (!says || !other.name.trim()) continue
		linked.set(here.id, [
			...(linked.get(here.id) ?? []),
			{ kind: other.kind, id: other.id, name: other.name, says }
		])
	}

	const places: PlaceV1[] = seen.map((p) => {
		const name = category.get(p.entryId) ?? null
		return {
			id: p.entryId,
			name: p.name.trim() || `#${p.entryId}`,
			category: name,
			tint: name != null ? (tintOf.get(categoryKey(name)) ?? null) : null,
			linked: linked.get(p.entryId) ?? []
		}
	})
	return {
		lorebookId,
		asOf: reading ? storyTimeOf(reading.moment) : null,
		places: [
			...places,
			...ownPlaces.map((p) => ({ ...p, linked: linked.get(p.id) ?? [] }))
		],
		ways
	}
}

/**
 * 🚧 The places of the session's own notes (PLAN-rulesets §26), as the
 * session sees them, each `sessionOnly`. Their category is the entry's own;
 * the ways between them are drawn by the caller, from the union links read.
 */
async function ownBookPlaces(sessionId: number): Promise<{
	ownBookId: number | null
	places: (PlaceV1 & { sessionOnly: true })[]
}> {
	const { ownBookOf } = await import("$lib/server/lorebooks/ownBook")
	const ownBook = await ownBookOf(db, sessionId)
	if (!ownBook) return { ownBookId: null, places: [] }
	const seen = (
		await entriesAsRead(db, ownBook.id, MAIN_HEAD, "session", [LOCATION_TYPE_ID])
	).filter((p) => !p.unseen)
	if (!seen.length) return { ownBookId: ownBook.id, places: [] }
	const e = schema.lorebookEntries
	const rows = await db
		.select({ id: e.id, fields: e.fields })
		.from(e)
		.where(and(eq(e.lorebookId, ownBook.id), inArray(e.id, seen.map((p) => p.entryId))))
	const category = new Map(
		rows.map((r) => [r.id, trimmed(((r.fields ?? {}) as Record<string, unknown>).category) || null])
	)
	return {
		ownBookId: ownBook.id,
		places: seen.map((p) => ({
			id: p.entryId,
			name: p.name.trim() || `#${p.entryId}`,
			category: category.get(p.entryId) ?? null,
			tint: null,
			linked: [],
			sessionOnly: true as const
		}))
	}
}

export const sessionsPlaces: Handler<
	Sockets.Sessions.Places.Params,
	Sockets.Sessions.Places.Response
> = {
	event: "sessions:places",
	handler: async (socket, params, emitToUser) => {
		const token = tokenOf(params)
		try {
			const places = await readSessionPlaces(
				params.sessionId,
				socket.user!.id
			)
			const res = { sessionId: params.sessionId, ...token, places }
			emitToUser("sessions:places", res)
			return res
		} catch (error: any) {
			const res = {
				sessionId: params?.sessionId,
				...token,
				error:
					error instanceof PlacesRefusal
						? error.message
						: "The session's places could not be read."
			}
			if (!(error instanceof PlacesRefusal))
				console.warn("[sessionPlaces] read failed:", error)
			emitToUser("sessions:places:error", res)
			return res
		}
	}
}

export function registerSessionPlacesHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, sessionsPlaces, emitToUser)
}
