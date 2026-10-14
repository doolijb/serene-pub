/**
 * A card field as the list of its strokes — what the default `characters`
 * layout renders in place of the joined string when a card is painted in
 * strokes (DESIGN-card-strokes A.4): facts kept apart, which is the stated
 * reason the card is JSON at all.
 *
 * A labelled stroke is `{ "Eyes": "green" }`, an unlabelled one its bare
 * text. `undefined` when the card carries no stroke of that kind, so a layout
 * falls back to the field itself (`(or (strokeList strokes "description")
 * description)`) — a card whose author split only the personality keeps its
 * description string.
 *
 * Reads the card's `strokes` as `compileCharacter` leaves them: only the ones
 * in this prompt, already filtered by detail level. Anything else in the list
 * (a template's own literal) is read defensively — a non-object, a stroke of
 * another kind or one with no text is skipped.
 *
 * One function behind the Handlebars helper, the Liquid filter and the code
 * floor, so the three cannot disagree.
 */
export type StrokeListItem = string | Record<string, string>

export function strokeList(
	strokes: unknown,
	kind: unknown
): StrokeListItem[] | undefined {
	if (!Array.isArray(strokes) || typeof kind !== "string") return undefined
	const out: StrokeListItem[] = []
	for (const s of strokes) {
		if (!s || typeof s !== "object") continue
		const { kind: k, label, text } = s as {
			kind?: unknown
			label?: unknown
			text?: unknown
		}
		if (k !== kind || typeof text !== "string" || !text.trim()) continue
		const l = typeof label === "string" ? label.trim() : ""
		out.push(l ? { [l]: text.trim() } : text.trim())
	}
	return out.length ? out : undefined
}
