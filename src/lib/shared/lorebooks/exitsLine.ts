/**
 * A room's `Exits:` line, taken apart (plan places-graph §11, B7).
 *
 * The Lair's drafting prompts (Build room, the knock's draft, File as a room)
 * still write a room's ways out as one prose line in its body —
 * `LAIR_ROOM_CONTENT_SHAPE`: `Exits: <direction> → <room>, <direction> → <room>`
 * — because a draft names rooms that may not exist yet, and how the map should
 * grow from it is the owner's open Q4. The ways between places are
 * relationships; this line is the room's own words.
 *
 * The place editor's **Read links from the Exits line** reads it ON REQUEST
 * and offers the links it names for the person to confirm. Nothing parses it
 * at write time.
 *
 * ⚠ **Pure, and resolves nothing.** Which place a name answers to is the one
 * room rule's (`answeringRows`, `./describingRow`), and whether a link
 * already says it is the Links list's (`exitsLineLinks`, client). This only
 * reads the words, so it can later run at write time (Q4 = b) unchanged. A
 * name that may hold a comma or a note is therefore returned with its longer
 * readings (`longerNames`) for the resolver to try first.
 *
 * "Exit" is not adopted as a noun (plan §13: the Lair's `exit` / `exitCheck`
 * name a room). The line is the *Exits line*, after its label; each
 * `<bearing> → <room>` on it is a **signpost**, and what stands before its
 * arrow is its **bearing** — never *way*, which is already a relationship's
 * direction of reading (`RelationshipReading.way`: out, back, inbound).
 */

import { LEADING_ARTICLES, nameWords } from "@serene-pub/sdk"

/** One `<bearing> → <room>` an Exits line names: a way out, and where it leads. */
export interface ExitsLineSignpost {
	/** What stands before the arrow, as written ("north", "a rusted iron door"); `''` when nothing does. */
	bearing: string
	/**
	 * The room it leads to, as written up to its first comma, with its
	 * dressing, a trailing note ("(locked)", "— the door is barred") and
	 * trailing punctuation taken off. Never blank. A new place made for it is
	 * named this.
	 */
	to: string
	/**
	 * Longer readings of the same name, longest first: through the comma
	 * pieces after it ("The Hall, East Wing") and with its trailing note kept
	 * ("The Hall (East)"). A place called one of these is the room, before a
	 * place called `to`. Empty when there are none.
	 */
	longerNames: string[]
	/**
	 * The relationship type it reads as from this room: "leads north to"; a
	 * plain "leads to" when the bearing is a thing (then it is the `name`) or
	 * blank.
	 */
	wording: string
	/**
	 * The relationship's name: the bearing when it is a thing — led by an
	 * article ("a rusted iron door", "the well") or a proper name ("Kings
	 * Road") — else `''`.
	 */
	name: string
}

/**
 * The label and its dressing: an optional bullet, quote or bold before
 * `Exits:`. Horizontal space only, so an empty line never reads the next one
 * as its text. The text after the colon is taken whole and trimmed in code —
 * a lazy capture before trailing space backtracks on a long line.
 */
const EXITS_LINE = /^[ \t>*_•-]*exits?[ \t*_]*:(.*)$/i

/**
 * The arrows a signpost is written with: `→` and its kin, `->` / `-->` /
 * `—>`, `=>` / `==>`. A run of dashes or equals signs is matched from its
 * first character only (the lookbehinds), so a long run is tried once, not
 * from every position in it.
 */
const ARROWS = /→|⟶|⇒|⟹|➜|➔|➙|➛|➝|➞|➟|➠|⇨|↦|⟼|(?<![-–—])[-–—]+>|(?<!=)=+>/

/**
 * A line with no arrow may use a colon for one: `north: The Hall`. Never
 * "to": prose says it ("the way back to town is blocked"), so reading it
 * would name rooms like "town is blocked".
 */
const COLON = /:(?= )/

/**
 * Where a room's name ends and the next bearing begins, between two arrows
 * ("The Hall and south", "Hall. South", "The Drowned Hall, down"): the LAST
 * of these, since a bearing is short and a name may hold one.
 */
const BETWEEN_SIGNPOSTS = [",", ". ", "! ", "? ", " and ", " or ", " then ", " & "]

/** The most comma pieces a longer reading of a name joins ("A, B, C, D"). */
const LONGEST_NAME_PIECES = 4

/** Where the words before a line's first arrow give way to its first bearing. */
const BEFORE_FIRST = [",", ". ", "! ", "? "]

/** Punctuation a name never ends with. */
const TRAILING = new Set([".", ",", ";", ":", "!", "?", "…", "—", "–", "-", " "])

/** Pairs that may wrap a name or a bearing. */
const WRAPPERS: readonly [string, string][] = [
	['"', '"'],
	["“", "”"],
	["'", "'"],
	["‘", "’"],
	["**", "**"],
	["*", "*"],
	["_", "_"],
	["[", "]"],
	["(", ")"]
]

/** Marks that open or close emphasis or a quotation, left over when a comma split one. */
const STRAY: Record<string, string> = { '"': '"', "“": "”", "*": "*", "_": "_" }

/**
 * Each place `text` holds one of `seps` outside brackets (a separator inside
 * "(locked, barred)" is the note's), as its index and length. The separators
 * are lower case and start with a non-letter, so a case-blind compare only
 * runs where the first character already matches.
 */
function cutsOf(
	text: string,
	seps: readonly string[]
): { at: number; length: number }[] {
	const cuts: { at: number; length: number }[] = []
	let depth = 0
	for (let i = 0; i < text.length; i++) {
		const c = text[i]
		if (c === "(" || c === "[") depth++
		else if ((c === ")" || c === "]") && depth > 0) depth--
		else if (depth === 0) {
			const sep = seps.find(
				(s) =>
					c === s[0] && text.slice(i, i + s.length).toLowerCase() === s
			)
			if (sep) {
				cuts.push({ at: i, length: sep.length })
				i += sep.length - 1
			}
		}
	}
	return cuts
}

/** Text with trailing punctuation and space taken off, scanned once from the end. */
function trimTrailing(text: string): string {
	let end = text.length
	while (end > 0 && TRAILING.has(text[end - 1]!)) end--
	return text.slice(0, end).trimStart()
}

/**
 * Text with a trailing bracketed note taken off ("The Hall (locked)"), found
 * by counting brackets back from the end. A name wholly in brackets is left
 * for the wrappers to open; an unbalanced one is left as it is.
 */
function withoutTrailingNote(text: string): string {
	const close = text[text.length - 1]
	const open = close === ")" ? "(" : close === "]" ? "[" : null
	if (!open) return text
	let depth = 0
	for (let i = text.length - 1; i >= 0; i--) {
		if (text[i] === close) depth++
		else if (text[i] === open && --depth === 0)
			return i > 0 ? text.slice(0, i).trim() : text
	}
	return text
}

/** Text with a note after a spaced dash taken off ("The Hall — the door is barred"). */
function withoutDashNote(text: string): string {
	const at = [" — ", " – "]
		.map((dash) => text.indexOf(dash))
		.filter((i) => i > 0)
	return at.length ? text.slice(0, Math.min(...at)).trim() : text
}

/**
 * Text undressed: trailing punctuation, wrapping quotes, bold and brackets,
 * stray emphasis marks and — unless `keepNote` — a trailing note taken off.
 * A few rounds at most: dressing is shallow, and a bound keeps a line of
 * nothing but asterisks linear.
 */
function undressed(text: string, keepNote = false): string {
	let out = text.trim()
	for (let round = 0, changed = true; changed && round < 8; round++) {
		const before = out
		out = trimTrailing(out)
		if (!keepNote) out = withoutDashNote(withoutTrailingNote(out))
		for (const [open, close] of WRAPPERS)
			if (
				out.length > open.length + close.length &&
				out.startsWith(open) &&
				out.endsWith(close)
			)
				out = out.slice(open.length, out.length - close.length).trim()
		const first = out[0]
		if (first && STRAY[first] && !out.includes(STRAY[first]!, 1))
			out = out.slice(1).trim()
		const last = out[out.length - 1]
		const opener = Object.keys(STRAY).find((o) => STRAY[o] === last)
		if (last && opener && !out.slice(0, -1).includes(opener))
			out = out.slice(0, -1).trim()
		changed = out !== before
	}
	return out
}

/** A word written capitalised or in capitals, said in lower case. */
function lowerWord(word: string): string {
	const lower = word.toLowerCase()
	const capitalised = lower.charAt(0).toUpperCase() + lower.slice(1)
	return word === capitalised || word === word.toUpperCase() ? lower : word
}

const isArticle = (word: string) => LEADING_ARTICLES.includes(word.toLowerCase())
const isShouted = (word: string) =>
	word === word.toUpperCase() && word !== word.toLowerCase()
const isCapitalised = (word: string) =>
	!isShouted(word) && word.charAt(0) !== word.charAt(0).toLowerCase()

/** How a bearing reads as a relationship from this room: its words, and its name. */
function wordingOf(bearing: string): Pick<ExitsLineSignpost, "wording" | "name"> {
	const plain = { wording: "leads to", name: "" }
	const words = bearing.split(" ").filter(Boolean)
	// Blank, or an article alone ("a → The Hall"): nothing to say.
	if (words.every(isArticle)) return plain
	// A thing you go through — led by an article ("a rusted iron door") or a
	// proper name ("Kings Road") — is the link's name; the link "leads to".
	if (
		words.length > 1 &&
		(isArticle(words[0]!) ||
			(words.every(isCapitalised) && !/^leads?$/i.test(words[0]!)))
	)
		return { wording: "leads to", name: bearing }
	// A direction: the front word lower-cased as a sentence's start is, or
	// every word when the whole is in capitals ("NORTH EAST").
	const said = (
		words.every(isShouted)
			? words.map((word) => word.toLowerCase())
			: [lowerWord(words[0]!), ...words.slice(1)]
	)
		.join(" ")
		.replace(/^leads? /i, "")
		.replace(/ to$/i, "")
	return !said || /^(leads?|to)$/i.test(said)
		? plain
		: { wording: `leads ${said} to`, name: "" }
}

/**
 * The signpost `before → after` names, or null when `after` names no room:
 * no words ("?", "…"), or the prompt's own unfilled placeholder (`<room>`).
 */
function signpostOf(before: string, after: string): ExitsLineSignpost | null {
	if (/^ ?<[^>]*>/.test(after)) return null
	// Where each comma piece ends, the first few only: a name holds a comma
	// or two, and a line of nothing but commas stays linear.
	const commas = cutsOf(after, [","]).map((cut) => cut.at)
	const ends = [
		...commas.slice(0, LONGEST_NAME_PIECES - 1),
		commas[LONGEST_NAME_PIECES - 1] ?? after.length
	]
	const to = undressed(after.slice(0, ends[0]))
	if (nameWords(to).length === 0) return null
	const longerNames: string[] = []
	for (let k = ends.length - 1; k >= 0; k--) {
		const whole = after.slice(0, ends[k])
		for (const reading of [undressed(whole, true), undressed(whole)])
			if (
				reading !== to &&
				nameWords(reading).length > 0 &&
				!longerNames.includes(reading)
			)
				longerNames.push(reading)
	}
	const bearing = undressed(before)
	return { bearing, to, longerNames, ...wordingOf(bearing) }
}

/**
 * The text of a body's first `Exits:` line, after the label — `''` when the
 * line is there with nothing on it — or null when the body has no such line.
 * The label must open its line (a bullet or bold aside), so "The exits: …" in
 * a sentence is not it.
 */
export function exitsLineOf(content: unknown): string | null {
	if (typeof content !== "string") return null
	for (const line of content.split(/\r?\n/)) {
		const match = EXITS_LINE.exec(line)
		if (match) return (match[1] ?? "").replace(/^[ \t*_]+/, "").trim()
	}
	return null
}

/**
 * The signposts a body's `Exits:` line names, in the order it names them.
 *
 * The line is read in clauses split on semicolons, and each clause on its
 * arrows — or, in a line with no arrow, on its colons. Between two arrows,
 * the text is one room's name and the next bearing, cut at the last comma,
 * full stop, "and", "or" or "then" ("The Hall and south"); with nothing to
 * cut at ("north → A -> B"), the rest of the clause is one name with an arrow
 * in it and names nothing. Before the first arrow, the bearing is the text
 * after the last comma or full stop ("a crack in the wall, north"). After the
 * last, the room runs to the clause's end, its comma pieces kept as longer
 * readings (`longerNames`). A room with no words and the prompt's unfilled
 * placeholder are left out. Names are kept as written; nothing here says
 * which place one is.
 */
export function parseExitsLine(content: unknown): ExitsLineSignpost[] {
	const line = exitsLineOf(content)
	if (!line) return []
	const text = line.replace(/\s+/g, " ")
	const arrow = ARROWS.test(text) ? ARROWS : COLON
	const signposts: ExitsLineSignpost[] = []
	for (const clause of text.split(";")) {
		const parts = clause.split(arrow)
		if (parts.length < 2) continue
		const lead = cutsOf(parts[0]!, BEFORE_FIRST).at(-1)
		let bearing = lead ? parts[0]!.slice(lead.at + lead.length) : parts[0]!
		for (let i = 1; i < parts.length; i++) {
			const part = parts[i]!
			const last = i === parts.length - 1
			const cut = last ? undefined : cutsOf(part, BETWEEN_SIGNPOSTS).at(-1)
			if (!last && !cut) break
			const signpost = signpostOf(bearing, cut ? part.slice(0, cut.at) : part)
			if (signpost) signposts.push(signpost)
			if (cut) bearing = part.slice(cut.at + cut.length)
		}
	}
	return signposts
}
