/**
 * Logit bias entries — the syntax one entry's text is read by, and the
 * "Import SillyTavern list" reader. Shared by the editor (per-row errors) and
 * the server (what each row resolves to before it is tokenized), so the two
 * can never disagree about what a row means.
 *
 * The value itself — `LogitBiasEntry`, its bounds, the tolerant reader of a
 * stored value and the declaration's default — is the SDK's (`sampling.ts`);
 * this file re-exports what the app reads, rather than keeping a second copy.
 *
 * The syntax is SillyTavern's (`getLogitBiasListResult`,
 * `public/scripts/logit-bias.js`), on purpose: a list imported from
 * SillyTavern has to bias the same tokens here as it did there. SillyTavern's
 * words stay at that boundary (NOMENCLATURE R5): its _bias preset_ is a named
 * list, which Serene Pub keeps as one sampling config's `logitBias` value.
 */

import {
	LOGIT_BIAS_MAX,
	LOGIT_BIAS_MIN,
	LOGIT_BIAS_OVERTHINKING_MARKERS,
	readLogitBiasValue,
	type LogitBiasEntry
} from "@serene-pub/sdk"

export {
	LOGIT_BIAS_MAX,
	LOGIT_BIAS_MIN,
	LOGIT_BIAS_OVERTHINKING_MARKERS,
	readLogitBiasValue
}
export type { LogitBiasEntry }

/**
 * What one logit bias entry's text asks for.
 *
 * - `empty` — nothing typed; the row is ignored.
 * - `word` — plain text, biased as it appears mid-sentence: `text` is the
 *   trimmed text with ONE leading space (`hmm` → `" hmm"`), which is what a
 *   tokenizer is handed.
 * - `exact` — `{text}`: what is between the braces, verbatim (`{ hmm}` →
 *   `" hmm"`, `{Hmm}` → `"Hmm"` with no space).
 * - `ids` — `[1, 2]`: token ids as they stand; no tokenizer is involved.
 * - `invalid` — brackets or braces that hold nothing usable; `reason` says
 *   what to write instead, for the row's error.
 *
 * Every token of a `word` or `exact` sequence, and every id, gets the row's
 * bias.
 */
export type LogitBiasReading =
	| { kind: "empty" }
	| { kind: "word"; text: string }
	| { kind: "exact"; text: string }
	| { kind: "ids"; ids: number[] }
	| { kind: "invalid"; reason: string }

/** The five ways a logit bias entry's text reads. */
export type LogitBiasTextKind = LogitBiasReading["kind"]

/**
 * Read one logit bias entry's text by SillyTavern's rules: trim it; `{…}` is
 * exact text, `[…]` is a JSON list of token ids, anything else is a word
 * tokenized with a leading space.
 *
 * Stricter than SillyTavern in two places, both of which it would send as
 * nothing: `{}` and `[]` are `invalid` rather than empty sequences, and a
 * token id must be a whole number of 0 or more.
 */
export function readLogitBiasText(text: string): LogitBiasReading {
	const trimmed = (text ?? "").trim()
	if (!trimmed) return { kind: "empty" }

	if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
		const inner = trimmed.slice(1, -1)
		return inner
			? { kind: "exact", text: inner }
			: {
					kind: "invalid",
					reason: "There is no text between the braces. Write it like {exact text}."
				}
	}

	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		let ids: unknown
		try {
			ids = JSON.parse(trimmed)
		} catch {
			ids = undefined
		}
		if (!Array.isArray(ids) || !ids.every(isTokenId))
			return {
				kind: "invalid",
				reason: "Token ids are whole numbers, 0 or more, like [1, 2, 3]."
			}
		if (!ids.length)
			return {
				kind: "invalid",
				reason: "There are no token ids between the brackets. Write them like [1, 2, 3]."
			}
		return { kind: "ids", ids }
	}

	return { kind: "word", text: ` ${trimmed}` }
}

function isTokenId(v: unknown): v is number {
	return typeof v === "number" && Number.isSafeInteger(v) && v >= 0
}

// ── Import SillyTavern list ─────────────────────────────────────────────────

/**
 * What "Import SillyTavern list" read from a file: its entries (never empty),
 * and the name of the SillyTavern bias preset they came from when the file
 * held several — or a sentence for the editor's inline status.
 */
export type SillyTavernLogitBiasImport =
	| { entries: LogitBiasEntry[]; biasPresetName?: string }
	| { error: string }

const NOT_SILLYTAVERN =
	"This file has no SillyTavern logit bias list. Choose a bias preset exported from SillyTavern's Logit Bias panel, a text completion preset, or SillyTavern's settings.json."

/**
 * Read the logit bias list out of a SillyTavern file:
 *
 * - a bias preset exported from the Logit Bias panel: a bare `[{ text, value }]`;
 * - a text completion preset: `{ logit_bias: [{ id, text, value }] }`;
 * - chat completion settings: `{ bias_presets: { <name>: [...] },
 *   bias_preset_selected }` — the selected preset, else the first;
 * - SillyTavern's whole `settings.json`, whose `oai_settings` carries the
 *   chat completion half and `textgenerationwebui_settings` the text
 *   completion half — the half its `main_api` names is read first.
 *
 * Rows whose text is blank are left out (SillyTavern's "new row" is one);
 * biases clamp to −100…100 as every stored value does.
 */
export function parseSillyTavernLogitBias(
	json: string
): SillyTavernLogitBiasImport {
	let root: unknown
	try {
		root = JSON.parse(String(json ?? "").replace(/^﻿/, ""))
	} catch {
		return {
			error: "This file isn't JSON. Choose a file exported from SillyTavern."
		}
	}

	const candidates = isRecord(root) ? settingsHalves(root) : [root]
	let firstError: string | null = null
	for (const candidate of candidates) {
		const found = listIn(candidate)
		if (!found) continue
		if ("error" in found) {
			firstError ??= found.error
			continue
		}
		return found
	}
	return { error: firstError ?? NOT_SILLYTAVERN }
}

/** A settings.json's two halves in the order its `main_api` suggests; anything else as itself. */
function settingsHalves(root: Record<string, unknown>): unknown[] {
	const chat = root.oai_settings
	const text = root.textgenerationwebui_settings
	if (!isRecord(chat) && !isRecord(text)) return [root]
	return root.main_api === "openai" ? [chat, text] : [text, chat]
}

/** One candidate's list: entries, a sentence why not, or `null` for "not here". */
function listIn(candidate: unknown): SillyTavernLogitBiasImport | null {
	if (Array.isArray(candidate)) return entriesOf(candidate)
	if (!isRecord(candidate)) return null

	if (Array.isArray(candidate.logit_bias))
		return entriesOf(candidate.logit_bias)

	const selected =
		typeof candidate.bias_preset_selected === "string"
			? candidate.bias_preset_selected
			: undefined
	const presets = candidate.bias_presets
	if (isRecord(presets)) {
		const names = Object.keys(presets)
		const name =
			selected !== undefined && names.includes(selected)
				? selected
				: names[0]
		if (name === undefined)
			return { error: "This file's SillyTavern bias presets are empty." }
		const rows = presets[name]
		if (!Array.isArray(rows)) return { error: NOT_SILLYTAVERN }
		const found = entriesOf(rows, name)
		return "error" in found
			? {
					error: `SillyTavern's bias preset “${name}” has no entries. Select another in SillyTavern, or export the one you want from its Logit Bias panel.`
				}
			: found
	}
	// A chat completion preset names its bias preset but does not carry it.
	if (selected !== undefined)
		return {
			error: `This preset only names its bias preset (“${selected}”). Export that one from SillyTavern's Logit Bias panel and import the file.`
		}
	return null
}

function entriesOf(
	rows: unknown[],
	biasPresetName?: string
): SillyTavernLogitBiasImport {
	const kept = rows.filter(
		(row): row is { text: string; value?: unknown } =>
			isRecord(row) && typeof row.text === "string" && !!row.text.trim()
	)
	// An array always reads; the SDK's reader clamps and coerces the biases.
	const entries =
		readLogitBiasValue(kept.map(({ text, value }) => ({ text, value }))) ??
		[]
	if (!entries.length) {
		return {
			error: rows.length
				? NOT_SILLYTAVERN
				: "This logit bias list is empty."
		}
	}
	return biasPresetName === undefined
		? { entries }
		: { entries, biasPresetName }
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object" && !Array.isArray(v)
}
