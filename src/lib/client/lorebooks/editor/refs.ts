/**
 * What points at this entry, and what each reference is.
 *
 * ⚠ **A reference is a text match over the pool, never a retrieval decision.**
 * The engine weighs regex keys, case sensitivity, trigram folding and a scan
 * window; this looks for a name in a string. It answers the question a reader
 * asks before deleting something — what would be left pointing at nothing —
 * and the Read in? tab is what answers whether an entry reached a prompt.
 *
 * Four shapes, and only the first is visible from the list: a row that names
 * this one, a row filed under it, a row that reaches it through one of its
 * children, and a row joined to it by a typed edge. The edges arrive with the
 * graph read and are never invented here — an entry with no graph loaded has
 * three shapes and says so by having no edge rows, not by guessing at them.
 */

import {
	relationshipSentence,
	type RelationshipEndLike,
	type RelationshipEndRef
} from "$lib/shared/lorebooks/linkVocabulary"
import { keywordsOf, mentions } from "../references"
import { SCENE_KIND, type PoolItem } from "../poolFilter"
import { CAST_KIND } from "../scopes"
import { containedBy } from "./partOf"

/** How much of a sentence is worth quoting before it stops being evidence. */
const QUOTE_LIMIT = 160

export interface RefRow {
	/** The row that points at the subject. */
	item: PoolItem
	/** What it does, one clause each. */
	clauses: string[]
	/**
	 * `session` for a mention captured out of a conversation, `indirect` for a
	 * reference that reaches the subject through one of its children or lands
	 * on the row this one is filed under.
	 */
	tag: "session" | "indirect" | null
}

/**
 * One end of a typed edge, as the Refs board reads it.
 *
 * Keyed the way the pool keys its rows, so an entry endpoint resolves to the
 * row it names; a cast endpoint never will, because the cast is a list of its
 * own, and it carries its name so the board can say who it is anyway.
 */
export interface RefEndpoint {
	/** `entry#12`, or `cast#3` for a binding. */
	key: string
	id: number
	/** A declared type id, or the cast pool's kind. */
	kind: string
	name: string
}

/**
 * A typed edge between two of the book's rows, with as much of it as the one
 * sentence (`relationshipSentence`) needs to say it from either end.
 */
export interface RefLink {
	id: number
	from: RefEndpoint
	to: RefEndpoint
	/** Read from the `from` end: "keeper of", "leads north to". */
	relationshipType: string
	/** Read from the `to` end; null is one way. */
	reverseRelationshipType: string | null
	/** The relationship's own name ("the rusted iron door"); empty is unnamed. */
	name: string
}

/**
 * The graph's edges, in the vocabulary this board reads them in.
 *
 * ⚠ **`from`/`to`, never `fromNodeId`/`toNodeId`.** The pair of ids is kept for
 * one release and is null on an entry endpoint, so a reader that binds to them
 * sees every road in the book as having no ends at all.
 *
 * A cast endpoint carries no name on the wire — the binding it names is in the
 * list's `nodes` — so the names are handed in beside the edges rather than
 * fetched here.
 */
export function refLinksFrom(
	relationships: readonly Sockets.NarrativeGraph.NarrativeRelationship[],
	castNames: ReadonlyMap<number, string>
): RefLink[] {
	const endpointOf = (
		end: Sockets.NarrativeGraph.WireRelationshipEndpoint
	): RefEndpoint =>
		end.kind === "entry"
			? {
					key: `entry#${end.entryId}`,
					id: end.entryId,
					kind: end.typeId,
					name: end.name
				}
			: {
					key: `cast#${end.bindingId}`,
					id: end.bindingId,
					kind: CAST_KIND,
					name: castNames.get(end.bindingId) ?? `#${end.bindingId}`
				}
	return relationships.map((row) => ({
		id: row.id,
		from: endpointOf(row.from),
		to: endpointOf(row.to),
		relationshipType: row.relationshipType,
		reverseRelationshipType: row.reverseRelationshipType ?? null,
		name: row.name ?? ""
	}))
}

/** An end as the sentence reads it; an entry end says its type. */
const sayableEnd = (end: RefEndpoint): RelationshipEndLike =>
	end.kind === CAST_KIND
		? { kind: "cast", bindingId: end.id }
		: { kind: "entry", entryId: end.id, typeId: end.kind }

const refOf = (end: RefEndpoint): RelationshipEndRef =>
	end.kind === CAST_KIND
		? { kind: "cast", id: end.id }
		: { kind: "entry", id: end.id }

/**
 * An edge said from one of its ends — the row it is listed under — with the
 * one sentence every surface says a relationship with. Names are the pool's
 * reading where the pool holds the row (an amended name), the endpoint's
 * otherwise.
 */
function linkClause(
	link: RefLink,
	from: RefEndpoint,
	pool: readonly PoolItem[]
): string {
	const nameOf = (end: RelationshipEndRef) => {
		const wire = [link.from, link.to].find(
			(e) => refOf(e).kind === end.kind && e.id === end.id
		)
		const key = wire?.key ?? `${end.kind}#${end.id}`
		return pool.find((row) => row.key === key)?.name || wire?.name || `#${end.id}`
	}
	return (
		relationshipSentence(
			{
				from: sayableEnd(link.from),
				to: sayableEnd(link.to),
				relationshipType: link.relationshipType,
				reverseRelationshipType: link.reverseRelationshipType,
				name: link.name
			},
			refOf(from),
			nameOf
		) ?? link.relationshipType
	)
}

/**
 * A row for an endpoint the pool does not hold.
 *
 * A cast member is never in the entry pool and an entry from a book the list
 * has not loaded may not be either, and both are still real references. The
 * endpoint carries the name and the kind, which is everything the board says
 * about a row it cannot open.
 */
function standIn(end: RefEndpoint): PoolItem {
	return {
		key: end.key,
		id: end.id,
		kind: end.kind,
		name: end.name,
		content: "",
		keys: [],
		pinned: false,
		off: false,
		archived: false,
		machineWritten: false,
		parentKey: null,
		order: 0,
		position: 0,
		priority: 0,
		createdAt: 0,
		updatedAt: 0
	}
}

/** Whether a text names one row, by its title or by any of its keywords. */
function names(text: string, target: PoolItem): boolean {
	if (!text.trim()) return false
	if (target.name.trim() && mentions(text, target.name)) return true
	return keywordsOf(target).some((keyword) => mentions(text, keyword))
}

/** The sentence a reference comes from, quoted, when it is short enough. */
function quoteOf(text: string, target: PoolItem): string | null {
	for (const raw of text.split(/(?<=[.!?])\s+|\n+/)) {
		const sentence = raw.trim()
		if (!sentence || !names(sentence, target)) continue
		return sentence.length <= QUOTE_LIMIT ? `“${sentence}”` : null
	}
	return null
}

const tagOf = (item: PoolItem): "session" | null =>
	item.kind === SCENE_KIND ? "session" : null

export function entryRefs(
	subject: PoolItem,
	pool: readonly PoolItem[],
	links: readonly RefLink[] = []
): RefRow[] {
	const children = containedBy(subject.key, pool)
	const direct = new Map<string, RefRow>()
	const indirect = new Map<string, RefRow>()

	/**
	 * One row, however many ways it points here.
	 *
	 * ⚠ **The strongest thing a row does is what it is filed as.** A cast
	 * member who both names the entry and keeps it is one reference with two
	 * clauses, and listing it twice — once under each shape — would read as two
	 * people.
	 */
	function add(
		into: "direct" | "indirect",
		item: PoolItem,
		clause: string,
		tag: RefRow["tag"]
	): void {
		const held = direct.get(item.key)
		if (held) {
			if (!held.clauses.includes(clause)) held.clauses.push(clause)
			return
		}
		const weaker = indirect.get(item.key)
		if (into === "indirect") {
			if (weaker) {
				if (!weaker.clauses.includes(clause))
					weaker.clauses.push(clause)
				return
			}
			indirect.set(item.key, { item, clauses: [clause], tag })
			return
		}
		if (weaker) indirect.delete(item.key)
		direct.set(item.key, {
			item,
			clauses: weaker ? [...weaker.clauses, clause] : [clause],
			tag
		})
	}

	for (const item of pool) {
		if (item.key === subject.key) continue
		const inside = item.parentKey === subject.key

		if (names(item.content, subject)) {
			const clauses = [
				quoteOf(item.content, subject) ??
					`names ${subject.name} in its content`
			]
			if (inside) clauses.push("and sits inside it")
			direct.set(item.key, { item, clauses, tag: tagOf(item) })
			continue
		}
		if (inside) {
			direct.set(item.key, {
				item,
				clauses: ["sits inside it"],
				tag: tagOf(item)
			})
			continue
		}
		// Two steps, and no further: a chain of names is how everything in a
		// book ends up pointing at everything else, and a list like that
		// answers nothing.
		const via = children.find(
			(child) => child.key !== item.key && names(item.content, child)
		)
		if (via)
			indirect.set(item.key, {
				item,
				clauses: [`names ${via.name}, which is inside ${subject.name}`],
				tag: "indirect"
			})
	}

	/**
	 * The edges, which are the half of this no text scan can find.
	 *
	 * An edge that touches the subject makes its other end a direct reference,
	 * whichever way it was drawn — a road is drawn once and both places are on
	 * it. An edge that lands on the row the subject is filed under is a step
	 * away, exactly as a row naming one of the subject's children is, so it is
	 * filed as indirect and says which row it actually reached.
	 *
	 * Each is said from the row it is listed under, as that row's other
	 * clauses are — so a one-way link reads as a way in from the end it runs
	 * into, never backwards (places plan B5).
	 */
	for (const link of links) {
		for (const [near, far] of [
			[link.from, link.to],
			[link.to, link.from]
		] as const) {
			// A loop points at nothing but itself, and an edge whose far end is
			// the subject is the same edge read from the other side.
			if (near.key === far.key || far.key === subject.key) continue
			const item = pool.find((row) => row.key === far.key) ?? standIn(far)
			const said = linkClause(link, far, pool)
			if (near.key === subject.key) {
				add("direct", item, said, tagOf(item))
				continue
			}
			if (subject.parentKey && near.key === subject.parentKey)
				add(
					"indirect",
					item,
					`${said.replace(/[.!?]$/, "")}, which this entry is inside.`,
					"indirect"
				)
		}
	}

	return [...direct.values(), ...indirect.values()]
}

/**
 * What each `{{char:N}}` in this entry resolves to.
 *
 * One line per slot however often it is written, because the reader is being
 * told what a slot means rather than where it appears. A slot nobody has
 * filled says so: the stored text keeps the token either way, and a silent
 * line would read as a name.
 */
export function castMacroLines(
	content: string,
	resolve: (tag: string) => string | null,
	sessionName: string | null
): string[] {
	const seen = new Set<string>()
	const lines: string[] = []
	for (const match of (content || "").matchAll(/\{\{char:\d+\}\}/g)) {
		const tag = match[0]
		if (seen.has(tag)) continue
		seen.add(tag)
		const name = resolve(tag)
		lines.push(
			name
				? `${tag} in this entry resolves to ${name}${
						sessionName ? " in the attached session" : ""
					}.`
				: `${tag} in this entry resolves to nobody in this book.`
		)
	}
	return lines
}
