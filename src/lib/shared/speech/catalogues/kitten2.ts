/**
 * 🚧 KittenTTS 2 catalogue (Stellon Labs Community License).
 *
 * Source: github.com/KittenML/KittenTTS docs/voices-and-expression.md. The
 * model has 115 built-in voices; the doc lists 47 (38 named characters + 9
 * language voices), shipped here. The remaining 68 ids could not be verified
 * from a published list, so they are omitted - a Refresh against a service that
 * lists them (audio.cpp's /v1/audio/voices) supersedes this catalogue.
 *
 * Tags: ten leading emotion tags `[joyful]`. Kitten also has ten vocal events
 * (`<laugh>`) and `(((emphasis)))` - angle and paren syntaxes, outside the
 * `bracket` syntax of SpeechControls, so they are not advertised.
 *
 * Licence IV(a)(iii): "Powered by KittenML" must be displayed on a related UI;
 * the notice below carries it. (Distribution also needs the Notice text file;
 * that is a packaging matter, not this file's.)
 */

import type { SpeechFacts, SpeechVoice } from "$lib/shared/connectionAdapters/speechFacts"
import { CATALOGUE_AUDIO_FAMILY, audioFamilyOfName } from "./audioFamily"
import type { SpeechCatalogue } from "./types"

export const KITTEN2_EMOTION_TAGS = [
	"angry", "contemplative", "excited", "joyful", "mundane",
	"nervous", "sad", "stern", "surprised", "tender"
] as const

const NAMED: readonly [string, "female" | "male"][] = [
	["Bella", "female"], ["Jasper", "male"], ["Luna", "female"], ["Bruno", "male"],
	["Rosie", "female"], ["Hugo", "male"], ["Kiki", "female"], ["Leo", "male"],
	["Matthew", "male"], ["Elliot", "male"], ["Willow", "female"], ["Dolores", "female"],
	["Victor", "male"], ["Dante", "male"], ["Alfred", "male"], ["Saoirse", "female"],
	["Claire", "female"], ["Raven", "female"], ["Marcus", "male"], ["Herbert", "male"],
	["Diana", "female"], ["Laurence", "male"], ["Maeve", "female"], ["Walter", "male"],
	["Edith", "female"], ["Miles", "male"], ["Grace", "female"], ["Reginald", "male"],
	["Iris", "female"], ["Frank", "male"], ["Serena", "female"], ["Julian", "male"],
	["Eleanor", "female"], ["Otis", "male"], ["Vincent", "male"], ["Martha", "female"],
	["Sable", "female"], ["Victoria", "female"]
]

const LANGUAGE_VOICES: readonly [string, string][] = [
	["Arabic", "ar"], ["Chinese", "zh"], ["French", "fr"], ["German", "de"],
	["Hindi", "hi"], ["Italian", "it"], ["Portuguese", "pt"], ["Russian", "ru"],
	["Spanish", "es"]
]

export const KITTEN2_VOICES: readonly SpeechVoice[] = [
	...NAMED.map(([name, gender]) => ({
		id: name, name, language: "en", labels: { gender }, kind: "preset" as const
	})),
	...LANGUAGE_VOICES.map(([name, language]) => ({
		id: name, name, language, kind: "preset" as const
	}))
]

export const KITTEN2_NOTICE = "Powered by KittenML"

export const kitten2Catalogue: SpeechCatalogue = {
	family: "kitten-tts-2",
	label: "KittenTTS 2",
	// `kitten_tts2`, `kitten-tts-2`, `kittentts2`; never 0.8 (`kitten_tts`, `kitten-tts-mini-0.8`).
	// The guard keeps `kitten-tts-2.5` / `kitten-tts-20` out (the data regex has no
	// lookahead); a `.` only disqualifies when a digit follows, so `kitten_tts2.gguf` passes.
	matches: (id) =>
		audioFamilyOfName(id) === CATALOGUE_AUDIO_FAMILY["kitten-tts-2"] &&
		/kitten[-_ ]?tts[-_ ]?2(?![0-9]|\.[0-9])/i.test(id),
	factsFor(): SpeechFacts {
		return {
			voices: KITTEN2_VOICES.map((v) => ({ ...v })),
			voicesFrom: "catalogue",
			controls: { tags: { syntax: "bracket", vocabulary: KITTEN2_EMOTION_TAGS } },
			streams: false,
			formats: ["wav"],
			sampleRate: 24000,
			notice: KITTEN2_NOTICE
		}
	}
}
