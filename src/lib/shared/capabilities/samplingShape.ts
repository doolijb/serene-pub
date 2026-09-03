/**
 * Which capability a sampling config's shape belongs to.
 *
 * Shared rather than server-only because both halves of the app need it and the
 * two were drifting: `SamplingSidebar.svelte` could not import the server copy
 * (it pulls in Drizzle and the schema), so it re-implemented the mapping as
 * `s === S.imageGen ? "text->image" : "text->text"` — which silently sends a TTS
 * config's default to the text capability, starring it as the chat default. Two
 * spellings of one correspondence is how the image shape ends up pointing at the
 * text default on the day somebody adds a capability to only one of them.
 *
 * There is nothing server-shaped here to begin with: it is three string
 * comparisons.
 */

import { S } from "@serene-pub/sdk"

/**
 * The capability id, or `undefined` for a shape that names none.
 *
 * ⚠ `undefined` rather than a `text->text` catch-all. This is also asked about
 * CONNECTION slots, whose shape space is wider than sampling's three:
 * `core:shape/embeddings@1` and `core:shape/mcp@1` are both real connection
 * shapes, and answering "text" for them would layer the instance's default TEXT
 * connection and sampling config onto an embeddings or MCP slot — handing a
 * temperature to a backend that has never heard of one.
 *
 * An ABSENT shape is the one case that still means text: a slot that declared
 * nothing at all is a spec authored before any of this existed, and it should
 * keep getting the answer it always got.
 */
export function capabilityForSamplingShape(
	shape?: string | null
): string | undefined {
	if (shape === S.imageGen) return "text->image"
	if (shape === S.tts) return "text->audio"
	if (shape === S.textGen) return "text->text"
	return shape ? undefined : "text->text"
}
