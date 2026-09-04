/**
 * A transform id and the two columns `connection_defaults` stores it in.
 *
 * The table used to key on `capability` — one `text` primary key holding the
 * whole id, `text+image->text`. 0183 split it into `input` and `output` so that
 * "which defaults produce images?" is `WHERE output = 'image'` rather than a
 * `LIKE '%->image'` scan over a string nobody can index usefully.
 *
 * The id is still the CANONICAL IN-MEMORY FORM and the columns are only its
 * storage form. `capabilityDefaults()` returns a map keyed by id, every node's
 * `requires` names an id, and `TRANSFORMS` is keyed by id — pushing the pair out
 * through those would be a second spelling of one fact, which is the failure
 * this table's whole history is made of. So the conversion happens at the
 * storage boundary (`connections/capabilityDefaults.ts`) and nowhere else.
 *
 * ## ⚠ The order is IO_KINDS declaration order, NOT alphabetical
 *
 * `input` for vision is `"text,image"` and never `"image,text"`. The SDK's
 * `side()` sorts by `IO_KINDS` position — text, image, audio, video, document,
 * embedding — and its docblock says why: "text leads, so vision reads
 * `text+image->text` rather than `image+text->text`". Sorting these columns
 * alphabetically would produce a value that `transformId()` never emits, so
 * every row written by one convention would be invisible to a reader using the
 * other. Both directions here go through the SDK precisely so there is no second
 * comparator to keep in step.
 *
 * ## Writes are guarded, reads are total
 *
 * `sidesOf` throws on anything that is not a transform id, because the one
 * caller that can reach it with junk is `connections:setDefault`, whose
 * `capability` is a client-supplied string and is only judged against a
 * connection when one is named (clearing with `id: null` skips the judgement
 * entirely). A feature id like `"tools"` would split into `output: ""` — a row
 * matching no reader, forever, which is exactly what 0183's `DELETE` exists to
 * clean up. `transformIdOf` never throws: it is read over stored bytes, and a
 * junk row must surface as a junk key nothing matches rather than take out
 * every OTHER default in the same `SELECT`.
 *
 * ⚠ Shared, not server-only: `importBoundary.test.ts` forbids anything in this
 * directory from importing `$lib/server` or Drizzle. Keep it that way — the
 * Drizzle predicate built from these lives beside the queries that use it.
 */

import {
	isTransformId,
	parseTransform,
	transformId,
	type IoKind,
	type TransformId
} from "@serene-pub/sdk"

/** The two columns, as the row holds them. */
export interface TransformSides {
	/** Comma-delimited `IoKind`s, in `IO_KINDS` order — e.g. `"text,image"`. */
	input: string
	/** The same, for what comes out — e.g. `"image"`. */
	output: string
}

const KINDS = (side: string): IoKind[] =>
	side.split(",").filter(Boolean) as IoKind[]

/**
 * The id, as the two columns.
 *
 * `parseTransform` rather than `id.split("->")`, so the one place that knows how
 * an id comes apart stays in the SDK beside the one place that builds it.
 *
 * Re-emitted through `transformId` BEFORE being taken apart, which looks like a
 * no-op and is not: `parseTransform` preserves whatever order it was handed,
 * while `transformId` imposes the canonical one. Without the round trip, storing
 * `image+text->text` would write `input = "image,text"` and every later lookup —
 * built from the same id, arriving canonical from `TRANSFORMS` — would ask for
 * `"text,image"` and miss its own row. Canonicalising on the way in is what
 * makes `sidesOf` and `transformIdOf` two views of ONE convention rather than
 * two conventions that agree about the cases anyone tested.
 */
export function sidesOf(id: TransformId): TransformSides {
	if (!isTransformId(id))
		throw new Error(
			`"${id}" is not a transform id, so it cannot be stored as a capability ` +
				`default. Only transforms are ever registered — a feature qualifies a ` +
				`request rather than being something a node goes shopping for.`
		)
	const { in: input, out: output } = parseTransform(
		transformId(parseTransform(id))
	)
	return { input: input.join(","), output: output.join(",") }
}

/**
 * The two columns, back as the id.
 *
 * Built by `transformId`, so a row whose sides somehow got out of canonical
 * order is READ as the canonical id rather than as a key nothing matches. That
 * makes this a normalising inverse rather than a strict one, which is the safer
 * direction: `transformIdOf(sidesOf(id)) === id` for every id `transformId`
 * emits, and a hand-edited row is repaired on the way out instead of silently
 * disabling a capability.
 */
export function transformIdOf(row: TransformSides): TransformId {
	return transformId({ in: KINDS(row.input), out: KINDS(row.output) })
}
