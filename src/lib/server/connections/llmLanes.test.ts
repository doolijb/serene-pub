import { afterEach, describe, expect, test } from "vitest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	CLOUD_LLM_LANE_WIDTH,
	defaultLlmLaneWidth,
	llmLaneHostOf,
	llmLaneWidthOf,
	setLlmLaneWidthOverrides
} from "./llmLanes"

afterEach(() => setLlmLaneWidthOverrides(new Map()))

const width = (c: Parameters<typeof llmLaneHostOf>[0]) => {
	const host = llmLaneHostOf(c)
	return llmLaneWidthOf(host, host.laneKey)
}

describe("llmLaneHostOf", () => {
	test("the key is the origin of the base URL", () => {
		expect(
			llmLaneHostOf({ baseUrl: "http://localhost:5001/v1/" }).laneKey
		).toBe("http://localhost:5001")
	})

	test("a cloud host matches by hostname whatever its path", () => {
		const host = llmLaneHostOf({
			baseUrl: "https://openrouter.ai/some/other/path"
		})
		expect(host).toEqual({
			laneKey: "https://openrouter.ai",
			managed: false,
			cloud: true
		})
		expect(width({ baseUrl: "https://api.anthropic.com" })).toBe(
			CLOUD_LLM_LANE_WIDTH
		)
		expect(width({ baseUrl: "https://API.OpenAI.com/v1/" })).toBe(
			CLOUD_LLM_LANE_WIDTH
		)
	})

	test("a managed KoboldCPP is managed, width 1, even with a cloud-looking base URL", () => {
		const host = llmLaneHostOf({
			type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
			baseUrl: "https://openrouter.ai/api/v1"
		})
		expect(host.managed).toBe(true)
		expect(host.cloud).toBe(false)
		expect(defaultLlmLaneWidth(host)).toBe(1)
	})

	test("an empty or unparseable base URL falls back to the connection's own key", () => {
		expect(llmLaneHostOf({ id: 7, name: "x", baseUrl: "" }).laneKey).toBe(
			"connection:7"
		)
		expect(llmLaneHostOf({ name: "x", baseUrl: "not a url" }).laneKey).toBe(
			"connection:x"
		)
		expect(width({ id: 7, baseUrl: null })).toBe(1)
	})

	test.each([
		"http://localhost:11434",
		"http://192.168.1.5:5001",
		"http://gpu-box.local:8080",
		"http://127.0.0.1:5000/v1/",
		"http://gpu-box:8080"
	])("%s is never cloud: width 1", (baseUrl) => {
		expect(llmLaneHostOf({ baseUrl }).cloud).toBe(false)
		expect(width({ baseUrl })).toBe(1)
	})

	test("same input, same answer", () => {
		const c = { id: 1, baseUrl: "https://api.groq.com/openai/v1/" }
		expect(llmLaneHostOf(c)).toEqual(llmLaneHostOf(c))
	})
})

describe("llmLaneWidthOf", () => {
	test("an override wins and is clamped 1-16", () => {
		const host = llmLaneHostOf({ baseUrl: "http://localhost:5001" })
		setLlmLaneWidthOverrides(new Map([["http://localhost:5001", 3]]))
		expect(llmLaneWidthOf(host, host.laneKey)).toBe(3)
		setLlmLaneWidthOverrides(new Map([["http://localhost:5001", 99]]))
		expect(llmLaneWidthOf(host, host.laneKey)).toBe(16)
		setLlmLaneWidthOverrides(new Map([["http://localhost:5001", 0]]))
		expect(llmLaneWidthOf(host, host.laneKey)).toBe(1)
	})

	test("no host: width 1", () => {
		expect(llmLaneWidthOf(undefined, "connection:a")).toBe(1)
	})
})
