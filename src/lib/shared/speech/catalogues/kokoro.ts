/**
 * 🚧 Kokoro 82M catalogue (Apache-2.0).
 *
 * Voice ids verified against hexgrad/Kokoro-82M VOICES.md (54 voices, 2026-10-28).
 * KoboldCPP's list of PERMITTED names (28 English ids) lives in its C++ and
 * could not be fetched from koboldcpp.py; the 28 below are the owner-supplied
 * list and equal the American + British rows of VOICES.md. KoboldCPP maps an
 * unknown voice name by hash to one of five defaults, so the real id matters.
 *
 * Per-service differences: KoboldCPP serves {@link KOKORO_KCPP_VOICE_IDS}, does
 * not stream; audio.cpp serves all 54 ({@link KOKORO_VOICE_IDS}) and can blend.
 * `factsFor(id)` returns the 28 by default; pass `{ full: true }` through
 * {@link kokoroFacts} for the full list.
 */

import type { SpeechFacts, SpeechVoice } from "$lib/shared/connectionAdapters/speechFacts"
import { CATALOGUE_AUDIO_FAMILY, audioFamilyOfName } from "./audioFamily"
import type { SpeechCatalogue } from "./types"

const LANGS: Record<string, string> = {
	a: "en-US",
	b: "en-GB",
	j: "ja",
	z: "zh",
	e: "es",
	f: "fr",
	h: "hi",
	i: "it",
	p: "pt-BR"
}

/** All 54 Kokoro v1.0 voice ids. */
export const KOKORO_VOICE_IDS: readonly string[] = [
	..."af_heart af_alloy af_aoede af_bella af_jessica af_kore af_nicole af_nova af_river af_sarah af_sky".split(" "),
	..."am_adam am_echo am_eric am_fenrir am_liam am_michael am_onyx am_puck am_santa".split(" "),
	..."bf_alice bf_emma bf_isabella bf_lily bm_daniel bm_fable bm_george bm_lewis".split(" "),
	..."jf_alpha jf_gongitsune jf_nezumi jf_tebukuro jm_kumo".split(" "),
	..."zf_xiaobei zf_xiaoni zf_xiaoxiao zf_xiaoyi zm_yunjian zm_yunxi zm_yunxia zm_yunyang".split(" "),
	..."ef_dora em_alex em_santa ff_siwis hf_alpha hf_beta hm_omega hm_psi".split(" "),
	..."if_sara im_nicola pf_dora pm_alex pm_santa".split(" ")
]

/** The 28 English ids KoboldCPP permits (a* and b*). */
export const KOKORO_KCPP_VOICE_IDS: readonly string[] =
	KOKORO_VOICE_IDS.filter((id) => id[0] === "a" || id[0] === "b")

function voiceOf(id: string): SpeechVoice {
	const [prefix, rest] = id.split("_")
	const name = rest.charAt(0).toUpperCase() + rest.slice(1)
	const voice: SpeechVoice = {
		id,
		name,
		language: LANGS[prefix[0]],
		kind: "preset"
	}
	const gender = prefix[1] === "f" ? "female" : prefix[1] === "m" ? "male" : undefined
	if (gender) voice.labels = { gender }
	return voice
}

/** Facts for Kokoro; `full: true` lists all 54 voices (audio.cpp), else the 28 KoboldCPP permits. */
export function kokoroFacts(opts?: { full?: boolean }): SpeechFacts {
	const ids = opts?.full ? KOKORO_VOICE_IDS : KOKORO_KCPP_VOICE_IDS
	return {
		voices: ids.map(voiceOf),
		voicesFrom: "catalogue",
		controls: { speed: { min: 0.5, max: 2 } },
		streams: false,
		formats: ["wav"],
		sampleRate: 24000
	}
}

export const kokoroCatalogue: SpeechCatalogue = {
	family: "kokoro",
	label: "Kokoro 82M",
	matches: (id) => audioFamilyOfName(id) === CATALOGUE_AUDIO_FAMILY.kokoro,
	factsFor: () => kokoroFacts()
}
