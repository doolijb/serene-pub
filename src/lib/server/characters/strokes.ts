/**
 * A card's strokes on the way into the `characters` row (DESIGN-card-strokes
 * §A.3).
 *
 * When a card has strokes they are its source, and `description` /
 * `personality` are the **compiled cache** — written here, on every save, as
 * `compileStrokes` joins them (every enabled stroke, keyword ones included), so
 * embeddings, search, side characters, macros, the attic and `embedTextHash`
 * keep reading four plain fields. A card with no strokes is the legacy shape:
 * its prose columns are the truth and nothing here touches them.
 *
 * Pure: no database, no socket. The caller owns the write.
 */

import {
	compileStrokes,
	validateStrokes,
	type Stroke
} from "@serene-pub/sdk"
import { STROKES_ENABLED } from "$lib/shared/characters/strokesFlag"

/** The fields this reads and may rewrite; anything else passes through. */
export interface StrokeCardFields {
	strokes?: Stroke[] | null
	description?: string | null
	personality?: string | null
}

/** A save refused because its strokes are malformed — the sentence is the person's. */
export class StrokesRefused extends Error {
	constructor(message: string) {
		super(message)
		this.name = "StrokesRefused"
	}
}

/** `strokes[3].slug` + "slug 'x' is…" → "Stroke 4: slug 'x' is…." */
function sentenceOf(path: string, message: string): string {
	const at = /^strokes\[(\d+)\]/.exec(path)
	const body = message.endsWith(".") ? message : `${message}.`
	if (at) return `Stroke ${Number(at[1]) + 1}: ${body}`
	return body.charAt(0).toUpperCase() + body.slice(1)
}

/**
 * The first reason these strokes cannot be saved, or `null`.
 *
 * `validateStrokes` (the SDK shape + `STROKE_LIMITS`), then the one check it
 * leaves to the host: a `regex` key that does not compile. Whether a pattern
 * that DOES compile is refused (too slow, say) is the run-time matcher's call.
 */
export function strokesRefusal(strokes: unknown): string | null {
	const findings = validateStrokes(strokes)
	if (findings.length) return sentenceOf(findings[0].path, findings[0].message)
	for (const [i, s] of (strokes as Stroke[]).entries()) {
		if (s.when.mode !== "keywords" || s.when.matchMode !== "regex") continue
		for (const [j, key] of s.when.keys.entries()) {
			try {
				new RegExp(key)
			} catch {
				return sentenceOf(
					`strokes[${i}].when.keys[${j}]`,
					`'${key}' is not a regular expression`
				)
			}
		}
	}
	return null
}

/**
 * Incoming character fields with the prose cache rewritten from the strokes.
 *
 * - `strokes` absent → returned unchanged (an update that leaves strokes alone).
 * - `strokes` empty → returned unchanged: the legacy shape, prose is the truth.
 * - `strokes` non-empty → validated (throws `StrokesRefused` with the first
 *   finding), then `description` = the description compile (`""` when none —
 *   the column is NOT NULL) and `personality` = the personality compile
 *   (`null` when none). Any prose the caller sent is overwritten: with strokes,
 *   the prose columns are derived, never edited.
 *
 * Strokes paused (`STROKES_ENABLED` off): a pass-through — any `strokes` sent
 * are dropped, the prose is what is stored, and `strokes` is written `[]`
 * whenever prose is, so no card keeps strokes the UI cannot show.
 */
export function applyStrokesToCard<T extends StrokeCardFields>(
	fields: T
): T & StrokeCardFields {
	if (!STROKES_ENABLED) {
		const { strokes: _dropped, ...rest } = fields
		const writesProse = "description" in fields || "personality" in fields
		return (writesProse ? { ...rest, strokes: [] } : rest) as T &
			StrokeCardFields
	}
	const strokes = fields.strokes
	if (strokes === undefined) return fields
	if (strokes === null) return { ...fields, strokes: [] }
	const refusal = strokesRefusal(strokes)
	if (refusal) throw new StrokesRefused(refusal)
	if (strokes.length === 0) return fields
	return {
		...fields,
		description: compileStrokes(strokes, "description") ?? "",
		personality: compileStrokes(strokes, "personality")
	}
}

/** What a stroke contributes to its compile — `Label: text`, or the bare text. */
export function strokeCompiledText(stroke: Stroke): string {
	const text = typeof stroke.text === "string" ? stroke.text.trim() : ""
	if (!text) return ""
	const label = typeof stroke.label === "string" ? stroke.label.trim() : ""
	return label ? `${label}: ${text}` : text
}
