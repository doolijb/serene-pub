import type { ZoneField } from "./entryVersions"

export interface EntryZoneWordsInput {
	/** The book keeps a timeline: the line and the Beginning are said. */
	timeline: boolean
	/** *On ‹line›*, said first with the Timeline on, when given. */
	lineWords?: string | null
	/** The Beginning already in words (*Year 5*), or null for Perpetual. */
	beganAt: string | null
	decayRate: number
	/** Which of the four the row holds; the others differ by version and are left out. */
	held: readonly ZoneField[]
	keyCount: number
	/** False for a type that is never filed (a place): no parent words. */
	fileable: boolean
	/** The parent's name; null is top level. */
	parentName: string | null
	pinned: boolean
	off: boolean
}

/**
 * The entry zone's one line, in words: the line, the Beginning, the Decay,
 * then each of the four fields the row holds. Fields that differ by version
 * are left out.
 */
export function entryZoneWords(input: EntryZoneWordsInput): string {
	const parts: string[] = []
	if (input.timeline) {
		if (input.lineWords) parts.push(input.lineWords)
		parts.push(input.beganAt ? `Began at ${input.beganAt}` : "Perpetual")
	}
	const decay =
		input.decayRate > 0
			? `Living · ${String(Number(input.decayRate.toFixed(2)))}`
			: "Fact"
	parts.push(input.timeline ? decay : `Decay: ${decay}`)
	const holds = (field: ZoneField) => input.held.includes(field)
	if (holds("keys"))
		parts.push(
			input.keyCount === 0
				? "no keywords"
				: input.keyCount === 1
					? "1 keyword"
					: `${input.keyCount} keywords`
		)
	if (holds("anchorEntryId") && input.fileable)
		parts.push(
			input.parentName === null
				? "top level"
				: `part of ${input.parentName}`
		)
	if (holds("constant") && input.pinned) parts.push("pinned")
	if (holds("enabled") && input.off) parts.push("off")
	return parts.join(" · ")
}
