/**
 * The links a room's `Exits:` line names, judged against the book (plan
 * places-graph §11, B7) — what **Read links from the Exits line** offers.
 *
 * On request only: the person presses it in the place editor, sees every
 * signpost the line names, and confirms. Nothing is parsed at write time (the
 * owner's Q4 is open) and nothing is written without the confirm.
 *
 * - **Which place a name is** is the one room rule (`answeringRows`, the
 *   tiers the Lair's Answer the door and `{{locationEntry}}` use), over the
 *   places the line being read holds — archived ones left out, as
 *   `placeChoices` leaves them out; switched-on places before switched-off
 *   ones, so a switched-off namesake never beats the place the Lair would
 *   find; never other lore, since a way out leads to a place. A longer
 *   reading of the name (through a comma, with its note) is tried first.
 *   Two places answering alike are both named and neither is ticked; this
 *   place is never taken for a name another place answers alike. A name
 *   nothing answers to is offered as a **new place**, never ticked for the
 *   person.
 * - **Idempotent.** A signpost a link already says — the same words read
 *   from this place, and the same name, case aside, which is what the
 *   one-row-per-way guard compares (`findLinkedThatWay`) — is shown and not
 *   offered, so reading the line twice writes nothing twice. The server
 *   refuses the same row again anyway. A signpost to a place some OTHER link
 *   already joins (Answer the door's `leads to`) is offered unticked, with
 *   that link beside it, so a second arrow is the person's choice.
 * - **One way, in the line's words** ("leads north to"): the line is said
 *   from this room; the far room's own line says the way back.
 */

import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { answeringRows } from "$lib/shared/lorebooks/describingRow"
import type { ExitsLineSignpost } from "$lib/shared/lorebooks/exitsLine"
import {
	relationshipReading,
	relationshipSentence,
	type RelationshipEndRef
} from "$lib/shared/lorebooks/linkVocabulary"
import { normalizeName } from "@serene-pub/sdk"
import type { LinkDraft } from "../graphs/linkDraft"
import type { PoolItem } from "../poolFilter"
import {
	newPlaceLink,
	placeLinkStands,
	type PlaceLinkRow
} from "./placeLinks"

/**
 * Where one signpost stands:
 * - `ready`: the name is a place, and nothing links the two yet;
 * - `linked`: a link already says it — shown, never offered;
 * - `joined`: another link already joins the two — offered, unticked;
 * - `unresolved`: no place on the line answers to the name — offered as a
 *   new place, unticked;
 * - `here`: the name is this place — never offered.
 */
export type ExitsLineLinkState =
	| "ready"
	| "linked"
	| "joined"
	| "unresolved"
	| "here"

/** A place, as a signpost names it. */
type Named = { id: number; name: string }

/** One signpost the Exits line names, as the confirm view shows it. */
export interface ExitsLineLink {
	/**
	 * The signpost itself — its whole name normalised, its words and its
	 * link name — so it stays the same while the line says the same thing,
	 * even as the place it names is made (a tick or a refusal keyed by it
	 * survives the pool gaining that place).
	 */
	key: string
	signpost: ExitsLineSignpost
	/**
	 * The far end's name as the line writes it: the longer reading a place
	 * answers to ("The Hall, East Wing"), else `signpost.to` — what a new
	 * place is named.
	 */
	written: string
	/** The place the name answers to, or null when none does. */
	place: Named | null
	/** Other places the name answers to as strongly: a tie the rule cannot break. */
	namesakes: Named[]
	state: ExitsLineLinkState
	/** The link said from this place, the far end named as found (or as written). */
	sentence: string
	/**
	 * The link that already says it (`linked`) or already joins the two
	 * (`joined`), said from here — one that stands at the moment before one
	 * made true after it (`later`: its date, as the Links list badges it).
	 */
	standing: { sentence: string; later: string | null } | null
}

/** What a signpost is judged against. */
export interface ExitsLineReading {
	/** The place whose Exits line it is. */
	place: Named
	/** The book's rows on the line being read (the pool): the places a name can be. */
	pool: readonly PoolItem[]
	/** This place's Links rows (`placeLinkRows`): the links on the line, every date. */
	rows: readonly PlaceLinkRow[]
}

const lower = (text: string | null | undefined) =>
	(text ?? "").trim().toLowerCase()

/** An end that stands for a name nothing answers to: never a real id. */
const UNPLACED: RelationshipEndRef = { kind: "entry", id: -1 }

const named = (item: PoolItem): Named => ({ id: item.id, name: item.name.trim() })

/**
 * Every signpost the line names, each resolved and judged. One named twice
 * (the same place, words and name) is listed once.
 */
export function exitsLineLinks(
	signposts: readonly ExitsLineSignpost[],
	reading: ExitsLineReading
): ExitsLineLink[] {
	const here: RelationshipEndRef = { kind: "entry", id: reading.place.id }
	const places = reading.pool.filter(
		(item) => item.kind === LOCATION_TYPE_ID && !item.archived
	)
	// The Lair's listing holds switched-on places only; a switched-off one
	// still answers a name none of those does, as Link a place offers it.
	const lists = [
		places.filter((item) => !item.off),
		places.filter((item) => item.off)
	]
	const targets = new Set<string>()
	const keys = new Set<string>()
	const links: ExitsLineLink[] = []
	for (const signpost of signposts) {
		let written = signpost.to
		let answering: PoolItem[] = []
		for (const name of [...signpost.longerNames, signpost.to]) {
			answering = answeringRows(name, ...lists) as PoolItem[]
			if (answering.length) {
				written = name
				break
			}
		}
		// This place's own namesake is the other place, not here.
		const others = answering.filter((item) => item.id !== reading.place.id)
		const found =
			others.length && others.length < answering.length ? others : answering
		const place = found[0] ? named(found[0]) : null
		const namesakes = found.slice(1).map(named)

		const words = [lower(signpost.wording), lower(signpost.name)]
		const target = [place ? `#${place.id}` : `?${normalizeName(written)}`, ...words].join("|")
		if (targets.has(target)) continue
		targets.add(target)
		const whole = signpost.longerNames[0] ?? signpost.to
		const keyBase = [normalizeName(whole) || lower(whole), ...words].join("|")
		let key = keyBase
		for (let n = 2; keys.has(key); n++) key = `${keyBase}|${n}`
		keys.add(key)

		const far: RelationshipEndRef = place
			? { kind: "entry", id: place.id }
			: UNPLACED
		const sentence =
			relationshipSentence(
				{
					from: here,
					to: far,
					relationshipType: signpost.wording,
					name: signpost.name
				},
				here,
				() => place?.name ?? written
			) ?? ""
		const shown = { key, signpost, written, place, namesakes, sentence }
		if (!place) {
			links.push({ ...shown, state: "unresolved", standing: null })
			continue
		}
		if (place.id === reading.place.id) {
			links.push({ ...shown, state: "here", standing: null })
			continue
		}
		const joining = reading.rows.filter(
			(row) => row.other.kind === "entry" && row.other.id === place.id
		)
		const says = (row: PlaceLinkRow) => {
			const wording = relationshipReading(row.rel, here)?.wording
			return (
				wording != null &&
				lower(wording) === lower(signpost.wording) &&
				lower(row.rel.name) === lower(signpost.name)
			)
		}
		const stood = (rows: PlaceLinkRow[]) => {
			const row = rows.find(placeLinkStands) ?? rows[0]
			return row ? { sentence: row.sentence, later: row.later } : null
		}
		const saying = joining.filter(says)
		if (saying.length)
			links.push({ ...shown, state: "linked", standing: stood(saying) })
		else if (joining.length)
			links.push({ ...shown, state: "joined", standing: stood(joining) })
		else links.push({ ...shown, state: "ready", standing: null })
	}
	return links
}

/** Whether the confirm view offers a signpost at all (a box to tick). */
export const isOffered = (link: ExitsLineLink): boolean =>
	link.state === "ready" ||
	link.state === "joined" ||
	link.state === "unresolved"

/**
 * Whether a signpost is ticked until the person says otherwise: it names one
 * place, and nothing links the two yet. Re-asked as the judgement moves, so
 * a way that stops being ready (the store's list lands, a link arrives from
 * the canvas) loses a tick the person never gave it.
 */
export const isTickedByDefault = (link: ExitsLineLink): boolean =>
	link.state === "ready" && link.namesakes.length === 0

/** The signposts ticked until the person says otherwise, by key. */
export const exitsLineTicks = (links: readonly ExitsLineLink[]): string[] =>
	links.filter(isTickedByDefault).map((link) => link.key)

/**
 * What a confirmed signpost writes: the canvas's draft from this place to
 * that one, one way, in the line's words and with its name, dated as a link
 * drawn here is (`historyEntryId`: the entry dated the moment being read, or
 * none).
 */
export function exitsLineDraft(
	from: Named,
	to: Named,
	signpost: ExitsLineSignpost,
	historyEntryId: number | null
): LinkDraft {
	return {
		...newPlaceLink(from, to, historyEntryId),
		relationshipType: signpost.wording,
		reverseRelationshipType: null,
		name: signpost.name
	}
}

/**
 * What one opening of the confirm view wrote: the links written (every
 * confirm, and a write already sent that lands after a close), and how many
 * ticked signposts a close left unlinked — those it stopped before sending,
 * and one in flight that then failed.
 */
export interface ExitsLineTally {
	linked: number
	left: number
}

const ways = (n: number) => `${n} ${n === 1 ? "way" : "ways"}`

/** What the Links list says once the view closes, or null when nothing was written or stopped. */
export function exitsLineNote({ linked, left }: ExitsLineTally): string | null {
	if (left > 0)
		return linked
			? `Stopped: linked ${ways(linked)} from the Exits line; ${left} left unlinked.`
			: `Stopped: nothing from the Exits line was linked; ${left} left unlinked.`
	return linked ? `Linked ${ways(linked)} from the Exits line.` : null
}
