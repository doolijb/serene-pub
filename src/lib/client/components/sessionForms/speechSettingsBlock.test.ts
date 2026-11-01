import { describe, expect, it } from "vitest"
import { SPEECH_FIELD_KEYS, SPEECH_TEMPLATE_IDS } from "$lib/shared/sessions/speechSettings"
import {
	READ_ALOUD_LINES,
	SPEECH_SETTING_KEYS,
	TEMPLATE_LINES,
	isLanguageCode,
	splitSpeechFields
} from "./speechSettingsBlock"

const field = (key: string, kind = "genre") => ({ address: { kind, key } }) as never
const group = (id: string, fields: unknown[], kind = "genre") => ({ kind, id, heading: id, fields }) as never

describe("splitSpeechFields", () => {
	it("pulls every speech key out of the genre group, keeps the rest", () => {
		const groups = [
			group("genre", [
				field("speechReadAloud"),
				field("speechTemplate"),
				field("speechNarratorVoice"),
				field("sessionLanguage"),
				field("somethingElse")
			])
		]
		const { rest, speech } = splitSpeechFields(groups)
		expect(Object.keys(speech).sort()).toEqual(["language", "narratorVoice", "readAloud", "template"])
		expect(rest).toHaveLength(1)
		expect((rest[0] as { fields: { address: { key: string } }[] }).fields.map((f) => f.address.key)).toEqual([
			"somethingElse"
		])
	})
	it("a group left empty by the pull is dropped; an originally empty one stays", () => {
		const { rest } = splitSpeechFields([
			group("genre", [field("speechReadAloud")]),
			group("empty", [])
		])
		expect(rest.map((g) => g.id)).toEqual(["empty"])
	})
	it("a group with no speech field is passed through as the same object", () => {
		const g = group("genre", [field("x")])
		expect(splitSpeechFields([g]).rest[0]).toBe(g)
	})
	it("non-genre groups and non-genre addresses are untouched", () => {
		const reg = group("pipe", [field("speechReadAloud", "registration")], "registration")
		const out = splitSpeechFields([reg])
		expect(out.rest).toEqual([reg])
		expect(out.speech).toEqual({})
		const g2 = group("genre", [field("speechReadAloud", "registration")])
		expect(splitSpeechFields([g2]).speech).toEqual({})
	})
	it("a reserved narrateUser field, if ever present, is pulled too (drawn nowhere)", () => {
		const { rest, speech } = splitSpeechFields([group("genre", [field(SPEECH_FIELD_KEYS.narrateUser)])])
		expect(speech.narrateUser).toBeDefined()
		expect(rest).toEqual([])
	})
})

describe("block tables", () => {
	it("uses the shared key table and has a line for every mode and shipped template", () => {
		expect(SPEECH_SETTING_KEYS).toBe(SPEECH_FIELD_KEYS)
		expect(Object.keys(READ_ALOUD_LINES).sort()).toEqual(["make", "off", "play"])
		expect(Object.keys(TEMPLATE_LINES).sort()).toEqual(Object.values(SPEECH_TEMPLATE_IDS).sort())
	})
	it("isLanguageCode: two lowercase letters only", () => {
		expect(isLanguageCode("en")).toBe(true)
		for (const s of ["EN", "eng", "e", "", "e1"]) expect(isLanguageCode(s), s).toBe(false)
	})
})

import { readAloudChoices, readAloudLine } from "./speechSettingsBlock"

describe("Read aloud segmented control words", () => {
	const base = { address: { kind: "genre", key: SPEECH_FIELD_KEYS.readAloud } }
	it("falls back to Off, Make audio, Make and play in that order", () => {
		const c = readAloudChoices({ ...base, members: undefined } as any)
		expect(c.map((x) => x.label)).toEqual(["Off", "Make audio", "Make and play"])
	})
	it("orders a declaration's members the same way and keeps unknown ones last; its words win", () => {
		const c = readAloudChoices({
			...base,
			members: [
				{ key: "play", label: "Make and play", description: "custom play" },
				{ key: "zzz", label: "Zzz" },
				{ key: "off", label: "Off" }
			]
		} as any)
		expect(c.map((x) => x.key)).toEqual(["off", "play", "zzz"])
		expect(readAloudLine(c, "play")).toBe("custom play")
		expect(readAloudLine(c, "off")).toBe(READ_ALOUD_LINES.off.line)
		expect(readAloudLine(c, "nope")).toBeNull()
	})
})
