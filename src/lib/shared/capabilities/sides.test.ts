/**
 * The storage boundary of `connection_defaults`, over the whole transform table.
 *
 * 0183 split `capability` into `input` and `output`. Everything about that split
 * fails SILENTLY if it is wrong: a side written in the wrong order is a valid
 * primary key that matches nothing, on a table whose entire job is to be matched
 * by key. Nothing throws, no screen changes, and the first symptom is a run
 * refusing a capability the admin can see registered.
 *
 * Hence a property over `TRANSFORMS` rather than three hand-picked examples. The
 * examples are the ones that would be picked — `text->text` round-trips under
 * every convention anyone might implement, alphabetical included — so they prove
 * the least.
 */

import { describe, expect, test } from "vitest"
import {
	IO_KINDS,
	TRANSFORMS,
	transformId,
	type TransformId
} from "@serene-pub/sdk"
import { sidesOf, transformIdOf } from "./sides"

const IDS = Object.keys(TRANSFORMS) as TransformId[]

describe("the round trip", () => {
	test("every transform this build names survives storage unchanged", () => {
		// The whole deliverable. `transformIdOf(sidesOf(id)) === id` is what
		// makes the columns a re-spelling of the id rather than a second,
		// slightly different fact about it.
		expect(IDS.length).toBeGreaterThan(0)
		for (const id of IDS)
			expect(
				transformIdOf(sidesOf(id)),
				`${id} did not survive the round trip through (input, output) — ` +
					`it stores as ${JSON.stringify(sidesOf(id))}, which reads back ` +
					`as "${transformIdOf(sidesOf(id))}". A row written under one ` +
					`convention and read under another is a default nothing matches.`
			).toBe(id)
	})

	test("it holds for a transform this build has never heard of", () => {
		// The table is closed; the id space is not. A plugin's own combination
		// has to store and read back exactly as well, or installing one silently
		// costs it its default.
		for (const id of [
			"text->video",
			"text+audio->video",
			"image+document->text",
			"audio->embedding"
		] as TransformId[])
			expect(transformIdOf(sidesOf(id))).toBe(id)
	})
})

describe("what the columns actually contain", () => {
	test("the delimiter is a comma and no `+` survives", () => {
		for (const id of IDS) {
			const { input, output } = sidesOf(id)
			expect(input).not.toContain("+")
			expect(output).not.toContain("+")
		}
		expect(sidesOf("text+image->text")).toEqual({
			input: "text,image",
			output: "text"
		})
	})

	test("every segment is a value from the IO kinds enum", () => {
		// "comma delimited values that match the value string of our enums
		// complex" — asserted rather than assumed, because the only thing
		// stopping `sidesOf` from emitting a typo is that it never spells a kind
		// itself.
		const kinds = new Set<string>(IO_KINDS)
		for (const id of IDS) {
			const { input, output } = sidesOf(id)
			for (const side of [input, output])
				for (const kind of side.split(","))
					expect(kinds.has(kind), `"${kind}" (from ${id})`).toBe(true)
		}
	})

	test("the order is IO_KINDS declaration order, NOT alphabetical", () => {
		// The one property a reasonable person would get wrong. `IO_KINDS` is
		// text, image, audio, video, document, embedding — so vision's input is
		// "text,image" even though "image,text" is what sorting the two words
		// gives you. Sorting alphabetically would emit a side `transformId()`
		// never produces, and every row written that way would be unreachable.
		expect(sidesOf("text+image->text").input).toBe("text,image")
		expect(sidesOf("text+document->text").input).toBe("text,document")
		expect(sidesOf("text+image->image").input).toBe("text,image")

		// Stated as the general rule as well, so a change to `IO_KINDS` order
		// that breaks the correspondence is caught here rather than in a run.
		const position = new Map(IO_KINDS.map((k, i) => [k as string, i]))
		for (const id of IDS) {
			const { input, output } = sidesOf(id)
			for (const side of [input, output]) {
				const ranks = side.split(",").map((k) => position.get(k)!)
				expect(
					[...ranks].sort((a, b) => a - b),
					`${id} stores "${side}" out of IO_KINDS order`
				).toEqual(ranks)
			}
		}
	})
})

describe("the guard", () => {
	test("a feature id is refused rather than stored with an empty side", () => {
		// `connections:setDefault` takes `capability` as a client string and only
		// judges it against a connection when one is NAMED — clearing with
		// `id: null` reaches the writer unjudged. Under the old single-column key
		// "tools" was a harmless-looking row; under the split it is
		// `output = ''`, a row no reader can ever match again, which is the shape
		// 0183's DELETE exists to clean up.
		expect(() => sidesOf("tools" as TransformId)).toThrow(
			/not a transform id/i
		)
		expect(() => sidesOf("json_schema" as TransformId)).toThrow(
			/not a transform id/i
		)
	})

	test("reading is total — a junk row is a junk key, not an exception", () => {
		// Reads run over stored bytes, and `capabilityDefaults()` fetches the
		// whole table in one query. Throwing on one bad row would take every
		// good default in the same SELECT down with it.
		expect(transformIdOf({ input: "tools", output: "" })).toBe("tools->")
		expect(transformIdOf({ input: "", output: "" })).toBe("->")
	})

	test("a side stored out of order is repaired on the way out", () => {
		// Normalising rather than strict, deliberately: a hand-edited row reads
		// back as the capability it plainly means instead of disabling it.
		expect(transformIdOf({ input: "image,text", output: "text" })).toBe(
			"text+image->text"
		)
	})

	test("and a mis-ordered id is canonicalised on the way IN as well", () => {
		// The pair of the test above, and the reason `sidesOf` re-emits through
		// `transformId` first. If only the READ normalised, writing
		// `image+text->text` would store "image,text" and every subsequent
		// lookup — built from the canonical id — would ask for "text,image" and
		// miss the row it had just written.
		expect(sidesOf("image+text->text" as TransformId)).toEqual(
			sidesOf("text+image->text")
		)
		expect(sidesOf("image+text->text" as TransformId).input).toBe(
			"text,image"
		)
	})
})

describe("agreement with the SDK", () => {
	test("the id a row reads back as is one `transformId` would emit", () => {
		// The columns cannot drift from the id space, because both directions go
		// through the SDK's own `side()` — there is no second comparator here to
		// keep in step. This asserts that rather than trusting it.
		for (const id of IDS) {
			const { input, output } = sidesOf(id)
			expect(
				transformId({
					in: input.split(",") as any,
					out: output.split(",") as any
				})
			).toBe(id)
		}
	})
})
