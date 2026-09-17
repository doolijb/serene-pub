/**
 * What an OUTPUT KIND is called, and which mark it wears.
 *
 * An output kind is the right-hand side of a transform id — the `text` of
 * `text+image->text`, the `embedding` of `text->embedding`. `outputKindOf`
 * (`$lib/shared/capabilities/samplingShape`) is what reads one off an id; this
 * module only says what to render for it.
 *
 * ## Why it is shared rather than local to one screen
 *
 * Two screens now group capabilities by output kind — Admin → Defaults and the
 * connections index's defaults ledger — and a person moving between them is
 * looking at the same seven headings. Two copies of this table is two places
 * for `embedding: "Vectors"` to appear in one of them.
 *
 * ⚠ Plain words, deliberately. A heading reading `text` over a card reading
 * "Chat" is the machine's vocabulary leaking into the person's. An unknown
 * kind — a plugin's `text->video` — falls through to `Produces <kind>` rather
 * than to "Other", so it gets a heading that names it instead of a bucket.
 *
 * ⚠ Client-safe and Svelte-free: the icons are `@lucide/svelte` EXPORT NAMES
 * resolved by whichever component renders them, the same contract
 * `ConnectionSection.icon` keeps and for the same reason — importing a
 * component here would put this table out of reach of a plain unit test.
 */

/** The heading for each output kind. */
export const OUTPUT_KIND_LABELS: Record<string, string> = {
	text: "Text",
	image: "Images",
	audio: "Speech and audio",
	video: "Video",
	document: "Documents",
	embedding: "Embeddings",
	entities: "Named entities"
}

/** A `@lucide/svelte` export name per output kind. `Boxes` is the fallback. */
export const OUTPUT_KIND_ICONS: Record<string, string> = {
	text: "Type",
	image: "Image",
	audio: "AudioLines",
	video: "Clapperboard",
	document: "FileText",
	embedding: "Zap",
	entities: "ScanText"
}

/** The heading, or a sentence naming an output kind this build has no word for. */
export function outputKindLabel(kind: string): string {
	return OUTPUT_KIND_LABELS[kind] ?? `Produces ${kind}`
}
