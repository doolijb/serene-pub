/**
 * Data fixtures for `resolveVoiceFrom` (not a test). Lane V runs them through
 * the pure core; `refusalOf` here is the voicebank refusal rules restated for fixtures only.
 */
import type { ResolvedVoice } from "../../shared/speech/voicebank"
import type { ResolveVoiceFacts, VoiceEntryFacts } from "./resolveVoiceCore"

const PAIR = 7
export const fixtureRefusalOf = (e: VoiceEntryFacts): string | null =>
	e.loadoutId == null
		? `The voice "${e.slug}" has no loadout.`
		: e.connectionModelId == null
			? `Its loadout has no model yet.`
			: null

const entry = (slug: string, over: Partial<VoiceEntryFacts> = {}): VoiceEntryFacts => ({
	slug,
	loadoutId: 1,
	connectionModelId: PAIR,
	voiceId: `v-${slug}`,
	language: null,
	settings: { speed: 1, stability: 0.5 },
	enabled: true,
	...over
})

const base: ResolveVoiceFacts = {
	pairModelId: PAIR,
	loadoutVoice: null,
	timbre: null,
	timbreEntry: null,
	sessionEntry: null,
	sessionNarratorVoice: null,
	refusalOf: fixtureRefusalOf
}
const f = (over: Partial<ResolveVoiceFacts>): ResolveVoiceFacts => ({ ...base, ...over })

export interface VoiceFixture {
	name: string
	facts: ResolveVoiceFacts
	expect: Partial<ResolvedVoice> | { ok: false }
}

export const voiceFixtures: VoiceFixture[] = [
	{ name: "no pair refuses", facts: f({ pairModelId: null }), expect: { ok: false } },
	{
		name: "timbre entry wins",
		facts: f({
			timbre: { voice: "bruno" },
			timbreEntry: { slug: "bruno", entry: entry("bruno") },
			sessionEntry: { slug: "nar", entry: entry("nar") },
			loadoutVoiceEntry: { slug: "dflt", entry: entry("dflt") },
			loadoutVoice: "lv"
		}),
		expect: { ok: true, from: "timbre", voiceId: "v-bruno", voicebankSlug: "bruno", connectionModelId: PAIR, skipped: [] }
	},
	{
		name: "session narrator voice",
		facts: f({ sessionEntry: { slug: "nar", entry: entry("nar") }, loadoutVoiceEntry: { slug: "dflt", entry: entry("dflt") } }),
		expect: { ok: true, from: "session", voiceId: "v-nar", voicebankSlug: "nar" }
	},
	{
		name: "loadout voice",
		facts: f({ loadoutVoiceEntry: { slug: "dflt", entry: entry("dflt") }, loadoutVoice: "lv" }),
		expect: { ok: true, from: "loadout-voice", voiceId: "v-dflt", voicebankSlug: "dflt" }
	},
	{
		name: "dialogue: envoy voice beats other-speakers, auto and session",
		facts: f({
			envoyEntry: { slug: "env", entry: entry("env") },
			otherSpeakersEntry: { slug: "os", entry: entry("os") },
			autoEntry: { slug: "au", entry: entry("au") },
			sessionEntry: { slug: "nar", entry: entry("nar") }
		}),
		expect: { ok: true, from: "envoy", voicebankSlug: "env" }
	},
	{
		name: "dialogue: other-speakers beats auto",
		facts: f({
			otherSpeakersEntry: { slug: "os", entry: entry("os") },
			autoEntry: { slug: "au", entry: entry("au") }
		}),
		expect: { ok: true, from: "other-speakers", voicebankSlug: "os" }
	},
	{
		name: "dialogue: auto beats the session narrator and loadout voice",
		facts: f({
			autoEntry: { slug: "au", entry: entry("au") },
			sessionEntry: { slug: "nar", entry: entry("nar") },
			loadoutVoiceEntry: { slug: "dflt", entry: entry("dflt") }
		}),
		expect: { ok: true, from: "auto", voicebankSlug: "au" }
	},
	{
		name: "dialogue: a disabled other-speakers pin is skipped, auto speaks",
		facts: f({
			otherSpeakersEntry: { slug: "os", entry: entry("os", { enabled: false }) },
			autoEntry: { slug: "au", entry: entry("au") }
		}),
		expect: { ok: true, from: "auto", skipped: [{ from: "other-speakers", slug: "os", reason: 'The voice "os" is turned off.' }] }
	},
	{
		name: "dialogue with no auto pick falls to the narrator chain (session first)",
		facts: f({
			autoEntry: null,
			sessionEntry: { slug: "nar", entry: entry("nar") },
			loadoutVoiceEntry: { slug: "dflt", entry: entry("dflt") }
		}),
		expect: { ok: true, from: "session", voicebankSlug: "nar" }
	},
	{
		name: "narrator chain: session beats loadout voice",
		facts: f({
			cueVoice: "narrator",
			hasSpeaker: false,
			sessionEntry: { slug: "nar", entry: entry("nar") },
			loadoutVoiceEntry: { slug: "dflt", entry: entry("dflt") },
			loadoutFirstEntry: { slug: "first", entry: entry("first") }
		}),
		expect: { ok: true, from: "session", voicebankSlug: "nar" }
	},
	{
		name: "narrator chain: loadout voice beats the loadout's first entry",
		facts: f({
			cueVoice: "narrator",
			hasSpeaker: false,
			loadoutVoiceEntry: { slug: "dflt", entry: entry("dflt") },
			loadoutFirstEntry: { slug: "first", entry: entry("first") }
		}),
		expect: { ok: true, from: "loadout-voice", voicebankSlug: "dflt" }
	},
	{
		name: "narrator chain: loadout voice off, the first entry speaks",
		facts: f({
			cueVoice: "narrator",
			hasSpeaker: false,
			loadoutVoiceEntry: { slug: "dflt", entry: entry("dflt", { enabled: false }) },
			loadoutFirstEntry: { slug: "first", entry: entry("first") }
		}),
		expect: { ok: true, from: "loadout-first", voicebankSlug: "first", skipped: [{ from: "loadout-voice", slug: "dflt", reason: 'The voice "dflt" is turned off.' }] }
	},
	{
		name: "narration in a line: card narration voice, then envoy narration, then the chain",
		facts: f({
			cueVoice: "narrator",
			hasSpeaker: true,
			timbreNarrationEntry: { slug: "cn", entry: entry("cn") },
			envoyNarrationEntry: { slug: "en", entry: entry("en") },
			loadoutVoiceEntry: { slug: "dflt", entry: entry("dflt") }
		}),
		expect: { ok: true, from: "narration-timbre", voicebankSlug: "cn" }
	},
	{
		name: "narration in a line: envoy narration voice kept",
		facts: f({
			cueVoice: "narrator",
			hasSpeaker: true,
			envoyNarrationEntry: { slug: "en", entry: entry("en") },
			loadoutVoiceEntry: { slug: "dflt", entry: entry("dflt") }
		}),
		expect: { ok: true, from: "envoy-narration", voicebankSlug: "en" }
	},
	{
		name: "narration in a line never takes other-speakers or auto",
		facts: f({
			cueVoice: "narrator",
			hasSpeaker: true,
			otherSpeakersEntry: { slug: "os", entry: entry("os") },
			autoEntry: { slug: "au", entry: entry("au") },
			loadoutVoiceEntry: { slug: "dflt", entry: entry("dflt") }
		}),
		expect: { ok: true, from: "loadout-voice", voicebankSlug: "dflt" }
	},
	{
		name: "description: dialogue takes the card's, else the entry's own",
		facts: f({
			timbre: { voice: "bruno", description: "card words" },
			timbreEntry: { slug: "bruno", entry: entry("bruno", { description: "entry words" }) }
		}),
		expect: { ok: true, from: "timbre", description: "card words" }
	},
	{
		name: "description: narration takes the entry's own, never the card's",
		facts: f({
			cueVoice: "narrator",
			hasSpeaker: true,
			timbre: { description: "card words" },
			loadoutVoiceEntry: { slug: "dflt", entry: entry("dflt", { description: "entry words" }) }
		}),
		expect: { ok: true, from: "loadout-voice", description: "entry words" }
	},
	{
		name: "loadout sampling voice",
		facts: f({ loadoutVoice: "lv", timbre: { settings: { speed: 1.2 }, description: "warm" } }),
		expect: { ok: true, from: "loadout", voiceId: "lv", voicebankSlug: null, settings: { speed: 1.2 }, description: "warm" }
	},
	{
		name: "service step uses the model's first voice",
		facts: f({ serviceVoice: "sv-first" }),
		expect: { ok: true, from: "service", voiceId: "sv-first", voicebankSlug: null, settings: {}, description: null }
	},
	{
		name: "service default",
		facts: f({}),
		expect: { ok: true, from: "service", voiceId: null, voicebankSlug: null, settings: {}, description: null }
	},
	{
		name: "skip: missing slug, falls to session",
		facts: f({
			timbre: { voice: "ghost" },
			timbreEntry: { slug: "ghost", entry: null },
			sessionEntry: { slug: "nar", entry: entry("nar") }
		}),
		expect: { ok: true, from: "session", skipped: [{ from: "timbre", slug: "ghost", reason: 'No voicebank voice is named "ghost".' }] }
	},
	{
		name: "skip: disabled, falls to loadout",
		facts: f({ timbreEntry: { slug: "off", entry: entry("off", { enabled: false }) }, loadoutVoice: "lv" }),
		expect: { ok: true, from: "loadout", skipped: [{ from: "timbre", slug: "off", reason: 'The voice "off" is turned off.' }] }
	},
	{
		name: "skip: unassigned entry, falls to loadout voice",
		facts: f({
			sessionEntry: { slug: "far", entry: entry("far", { loadoutId: null, connectionModelId: null }) },
			loadoutVoiceEntry: { slug: "dflt", entry: entry("dflt") }
		}),
		expect: { ok: true, from: "loadout-voice", skipped: [{ from: "session", slug: "far", reason: 'The voice "far" has no loadout.' }] }
	},
	{
		name: "timbre settings layer over entry settings",
		facts: f({
			timbre: { voice: "bruno", settings: { speed: 1.3, style: 0.9 } },
			timbreEntry: { slug: "bruno", entry: entry("bruno") }
		}),
		expect: { ok: true, settings: { speed: 1.3, stability: 0.5, style: 0.9 } }
	},
	{
		name: "language: cue wins",
		facts: f({ cueLanguage: "FR", text: "こんにちは", timbre: { language: "de" }, sessionLanguage: "es", pubLanguage: "en" }),
		expect: { ok: true, language: "fr", languageFrom: "cue" }
	},
	{
		name: "language: invalid cue skipped, script ja",
		facts: f({ cueLanguage: "english", text: "こんにちは、元気ですか", timbre: { language: "de" } }),
		expect: { ok: true, language: "ja", languageFrom: "script" }
	},
	{
		name: "language: timbre",
		facts: f({ text: "Hello there", timbre: { language: "de" }, sessionLanguage: "es", pubLanguage: "en" }),
		expect: { ok: true, language: "de", languageFrom: "timbre" }
	},
	{
		name: "language: session",
		facts: f({ text: "Hello there", sessionLanguage: "es", pubLanguage: "en" }),
		expect: { ok: true, language: "es", languageFrom: "session" }
	},
	{
		name: "language: pub",
		facts: f({ text: "Hello there", pubLanguage: "en" }),
		expect: { ok: true, language: "en", languageFrom: "pub" }
	},
	{
		name: "language: Latin never detected, none",
		facts: f({ text: "Bonjour, comment allez-vous" }),
		expect: { ok: true, language: null, languageFrom: null }
	}
]
