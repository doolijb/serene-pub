/**
 * 🚧 `core:task/cue-lines@1` — a line's text -> its speech cues (PLAN-speech-
 * connections-and-timbre §11.1–§11.2; seam S3). Pure and deterministic: regex
 * and locale tables, the same input giving the same cues, no model.
 *
 * ## What the scanner reads
 *  - **dialogue**: text in a quote style (`quoteStyles`; each entry is the
 *    open mark then the close mark; default `"" “” ‘’ «» 「」 『』`, plus the
 *    locale styles of `language`). An unclosed quote ends at a blank line.
 *  - **action**: `*…*` and `_…_` OUTSIDE a quote, per `asterisks` (`action` | `emphasis` |
 *    `ignore`; the last two read the words inline in the surrounding cue).
 *  - **aside**: `(…)`, nesting counted.
 *  - **narration**: everything else.
 *  - `Name:` at the start of a line, where Name is one of `cast`, switches the
 *    cues' `speaker` until the next `Name:` or a blank line. A line that
 *    carries no quote or asterisk mark after its `Name:` is script format, and
 *    its words are that speaker's dialogue.
 *  - inline **markers** the model wrote — `[angry]`, `<laugh>`, `(((word)))`,
 *    and `*sighs*` when `sighs` is in the marker table — are lifted off the
 *    text into `markers` and never spoken. A marker stays with the cue it
 *    stood in; one standing before any words rides on the next cue.
 *  - fenced and inline code is dropped; markdown emphasis (`**`), headings,
 *    quotes and links are flattened to their words.
 *  - `emphasis` is the cue's final `!` `?` `…`.
 *  - `inflection` per cue: its marker's label (marker table), else the line's.
 *  - `voices` maps each kind to a voice; `silent` cues stay in the script.
 */
import {
	ASTERISK_READINGS,
	DEFAULT_CUE_VOICES,
	DEFAULT_QUOTE_STYLES,
	CUE_VOICES,
	type AsteriskReading,
	type Cue,
	type CueEmphasis,
	type CueKind,
	type CueVoice,
	type CueVoices
} from "@serene-pub/sdk"
import { markerInflection } from "./markers"

export interface CueLinesInput {
	text: string
	/** The line's recorded inflection: a label, or an inflection / sprite pick (`{ label }`). */
	inflection?: unknown
	/** Names `Name:` may switch to — see `castNamesOf` for the shapes accepted. */
	cast?: unknown
	quoteStyles?: readonly string[] | null
	asterisks?: AsteriskReading | null
	voices?: Partial<CueVoices> | null
	language?: string | null
}

// ── Tables ──────────────────────────────────────────────────────────────────

/** Extra quote styles by language (ISO 639-1), added to the configured ones. */
export const LOCALE_QUOTE_STYLES: Readonly<Record<string, readonly string[]>> = Object.freeze({
	de: ["„“", "„”", "‚‘", "»«"],
	pl: ["„”"],
	cs: ["„“", "‚‘"],
	sk: ["„“"],
	hu: ["„”"],
	ro: ["„”"],
	ru: ["«»", "„“"],
	uk: ["«»", "„“"],
	nl: ["„”"],
	sv: ["””", "»»"],
	fi: ["””", "»»"],
	da: ["»«"],
	fr: ["«»"],
	es: ["«»"],
	it: ["«»"],
	pt: ["«»"],
	ja: ["「」", "『』"],
	zh: ["「」", "『』", "“”", "‘’"]
})

/** Private-use sentinels: a lifted marker stands in the scanned text as `OPEN index CLOSE`. */
const MARK_OPEN = ""
const MARK_CLOSE = ""

const SPEAKABLE = /[\p{L}\p{N}]/u

// ── Small helpers ───────────────────────────────────────────────────────────

const isSpace = (c: string | undefined) => c === undefined || /\s/u.test(c)
const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c)

interface QuoteStyle {
	open: string
	close: string
}

/** `""` -> open `"`, close `"`; `“”` -> `“`, `”`; a longer entry splits in half by code point. */
export function parseQuoteStyle(entry: string): QuoteStyle | null {
	const cps = Array.from(entry ?? "")
	if (cps.length === 0) return null
	if (cps.length === 1) return { open: cps[0]!, close: cps[0]! }
	const half = Math.floor(cps.length / 2)
	return { open: cps.slice(0, half).join(""), close: cps.slice(half).join("") }
}

function quoteStylesFor(
	configured: readonly string[] | null | undefined,
	language: string | null | undefined
): QuoteStyle[] {
	const list = [...(configured?.length ? configured : DEFAULT_QUOTE_STYLES)]
	const lang = (language ?? "").trim().toLowerCase().slice(0, 2)
	for (const extra of LOCALE_QUOTE_STYLES[lang] ?? []) if (!list.includes(extra)) list.push(extra)
	const out: QuoteStyle[] = []
	const seen = new Set<string>()
	for (const entry of list) {
		const style = parseQuoteStyle(entry)
		if (!style) continue
		const key = style.open + "\u0000" + style.close
		if (seen.has(key)) continue
		seen.add(key)
		out.push(style)
	}
	// Longest opening mark first, so a multi-character mark wins over a prefix of it.
	return out.sort((a, b) => b.open.length - a.open.length)
}

/**
 * The cast's names, from any of the shapes a spec wires: `string[]`, a
 * `SessionCastV1` (character seats and player seats), or a settings document
 * that carries one under `.cast`. Aliases and nicknames count. Duplicates and
 * blanks are dropped; order is first-seen.
 */
export function castNamesOf(cast: unknown): string[] {
	const out: string[] = []
	const push = (v: unknown) => {
		if (typeof v === "string" && v.trim() && !out.includes(v.trim())) out.push(v.trim())
	}
	const pushAliases = (v: unknown) => {
		if (Array.isArray(v)) for (const a of v) push(a)
	}
	const fromCard = (card: unknown) => {
		if (!card || typeof card !== "object") return
		const c = card as Record<string, unknown>
		push(c.name)
		push(c.nickname)
		pushAliases(c.aliases)
	}
	const read = (v: unknown, depth: number) => {
		if (v == null || depth > 2) return
		if (typeof v === "string") return push(v)
		if (Array.isArray(v)) {
			for (const item of v) {
				if (typeof item === "string") push(item)
				else if (item && typeof item === "object") {
					const o = item as Record<string, unknown>
					if (typeof o.name === "string") fromCard(o)
					else if (o.character) fromCard(o.character)
				}
			}
			return
		}
		if (typeof v !== "object") return
		const o = v as Record<string, unknown>
		if ("sessionCharacters" in o || "sessionPersonas" in o) {
			for (const seat of (o.sessionCharacters as unknown[]) ?? []) {
				const s = seat as Record<string, unknown>
				if (s?.enabled === false || s?.removedAt) continue
				fromCard(s?.character)
			}
			for (const seat of (o.sessionPersonas as unknown[]) ?? []) {
				const s = seat as Record<string, unknown>
				if (s?.removedAt) continue
				push(s?.seatName)
				fromCard(s?.persona)
			}
			return
		}
		if ("cast" in o) return read(o.cast, depth + 1)
		if ("names" in o) return read(o.names, depth + 1)
	}
	read(cast, 0)
	return out
}

/** The label of whatever the line carries as its inflection (a string, an inflection, a sprite pick). */
export function inflectionLabelOf(v: unknown): string | null {
	if (typeof v === "string") return v.trim() || null
	if (v && typeof v === "object") {
		const label = (v as { label?: unknown }).label
		if (typeof label === "string" && label.trim()) return label.trim()
	}
	return null
}

// ── Pre-pass: code, markdown, markers ───────────────────────────────────────

/** Drop fenced and inline code. An unclosed fence drops to the end. */
function dropCode(text: string): string {
	let out = text.replace(/(^|\n)[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(\n[ \t]*\2[^\n]*(?=\n|$)|$)/g, "$1")
	out = out.replace(/``[^`]*``/g, " ").replace(/`[^`\n]*`/g, " ")
	return out.replace(/`+/g, " ")
}

/** Flatten markdown that carries no speech: links, headings, block quotes, rules, list bullets. */
function flattenMarkdown(text: string): string {
	return text
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]\n]+)\]\((?:[^)\s]*)\)/g, "$1")
		.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
		.replace(/^[ \t]*>[ \t]?/gm, "")
		.replace(/^[ \t]*(?:[-*_]){3,}[ \t]*$/gm, "")
		.replace(/^[ \t]*[-+•][ \t]+/gm, "")
		.replace(/~~/g, "")
}

/**
 * Lift the inline markers off the text, leaving a sentinel where each stood.
 * Returns the text and the markers (index = sentinel number).
 */
function liftMarkers(text: string, asterisks: AsteriskReading): { text: string; markers: string[] } {
	const markers: string[] = []
	const stand = (name: string) => {
		markers.push(name.trim())
		return `${MARK_OPEN}${markers.length - 1}${MARK_CLOSE}`
	}
	let out = text
	// (((word))) — the triple-paren marker.
	out = out.replace(/\(\(\(([^()\n]{1,40})\)\)\)/g, (_m, w: string) => stand(w))
	// [angry] — one to forty characters on one line; a markdown link is already flat.
	out = out.replace(/\[([^\[\]\n]{1,40})\]/g, (_m, w: string) => stand(w))
	// </b> and the like are dropped; <laugh> is a marker.
	out = out.replace(/<\/[A-Za-z][^<>\n]{0,30}>/g, " ")
	out = out.replace(/<([A-Za-z][A-Za-z0-9 _-]{0,30})>/g, (_m, w: string) => stand(w))
	// *sighs* — only where asterisks read as actions, only a single word the table knows.
	if (asterisks === "action")
		out = out.replace(/(?<![\w*])\*([A-Za-z]{2,20})\*(?![\w*])/g, (m, w: string) =>
			markerInflection(w) ? stand(w) : m
		)
	return { text: out, markers }
}

// ── The scanner ─────────────────────────────────────────────────────────────

interface Run {
	kind: CueKind
	text: string
	markers: string[]
	speaker?: string
}

type Frame =
	| { kind: "dialogue"; style: QuoteStyle }
	| { kind: "action"; end: number }
	| { kind: "aside"; end: number }

/** End of the paragraph containing index `from` (index of the blank line, or length). */
function paragraphEnd(cs: readonly string[], from: number): number {
	for (let i = from; i < cs.length; i++) {
		if (cs[i] === "\n") {
			let j = i + 1
			while (j < cs.length && (cs[j] === " " || cs[j] === "\t" || cs[j] === "\r")) j++
			if (cs[j] === "\n") return i
		}
	}
	return cs.length
}

function startsWithAt(cs: readonly string[], i: number, s: string): boolean {
	const sc = Array.from(s)
	for (let k = 0; k < sc.length; k++) if (cs[i + k] !== sc[k]) return false
	return true
}

function scan(
	input: string,
	opts: {
		styles: QuoteStyle[]
		asterisks: AsteriskReading
		cast: string[]
		markers: string[]
	}
): Run[] {
	const cs = Array.from(input.replace(/\r\n?/g, "\n"))
	const { styles, asterisks, markers } = opts
	// Longest names first so "Mary Ann:" is not read as "Mary".
	const cast = [...opts.cast].sort((a, b) => b.length - a.length)
	const runs: Run[] = []
	const stack: Frame[] = []
	const skip = new Set<number>()
	let base: CueKind = "narration"
	let speaker: string | undefined
	let cur: Run = { kind: base, text: "", markers: [] }

	const kindNow = (): CueKind => (stack.length ? stack[stack.length - 1]!.kind : base)
	const flush = () => {
		if (cur.text.trim() || cur.markers.length) runs.push(cur)
		cur = { kind: kindNow(), text: "", markers: [], ...(speaker ? { speaker } : {}) }
	}
	const push = (frame: Frame) => {
		flush()
		stack.push(frame)
		cur = { kind: frame.kind, text: "", markers: [], ...(speaker ? { speaker } : {}) }
	}
	const pop = () => {
		flush()
		stack.pop()
		cur = { kind: kindNow(), text: "", markers: [], ...(speaker ? { speaker } : {}) }
	}
	const resetLine = () => {
		stack.length = 0
		base = "narration"
		flush()
	}

	/** `Name:` at i (optionally bold) — the matched cast name and the index after the colon, or null. */
	const nameAt = (i: number): { name: string; next: number } | null => {
		let at = i
		while (cs[at] === " " || cs[at] === "\t") at++
		let bold = 0
		if (startsWithAt(cs, at, "**")) {
			bold = 2
			at += 2
		} else if (startsWithAt(cs, at, "__")) {
			bold = 2
			at += 2
		}
		for (const name of cast) {
			const nc = Array.from(name)
			let ok = true
			for (let k = 0; k < nc.length; k++)
				if ((cs[at + k] ?? "").toLowerCase() !== nc[k]!.toLowerCase()) {
					ok = false
					break
				}
			if (!ok) continue
			let after = at + nc.length
			if (bold && (startsWith2(cs, after))) after += 2
			if (cs[after] !== ":") continue
			after++
			if (bold && startsWith2(cs, after)) after += 2
			// The colon must be followed by a space or the line's end: `Note:` inside a word is not a label.
			if (cs[after] !== undefined && cs[after] !== " " && cs[after] !== "\t" && cs[after] !== "\n") continue
			return { name, next: after }
		}
		return null
	}
	const startsWith2 = (a: readonly string[], i: number) =>
		(a[i] === "*" && a[i + 1] === "*") || (a[i] === "_" && a[i + 1] === "_")

	const lineHasMark = (from: number): boolean => {
		for (let i = from; i < cs.length && cs[i] !== "\n"; i++) {
			if (cs[i] === "*") return true
			for (const s of styles) if (startsWithAt(cs, i, s.open)) return true
		}
		return false
	}

	let atLineStart = true
	for (let i = 0; i < cs.length; i++) {
		const ch = cs[i]!

		if (ch === "\n") {
			// A blank line ends every open mark and the speaker switch.
			let j = i + 1
			while (j < cs.length && (cs[j] === " " || cs[j] === "\t")) j++
			if (cs[j] === "\n" || j >= cs.length) {
				resetLine()
				speaker = undefined
				cur = { kind: "narration", text: "", markers: [] }
				atLineStart = true
				continue
			}
			// A `Name:` line ends the previous line's marks too.
			if (cast.length && nameAt(i + 1)) {
				resetLine()
			} else cur.text += " "
			atLineStart = true
			continue
		}

		if (atLineStart && cast.length && !stack.length) {
			const hit = nameAt(i)
			if (hit) {
				flush()
				speaker = hit.name
				base = lineHasMark(hit.next) ? "narration" : "dialogue"
				cur = { kind: base, text: "", markers: [], speaker }
				i = hit.next - 1
				atLineStart = false
				continue
			}
		}
		if (ch !== " " && ch !== "\t") atLineStart = false

		// Lifted marker.
		if (ch === MARK_OPEN) {
			let j = i + 1
			let digits = ""
			while (j < cs.length && cs[j] !== MARK_CLOSE) digits += cs[j++]
			const marker = markers[Number(digits)]
			if (marker !== undefined) cur.markers.push(marker)
			i = j
			continue
		}

		if (skip.has(i)) continue
		const top = stack[stack.length - 1]

		// Inside a frame: look for its close.
		if (top?.kind === "dialogue") {
			if (startsWithAt(cs, i, top.style.close)) {
				const markLen = Array.from(top.style.close).length
				const next = cs[i + markLen]
				// ’ is also an apostrophe: inside a word it is not a close.
				const apostrophe =
					top.style.close === "’" && (isWordChar(next) || isSpace(cs[i - 1]) || i === 0)
				if (!apostrophe) {
					i += markLen - 1
					pop()
					continue
				}
			}
		} else if (top?.kind === "action") {
			if (i === top.end) {
				pop()
				continue
			}
			cur.text += ch
			continue
		} else if (top?.kind === "aside") {
			if (i === top.end) {
				pop()
				continue
			}
			cur.text += ch
			continue
		}

		// Openers (narration, or nested inside dialogue).
		if (!top) {
			let opened = false
			for (const style of styles) {
				if (!startsWithAt(cs, i, style.open)) continue
				// An opening ‘ is also an apostrophe-like mark: it must not sit inside a word.
				if (style.open === style.close && isWordChar(cs[i - 1]) && isWordChar(cs[i + 1])) continue
				i += Array.from(style.open).length - 1
				push({ kind: "dialogue", style })
				opened = true
				break
			}
			if (opened) continue
		}

		if (ch === "*" || ch === "_") {
			// Doubled marks are markdown bold/underline: the words only.
			if (cs[i + 1] === ch) {
				i++
				continue
			}
			const opens =
				!isSpace(cs[i + 1]) &&
				(ch === "*" ? true : !isWordChar(cs[i - 1]))
			if (opens) {
				let end = -1
				const stop = paragraphEnd(cs, i)
				for (let j = i + 1; j < stop; j++) {
					if (cs[j] !== ch) continue
					if (cs[j + 1] === ch) {
						j++
						continue
					}
					if (isSpace(cs[j - 1])) continue
					if (ch === "_" && isWordChar(cs[j + 1])) continue
					end = j
					break
				}
				if (end > 0) {
					// Inside an open quote, asterisks are emphasis the SPEAKER
					// gives their own words, never a separate action: "this *one*
					// too" is one dialogue cue (owner report, 2026-10-29). Only
					// outside a quote do they open an action cue.
					if (asterisks === "action" && top?.kind !== "dialogue") {
						push({ kind: "action", end })
					} else {
						skip.add(end)
					}
					continue
				}
			}
			// A stray mark with no partner is formatting noise.
			continue
		}

		if (ch === "(") {
			let depth = 0
			let end = -1
			const stop = paragraphEnd(cs, i)
			for (let j = i; j < stop; j++) {
				if (cs[j] === "(") depth++
				else if (cs[j] === ")" && --depth === 0) {
					end = j
					break
				}
			}
			push({ kind: "aside", end: end > 0 ? end : stop })
			continue
		}

		cur.text += ch
	}
	flush()
	return runs
}

// ── Finishing ───────────────────────────────────────────────────────────────

/** The `!` `?` `…` a cue's text ends on (closing marks and spaces looked past). */
export function emphasisOf(text: string): CueEmphasis | undefined {
	const t = text.replace(/[\s"'”’»」』)\]*_]+$/u, "")
	if (/(?:\.\.\.|…)$/.test(t)) return "…"
	const last = t.at(-1)
	return last === "!" || last === "?" ? last : undefined
}

const tidy = (s: string): string =>
	s
		.replace(/[ \t ]+/g, " ")
		.replace(/\s*\n\s*/g, " ")
		.replace(/\s+([,.;:!?…])/g, "$1")
		.trim()

function voicesOf(v: Partial<CueVoices> | null | undefined): CueVoices {
	const out: Record<string, CueVoice> = { ...DEFAULT_CUE_VOICES }
	for (const [kind, voice] of Object.entries(v ?? {}))
		if ((CUE_VOICES as readonly string[]).includes(voice as string) && kind in out)
			out[kind] = voice as CueVoice
	return out as CueVoices
}

/**
 * Cue a line. Pure: the same input always gives the same cues, in reading order.
 * Text with nothing to read (empty, only code, only markers) gives no cues.
 */
export function cueLines(input: CueLinesInput): Cue[] {
	const asterisks: AsteriskReading = (ASTERISK_READINGS as readonly string[]).includes(
		input.asterisks as string
	)
		? (input.asterisks as AsteriskReading)
		: "action"
	const styles = quoteStylesFor(input.quoteStyles, input.language)
	const voices = voicesOf(input.voices)
	const lineLabel = inflectionLabelOf(input.inflection)

	const source = typeof input.text === "string" ? input.text : ""
	const lifted = liftMarkers(flattenMarkdown(dropCode(source)), asterisks)
	const runs = scan(lifted.text, {
		styles,
		asterisks,
		cast: castNamesOf(input.cast),
		markers: lifted.markers
	})

	const cues: Cue[] = []
	let pending: string[] = []
	for (const run of runs) {
		const text = tidy(run.text)
		if (!SPEAKABLE.test(text)) {
			// No words: the markers it held ride on the next cue.
			pending.push(...run.markers)
			continue
		}
		const markers = [...pending, ...run.markers]
		pending = []
		const fromMarker = markers.map(markerInflection).find((l): l is NonNullable<typeof l> => l !== null)
		const inflection = fromMarker ?? lineLabel ?? undefined
		const emphasis = emphasisOf(text)
		cues.push({
			text,
			kind: run.kind,
			voice: voices[run.kind],
			...(run.speaker ? { speaker: run.speaker } : {}),
			...(inflection ? { inflection } : {}),
			...(markers.length ? { markers } : {}),
			...(emphasis ? { emphasis } : {})
		})
	}
	// Markers left after the last words belong to the last cue.
	if (pending.length && cues.length) {
		const last = cues[cues.length - 1]!
		const markers = [...(last.markers ?? []), ...pending]
		const fromMarker = markers.map(markerInflection).find((l): l is NonNullable<typeof l> => l !== null)
		cues[cues.length - 1] = {
			...last,
			markers,
			...(fromMarker && !(last.markers ?? []).some((m) => markerInflection(m)) ? { inflection: fromMarker } : {})
		}
	}
	return cues
}
