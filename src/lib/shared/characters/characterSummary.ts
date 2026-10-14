/**
 * The one line a character shows under its name in a list, on a tile, or on a
 * Library card (less-confusing plan F1, 2026-10-11).
 *
 * That line is never the raw description: a card written as a sheet would read
 * "Name: Brix Gender: Female (Designate) Role: …" under the name it had just
 * shown. This picks something written to be read, in this order:
 *
 * 1. the card's own **Summary** (`characters.summary`, the form's one-line
 *    blurb), as written;
 * 2. its **creator notes**, cleaned;
 * 3. its **description**, cleaned.
 *
 * "Cleaned" means: HTML and Markdown markup gone, `{{char}}` read as the
 * character's name, the leading sheet lines skipped ("Name: Brix",
 * "Gender: …", "Appearance: |", a bracketed W++ or PList block), and then the
 * first sentence of the prose that follows. A sheet line whose value is
 * itself prose ("Description: Brix is …", or any value of eight words or
 * more) is read as that prose. Text with nothing but sheet lines gives "",
 * and the caller shows no line rather than the sheet.
 *
 * Pure and shared: the list row, the tile and the Library cards all call it,
 * so the three never disagree about what a character "is" at a glance.
 */

export interface CharacterSummarySource {
	name?: string | null
	/** The card's one-line blurb (`characters.summary`). */
	summary?: string | null
	creatorNotes?: string | null
	description?: string | null
}

export interface CharacterSummaryOptions {
	/** Longest line returned, in characters (code points). Default 200. */
	maxLength?: number
}

/** Keys whose value is the character in prose, however short. */
const PROSE_KEYS = new Set([
	"about",
	"backstory",
	"background",
	"bio",
	"biography",
	"concept",
	"description",
	"intro",
	"introduction",
	"overview",
	"premise",
	"summary",
	"synopsis",
	"tagline"
])

/** A value this long is prose even under a key that is not in PROSE_KEYS. */
const PROSE_VALUE_WORDS = 8

/** Words a full stop can follow without ending the sentence. */
const ABBREVIATIONS = new Set([
	"mr",
	"mrs",
	"ms",
	"dr",
	"st",
	"jr",
	"sr",
	"prof",
	"capt",
	"lt",
	"sgt",
	"gen",
	"col",
	"vs",
	"etc",
	"e.g",
	"i.e",
	"approx"
])

export function characterSummary(
	card: CharacterSummarySource | null | undefined,
	options: CharacterSummaryOptions = {}
): string {
	if (!card) return ""
	const maxLength = options.maxLength ?? 200

	const blurb = oneLine(stripMarkup(card.summary ?? "", card.name))
	if (blurb) return clip(blurb, maxLength)

	const notes = proseLead(card.creatorNotes, card.name)
	if (notes) return clip(notes, maxLength)

	return clip(proseLead(card.description, card.name), maxLength)
}

/** The first sentence of the prose under any leading sheet lines. */
export function proseLead(
	text: string | null | undefined,
	name?: string | null
): string {
	if (!text || !text.trim()) return ""
	const lines = stripMarkup(text, name).split("\n")

	const paragraph: string[] = []
	let inBracketBlock = 0
	for (const raw of lines) {
		const line = tidyLine(raw)

		if (paragraph.length > 0) {
			// The prose paragraph runs until a blank line or the next sheet
			// line, so a sentence wrapped across lines is read whole.
			if (!line || keyLine(line)) break
			paragraph.push(line)
			continue
		}

		if (!line) continue

		// A bracketed block (W++ `[character("Brix") { … }]`, a PList
		// `[Brix: synthetic; calm]`, a `{…}` sheet) is skipped whole.
		if (inBracketBlock > 0 || /^[[{]/.test(line)) {
			inBracketBlock += countOf(line, /[[{]/g) - countOf(line, /[\]}]/g)
			if (inBracketBlock < 0) inBracketBlock = 0
			continue
		}
		if (/^[\]}]/.test(line)) continue
		// Separators and chat-example markers: `---`, `***`, `<START>`.
		if (/^([-=*_~]{3,}|<[^>]*>)$/.test(line)) continue
		// W++ outside brackets: `Species("Android" + "Synthetic")`.
		if (/^[A-Za-z][\w ]{0,30}\(".*"\)\s*$/.test(line)) continue

		const key = keyLine(line)
		if (key) {
			const value = key.value.replace(/^[|>]\s*$/, "").trim()
			if (
				value &&
				(PROSE_KEYS.has(key.key.toLowerCase()) ||
					wordCount(value) >= PROSE_VALUE_WORDS)
			) {
				paragraph.push(value)
			}
			continue
		}

		paragraph.push(line)
	}

	return firstSentence(paragraph.join(" "))
}

/**
 * A sheet line: a short, capitalised key, a colon, a value. One to three
 * words of key, so a sentence with a colon in it ("Ada has one rule: never
 * leave the light.") stays prose.
 */
function keyLine(line: string): { key: string; value: string } | null {
	const match = /^([A-Z][A-Za-z0-9'’()/& -]{0,29}?)\s*[:：]\s*(.*)$/.exec(line)
	if (!match) return null
	const key = match[1].trim()
	if (!key || wordCount(key) > 3) return null
	return { key, value: match[2] }
}

/** HTML and Markdown out, entities decoded, `{{char}}`/`{{user}}` read. */
function stripMarkup(text: string, name?: string | null): string {
	let out = text.replace(/\r\n?/g, "\n")
	// Block-level HTML ends a line; every other tag just goes.
	out = out.replace(/<br\s*\/?>/gi, "\n")
	out = out.replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, "\n")
	out = out.replace(/<[^>\n]*>/g, "")
	out = out
		.replace(/&nbsp;/g, " ")
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;|&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
	// Markdown images go; links keep their text; bare addresses go.
	out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
	out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
	out = out.replace(/\bhttps?:\/\/\S+/g, "")
	// Emphasis and roleplay asterisks.
	out = out.replace(/\*+/g, "").replace(/__+/g, "").replace(/`+/g, "")
	const who = name?.trim()
	if (who) out = out.replace(/\{\{\s*char\s*\}\}/gi, who)
	out = out.replace(/\{\{\s*user\s*\}\}/gi, "you")
	return out
}

/** One line's list, heading and quote markers off, whitespace collapsed. */
function tidyLine(raw: string): string {
	return raw
		.replace(/^\s*(?:#{1,6}\s+|>\s*|[-•·]\s+|\d+[.)]\s+)/, "")
		.replace(/\s+/g, " ")
		.trim()
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim()
}

function wordCount(text: string): number {
	return text.split(/\s+/).filter(Boolean).length
}

function countOf(text: string, pattern: RegExp): number {
	return (text.match(pattern) ?? []).length
}

/**
 * Up to and including the first sentence end that is not an abbreviation or
 * an initial ("Dr. Vell", "J. R. Hale"). The whole text when none.
 */
function firstSentence(text: string): string {
	const ends = /[.!?…]+["'”’)\]]*(?=\s|$)/g
	let match: RegExpExecArray | null
	while ((match = ends.exec(text))) {
		const before = text.slice(0, match.index)
		const word = /([A-Za-z.]+)$/.exec(before)?.[1]?.toLowerCase() ?? ""
		const isAbbreviation =
			match[0].startsWith(".") &&
			match[0].length === 1 &&
			(ABBREVIATIONS.has(word) || /^[a-z]$/.test(word))
		if (isAbbreviation) continue
		return text.slice(0, match.index + match[0].length).trim()
	}
	return text.trim()
}

/** At most `max` code points, cut at a word where one is near. */
function clip(text: string, max: number): string {
	const chars = Array.from(text)
	if (chars.length <= max) return text
	const cut = chars.slice(0, max).join("")
	const space = cut.lastIndexOf(" ")
	const head = space > max * 0.6 ? cut.slice(0, space) : cut
	return head.replace(/[\s,;:.]+$/, "") + "…"
}
