import { describe, expect, it } from "vitest"
import {
	SPEECH_FIELDS,
	SPEECH_FIELD_KEYS as CATALOG_KEYS,
	SPOKEN_LINE_TEMPLATE_IDS
} from "@serene-pub/core-catalog"
import {
	READ_ALOUD_MODES,
	SPEECH_FIELD_KEYS,
	SPEECH_TEMPLATE_IDS,
	SPEECH_AUTO_VOICE_PREFIX,
	speechAutoVoiceKey,
	readAutoVoice,
	readAllAutoVoices,
	SPEECH_ENVOY_FIELD_PREFIXES,
	parseSpeechEnvoyFieldKey,
	readAllEnvoySpeech,
	readEnvoySpeech,
	readSpeechSessionSettings,
	speechEnvoyFieldKey
} from "./speechSettings"

describe("readSpeechSessionSettings", () => {
	it("the empty document is the defaults", () => {
		expect(readSpeechSessionSettings({})).toEqual({
			readAloud: "off",
			template: null,
			narratorVoice: null,
			language: null
		})
		expect(readSpeechSessionSettings({}).template).toBeNull()
	})
	it("junk input never throws and reads as defaults", () => {
		for (const v of [null, undefined, 3, "x", []])
			expect(readSpeechSessionSettings(v).readAloud, String(v)).toBe("off")
	})
	it("read aloud: the three modes pass, anything else is off", () => {
		for (const m of READ_ALOUD_MODES)
			expect(readSpeechSessionSettings({ speechReadAloud: m }).readAloud).toBe(m)
		for (const m of ["loud", "", 1, true, null])
			expect(readSpeechSessionSettings({ speechReadAloud: m }).readAloud).toBe("off")
	})
	it("template: a known id passes; unknown or blank is null", () => {
		for (const id of Object.values(SPOKEN_LINE_TEMPLATE_IDS))
			expect(readSpeechSessionSettings({ speechTemplate: id }).template).toBe(id)
		for (const t of ["core:template/nope@1", "", "   ", 4, null])
			expect(readSpeechSessionSettings({ speechTemplate: t }).template, String(t)).toBeNull()
	})
	it("narrator voice is trimmed, blank is null; language is lower-cased", () => {
		expect(readSpeechSessionSettings({ speechNarratorVoice: " bruno " }).narratorVoice).toBe("bruno")
		expect(readSpeechSessionSettings({ speechNarratorVoice: "  " }).narratorVoice).toBeNull()
		expect(readSpeechSessionSettings({ sessionLanguage: " EN " }).language).toBe("en")
		expect(readSpeechSessionSettings({ sessionLanguage: "" }).language).toBeNull()
	})
})

describe("the key table agrees everywhere", () => {
	it("the app's SPEECH_FIELD_KEYS equals the SDK's", () => {
		expect(SPEECH_FIELD_KEYS).toEqual({ ...CATALOG_KEYS })
	})
	it("the app's template literals equal SPOKEN_LINE_TEMPLATE_IDS", () => {
		expect({ ...SPEECH_TEMPLATE_IDS }).toEqual({ ...SPOKEN_LINE_TEMPLATE_IDS })
	})
	it("the declared fields are exactly the key table minus the reserved narrateUser", () => {
		expect(Object.keys(SPEECH_FIELDS).sort()).toEqual(
			Object.values(SPEECH_FIELD_KEYS)
				.filter((k) => k !== SPEECH_FIELD_KEYS.narrateUser)
				.sort()
		)
		expect(SPEECH_FIELD_KEYS.narrateUser).toBe("speechNarrateUser")
		expect(SPEECH_FIELDS[SPEECH_FIELD_KEYS.narrateUser]).toBeUndefined()
	})
	it("the declared enum members equal the app's read-aloud modes and template ids", () => {
		expect(SPEECH_FIELDS[SPEECH_FIELD_KEYS.readAloud]!.of).toEqual([...READ_ALOUD_MODES])
		expect(SPEECH_FIELDS[SPEECH_FIELD_KEYS.template]!.of).toEqual(Object.values(SPEECH_TEMPLATE_IDS))
	})
	it("read aloud defaults off in the declaration too", () => {
		expect(SPEECH_FIELDS[SPEECH_FIELD_KEYS.readAloud]!.default).toBe("off")
	})
})

describe("envoy voices family", () => {
	it("keys are prefix + slug, and parse back (slugs may hold ':' and '.')", () => {
		expect(speechEnvoyFieldKey("voice", "mascot")).toBe("speechEnvoyVoice:mascot")
		expect(speechEnvoyFieldKey("narrationVoice", "acme.master")).toBe("speechEnvoyNarrationVoice:acme.master")
		for (const kind of Object.keys(SPEECH_ENVOY_FIELD_PREFIXES) as (keyof typeof SPEECH_ENVOY_FIELD_PREFIXES)[])
			expect(parseSpeechEnvoyFieldKey(speechEnvoyFieldKey(kind, "a:b"))).toEqual({ kind, envoySlug: "a:b" })
	})
	it("parse refuses other keys and empty slugs", () => {
		expect(parseSpeechEnvoyFieldKey("speechNarratorVoice")).toBeNull()
		expect(parseSpeechEnvoyFieldKey("speechEnvoyVoice:")).toBeNull()
		expect(parseSpeechEnvoyFieldKey("")).toBeNull()
	})
	it("readEnvoySpeech: all-null on junk; blanks read as null; values as stored", () => {
		for (const v of [null, undefined, 3, "x", []])
			expect(readEnvoySpeech(v, "m")).toEqual({ voice: null, narrationVoice: null })
		expect(
			readEnvoySpeech({ "speechEnvoyVoice:m": "v", "speechEnvoyDescription:m": "stored prose is ignored", "speechEnvoyNarrationVoice:m": "n", "speechEnvoyVoice:other": "z" }, "m")
		).toMatchObject({ voice: "v", narrationVoice: "n" })
		expect(readEnvoySpeech({ "speechEnvoyDescription:m": "x" }, "m")).toEqual({ voice: null, narrationVoice: null })
	})
	it("readAllEnvoySpeech lists every envoy with any key of the family", () => {
		const all = readAllEnvoySpeech({ "speechEnvoyVoice:a": "v", "speechEnvoyNarrationVoice:b": "p", speechNarratorVoice: "x", unrelated: 1 })
		expect(Object.keys(all).sort()).toEqual(["a", "b"])
		expect(all.a!.voice).toBe("v")
		expect(all.b!.narrationVoice).toBe("p")
		expect(readAllEnvoySpeech(null)).toEqual({})
	})
	it("the auto voice pick family: prefix + ref, blanks null, refs may hold ':'", () => {
		expect(SPEECH_AUTO_VOICE_PREFIX).toBe("speechAutoVoice:")
		expect(speechAutoVoiceKey("character:7")).toBe("speechAutoVoice:character:7")
		expect(readAutoVoice({ "speechAutoVoice:character:7": " mira " }, "character:7")).toBe("mira")
		expect(readAutoVoice({ "speechAutoVoice:character:7": " " }, "character:7")).toBeNull()
		expect(readAutoVoice(null, "x")).toBeNull()
		expect(readAllAutoVoices({ "speechAutoVoice:envoy:a": "v", "speechAutoVoice:": "z", speechNarratorVoice: "n" })).toEqual({ "envoy:a": "v" })
	})
})
