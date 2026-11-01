/**
 * familyOf - which audio family, task and variant a model is. Pure.
 *
 * Three ways in, tried in this order for the one input given:
 *
 *   { listedId }  a package id from audio.yaml. Answer straight from the
 *                 entry: confidence `listed`.
 *   { hf }        a Hugging Face repo (id, pipeline tag, tags, sibling file
 *                 names). `listed` when the repo is a listed entry's repo AND
 *                 a sibling is one of that entry's files; else the family rules.
 *   { file }      a file on disk (path, plus the GGUF header's architecture and
 *                 `audiocpp.model_spec.family` when read). `listed` when the
 *                 file name is exactly the leaf of a listed entry's file; else
 *                 the family rules.
 *
 * Confidence when the family rules decide (see `matchAudioFamily`):
 *   matched  a STRONG signal - the GGUF header names the family, or a repo/file
 *            regex plus a second independent signal (repo AND file, or a
 *            pipeline tag / hf tag that agrees)
 *   guessed  one weak signal alone: a file name, or a repo name, or nothing
 *            more than the name looks like it
 * `null` when nothing matches. A variant (and the vdes task of VoiceDesign)
 * comes from the family's `variants` rules, or from the listed entry.
 */

import {
	matchAudioFamily,
	type AudioFamily,
	type AudioSignals,
	type FamilyGuess
} from "$lib/shared/audio/audioFamilies"
import type { AudioListEntry } from "./audioList"

export type FamilyInput =
	| { listedId: string }
	| {
			hf: {
				repoId: string
				pipelineTag?: string
				tags?: string[]
				siblings?: string[]
			}
	  }
	| {
			file: {
				path: string
				ggufArchitecture?: string
				ggufName?: string
				/** `audiocpp.model_spec.family` read from the header. */
				ggufFamily?: string
			}
	  }

export interface FamilyLists {
	entries: readonly AudioListEntry[]
	families: readonly AudioFamily[]
}

const leaf = (p: string) => p.replace(/\\/g, "/").split("/").pop() ?? p
const lc = (s: string) => s.toLowerCase()

const listed = (e: AudioListEntry): FamilyGuess => ({
	task: e.task,
	family: e.family,
	...(e.variant ? { variant: e.variant } : {}),
	confidence: "listed"
})

export function familyOf(input: FamilyInput, lists: FamilyLists): FamilyGuess | null {
	if ("listedId" in input) {
		const e = lists.entries.find((x) => x.id === input.listedId)
		return e ? listed(e) : null
	}

	let signals: AudioSignals
	if ("hf" in input) {
		const { repoId, pipelineTag, tags, siblings } = input.hf
		const sib = (siblings ?? []).map((s) => lc(s))
		const hit = lists.entries.find(
			(e) =>
				lc(e.name) === lc(repoId) &&
				e.files.some((f) => sib.includes(lc(f)) || sib.includes(lc(leaf(f))))
		)
		if (hit) return listed(hit)
		signals = { repoId, pipelineTag, tags, files: siblings }
	} else if ("file" in input) {
		const { path, ggufArchitecture, ggufFamily } = input.file
		const name = lc(leaf(path))
		const hit = lists.entries.find((e) => e.files.some((f) => lc(leaf(f)) === name))
		if (hit) return listed(hit)
		signals = { files: [path], ggufArchitecture, ggufFamily }
	} else return null

	const m = matchAudioFamily(lists.families, signals)
	if (!m) return null
	return {
		task: m.task,
		family: m.family.family,
		...(m.variant ? { variant: m.variant } : {}),
		confidence: m.confidence
	}
}
