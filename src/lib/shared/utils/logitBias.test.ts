import { describe, expect, test } from "vitest"
import { readLogitBiasValue as sdkReadLogitBiasValue } from "@serene-pub/sdk"
import {
	LOGIT_BIAS_MAX,
	LOGIT_BIAS_MIN,
	parseSillyTavernLogitBias,
	readLogitBiasText,
	readLogitBiasValue
} from "./logitBias"

describe("readLogitBiasText — SillyTavern's rules", () => {
	test("blank text is empty", () => {
		expect(readLogitBiasText("")).toEqual({ kind: "empty" })
		expect(readLogitBiasText("   \n")).toEqual({ kind: "empty" })
	})

	test("plain text is a word, trimmed, with one leading space", () => {
		expect(readLogitBiasText("hmm")).toEqual({ kind: "word", text: " hmm" })
		expect(readLogitBiasText("  Wait  ")).toEqual({
			kind: "word",
			text: " Wait"
		})
		expect(readLogitBiasText("hold on")).toEqual({
			kind: "word",
			text: " hold on"
		})
	})

	test("{text} is exact: the inside, verbatim", () => {
		expect(readLogitBiasText("{Hmm}")).toEqual({
			kind: "exact",
			text: "Hmm"
		})
		expect(readLogitBiasText("  { hmm} ")).toEqual({
			kind: "exact",
			text: " hmm"
		})
	})

	test("[ids] is a JSON list of token ids", () => {
		expect(readLogitBiasText("[1, 2, 3]")).toEqual({
			kind: "ids",
			ids: [1, 2, 3]
		})
		expect(readLogitBiasText("[0]")).toEqual({ kind: "ids", ids: [0] })
	})

	test("brackets or braces holding nothing usable are invalid, with a reason", () => {
		for (const text of [
			"[]",
			"[1.5]",
			"[-1]",
			"[a, b]",
			'["1"]',
			"[1, 2,]",
			"{}"
		]) {
			const reading = readLogitBiasText(text)
			expect(reading.kind, text).toBe("invalid")
			if (reading.kind === "invalid")
				expect(reading.reason).toMatch(/\.$/)
		}
	})

	test("text that only starts with a bracket or brace is a word", () => {
		expect(readLogitBiasText("[1] more")).toEqual({
			kind: "word",
			text: " [1] more"
		})
		expect(readLogitBiasText("{")).toEqual({ kind: "word", text: " {" })
		// Unclosed, so not ids — SillyTavern biases it as text too.
		expect(readLogitBiasText("[1, 2")).toEqual({
			kind: "word",
			text: " [1, 2"
		})
	})
})

describe("readLogitBiasValue — stored values", () => {
	test("is the SDK's reader, not a second copy", () => {
		expect(readLogitBiasValue).toBe(sdkReadLogitBiasValue)
	})

	test("rows come back clamped, in order", () => {
		expect(
			readLogitBiasValue([
				{ text: "hmm", value: -2 },
				{ text: "[5]", value: 500 }
			])
		).toEqual([
			{ text: "hmm", value: -2 },
			{ text: "[5]", value: LOGIT_BIAS_MAX }
		])
	})

	test("the legacy id → bias object becomes [id] rows", () => {
		expect(readLogitBiasValue({ "123": -100, "7": 4 })).toEqual([
			{ text: "[7]", value: 4 },
			{ text: "[123]", value: LOGIT_BIAS_MIN }
		])
		expect(readLogitBiasValue('{"123":-100}')).toEqual([
			{ text: "[123]", value: -100 }
		])
	})

	test("an unreadable value is null", () => {
		expect(readLogitBiasValue("{not json")).toBeNull()
		expect(readLogitBiasValue(12)).toBeNull()
	})
})

describe("parseSillyTavernLogitBias", () => {
	const rows = [
		{ id: "a", text: " bond", value: -50 },
		{ id: "b", text: "{shiver}", value: -100 },
		{ id: "c", text: "", value: 0 }
	]
	const expected = [
		{ text: " bond", value: -50 },
		{ text: "{shiver}", value: -100 }
	]

	test("a bias preset exported from the Logit Bias panel (a bare array)", () => {
		expect(parseSillyTavernLogitBias(JSON.stringify(rows))).toEqual({
			entries: expected
		})
	})

	test("a text completion preset's logit_bias", () => {
		expect(
			parseSillyTavernLogitBias(
				JSON.stringify({ temp: 0.7, logit_bias: rows })
			)
		).toEqual({ entries: expected })
	})

	test("chat completion bias presets: the selected one", () => {
		const json = JSON.stringify({
			bias_preset_selected: "Anti-bond",
			bias_presets: {
				"Default (none)": [],
				"Anti-bond": rows
			}
		})
		expect(parseSillyTavernLogitBias(json)).toEqual({
			entries: expected,
			biasPresetName: "Anti-bond"
		})
	})

	test("chat completion bias presets: the first, when none is selected", () => {
		const json = JSON.stringify({
			bias_presets: { First: [{ text: "x", value: 1 }], Second: rows }
		})
		expect(parseSillyTavernLogitBias(json)).toEqual({
			entries: [{ text: "x", value: 1 }],
			biasPresetName: "First"
		})
	})

	test("a selected preset with no entries says so by name", () => {
		const result = parseSillyTavernLogitBias(
			JSON.stringify({
				bias_preset_selected: "Default (none)",
				bias_presets: { "Default (none)": [], Other: rows }
			})
		)
		expect(result).toEqual({
			error: expect.stringContaining("Default (none)")
		})
	})

	test("a chat completion preset that only names its bias preset", () => {
		const result = parseSillyTavernLogitBias(
			JSON.stringify({
				temperature: 1,
				bias_preset_selected: "Anti-bond"
			})
		)
		expect(result).toEqual({ error: expect.stringContaining("Anti-bond") })
	})

	test("settings.json: the half main_api names is read first", () => {
		const settings = (main_api: string) =>
			JSON.stringify({
				main_api,
				oai_settings: {
					bias_preset_selected: "Anti-bond",
					bias_presets: { "Anti-bond": rows }
				},
				textgenerationwebui_settings: {
					logit_bias: [{ id: "z", text: "hmm", value: -2 }]
				}
			})
		expect(parseSillyTavernLogitBias(settings("openai"))).toEqual({
			entries: expected,
			biasPresetName: "Anti-bond"
		})
		expect(
			parseSillyTavernLogitBias(settings("textgenerationwebui"))
		).toEqual({ entries: [{ text: "hmm", value: -2 }] })
	})

	test("settings.json: an empty half falls through to the other", () => {
		const json = JSON.stringify({
			main_api: "textgenerationwebui",
			oai_settings: { bias_presets: { Mine: rows } },
			textgenerationwebui_settings: { logit_bias: [] }
		})
		expect(parseSillyTavernLogitBias(json)).toEqual({
			entries: expected,
			biasPresetName: "Mine"
		})
	})

	test("biases clamp; a byte-order mark is skipped", () => {
		expect(
			parseSillyTavernLogitBias(
				"﻿" + JSON.stringify([{ text: "x", value: -400 }])
			)
		).toEqual({ entries: [{ text: "x", value: LOGIT_BIAS_MIN }] })
	})

	test("garbage is an error, never a throw", () => {
		for (const input of [
			"not json",
			"",
			"42",
			"null",
			'"text"',
			"{}",
			"[]",
			"[1, 2]",
			'[{"text": "   ", "value": 1}]',
			'{"logit_bias": "nope"}',
			'{"bias_presets": {}}',
			'{"bias_presets": {"A": "nope"}}'
		]) {
			const result = parseSillyTavernLogitBias(input)
			expect(result, input).toEqual({ error: expect.any(String) })
		}
	})
})
