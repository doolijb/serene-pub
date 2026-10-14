/**
 * 🚧 The **Sprite set fill**'s pure half (DESIGN-image-generation §6.3; I5):
 * which sprite labels a fill draws by default, how the *Sprite label phrases*
 * prompt row reads, and the image series one fill asks for.
 *
 * Pure — no database, no socket. `core:task/build-sprite-series@1`'s binding,
 * the form preview and the tests all call these, so the series a form prices
 * and the series a run draws cannot disagree.
 */

import type { ImageSeriesItemV1 } from "@serene-pub/sdk"
import { sanitiseSeriesKeys } from "$lib/server/imageGen/packing"
import { normalizeSpriteName, type SpriteSetView } from "$lib/shared/sprites"

/**
 * The *Sprite label phrases* field, read: one `label: phrase` per line. The
 * label is normalised as every sprite label is; a line with no colon, an
 * empty label or an empty phrase is skipped. A later line for the same label
 * wins, so a person appending an override need not find the shipped line.
 */
export function parseLabelPhrases(text: unknown): Map<string, string> {
	const out = new Map<string, string>()
	if (typeof text !== "string") return out
	for (const raw of text.split(/\r?\n/)) {
		const at = raw.indexOf(":")
		if (at <= 0) continue
		const label = normalizeSpriteName(raw.slice(0, at))
		const phrase = raw.slice(at + 1).trim()
		if (label && phrase) out.set(label, phrase)
	}
	return out
}

/** The sprite labels a fill keeps: normalised, blanks and repeats dropped, order kept. */
export function fillLabels(labels: unknown): string[] {
	const list = Array.isArray(labels) ? labels : []
	const seen = new Set<string>()
	const out: string[] = []
	for (const l of list) {
		const label = normalizeSpriteName(l)
		if (!label || seen.has(label)) continue
		seen.add(label)
		out.push(label)
	}
	return out
}

/**
 * One image series item per label (`core:task/build-sprite-series@1`).
 *
 * `key` is the label made filename-safe — the host's own rule
 * (`sanitiseSeriesKeys`), so the key the picture comes back under is the
 * key asked for. `vars.label` keeps the card's spelling, which is what
 * `attach-sprite` files under; `vars.labelPhrase` falls back to the label word.
 */
export function buildSpriteSeries(input: {
	labels: unknown
	phrases?: unknown
	likeness?: unknown
	likenessNegative?: unknown
}): { series: ImageSeriesItemV1[]; labels: string[] } {
	const labels = fillLabels(input.labels)
	const phrases = parseLabelPhrases(input.phrases)
	const keys = sanitiseSeriesKeys(labels)
	const likeness = typeof input.likeness === "string" ? input.likeness : ""
	const likenessNegative =
		typeof input.likenessNegative === "string" ? input.likenessNegative : ""
	const series = labels.map((label, i) => ({
		key: keys[i]!,
		vars: {
			label,
			labelPhrase: phrases.get(label) ?? label,
			likeness,
			likenessNegative
		}
	}))
	return { series, labels }
}

/**
 * The labels *Fill empty sprites* draws when the person picks none: every
 * label in the set with no picture yet (an **empty sprite**), in the set's
 * label order. A label with a picture AND an empty slot beside it is not
 * empty — it already has a face.
 */
export function emptySpriteLabels(set: Pick<SpriteSetView, "sprites"> | null | undefined): string[] {
	if (!set) return []
	const filled = new Set<string>()
	const all: string[] = []
	for (const s of set.sprites) {
		if (!all.includes(s.label)) all.push(s.label)
		if (s.media) filled.add(s.label)
	}
	return all.filter((l) => !filled.has(l)).sort((a, b) => a.localeCompare(b))
}

/** Every label in the set, alphabetical — what *Redo all* draws. */
export function allSpriteLabels(set: Pick<SpriteSetView, "sprites"> | null | undefined): string[] {
	if (!set) return []
	return [...new Set(set.sprites.map((s) => s.label))].sort((a, b) =>
		a.localeCompare(b)
	)
}
