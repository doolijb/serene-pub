/**
 * 🚧 The words for one Known by row: what the judgement decided and, when the
 * member's own switch is not what decided it, why not. Pure, so the sentences
 * are tested without a screen.
 */

type Row = Sockets.EntryKnowledge.Row
type Moment = Sockets.EntryKnowledge.Moment

export interface KnownByWords {
	/** What the member does with the entry. */
	result: string
	/** Why the switch is overridden or idle, or null. */
	note: string | null
}

export function knownByWords(
	row: Row,
	marked: boolean,
	formatDate: (m: Moment) => string
): KnownByWords {
	return {
		result: resultOf(row, formatDate),
		note: noteOf(row, marked, formatDate)
	}
}

/** `as of ‹date›`, or nothing for an undated tie. */
const asOf = (date: Moment | null, formatDate: (m: Moment) => string) =>
	date ? `, as of ${formatDate(date)}` : ""

function resultOf(row: Row, formatDate: (m: Moment) => string): string {
	const w = row.winner
	let keptFrom = false
	let out: string
	if (w === null) {
		out = row.known ? "Knows it: common knowledge" : "Does not know it"
	} else if (w.kind === "knows") {
		out = w.hand ? "Knows it" : `Knows it${asOf(w.date, formatDate)}`
	} else if (w.kind === "kept_from") {
		keptFrom = true
		out = w.hand
			? "Kept from it"
			: `Kept from it${asOf(w.date, formatDate)}`
	} else if (w.kind === "was_told") {
		out = "Knows it: was told"
	} else if (w.kind === "has_been_there") {
		out = "Knows it: has been there"
	} else {
		out = `Knows it: tied as “${w.relationshipType}”`
	}
	if (keptFrom && row.placeEntry) out += ", except while standing there"
	return out
}

/** A tie, in words. */
function tieWords(
	w: NonNullable<Row["winner"]>,
	formatDate: (m: Moment) => string
): string {
	if (w.kind === "was_told") return "“was told”"
	if (w.kind === "has_been_there") return "“has been there”"
	if (w.kind === null) return `“${w.relationshipType}”`
	if (w.date) return `a tie dated ${formatDate(w.date)}`
	return w.kind === "kept_from"
		? "another “kept from” tie"
		: "another “knows” tie"
}

function noteOf(
	row: Row,
	marked: boolean,
	formatDate: (m: Moment) => string
): string | null {
	if (!row.hand) return null
	const switchKeeps = row.hand === "kept_from"
	const over = row.overruled
	// A hand tie always wins; say so when the tie it stands over would have
	// decided the other way.
	if (over && (over.kind === "kept_from") !== switchKeeps) {
		const mine = switchKeeps ? "Kept from" : "Knows"
		return `${mine} stands over ${tieWords(over, formatDate)}; set it back to Default and that tie wins again.`
	}
	if (row.hand === "knows" && !marked)
		return "Changes nothing until the entry is marked not common knowledge."
	return null
}
