import { describe, expect, test } from "vitest"
import { wizardStart } from "./wizardStart"

const chat = { modality: "text-gen" }
const embeddings = { modality: "embeddings" }

describe("wizardStart", () => {
	test("a non-admin starts on Get started, whatever exists", () => {
		expect(
			wizardStart({
				isAdmin: false,
				hasChatDefault: true,
				connections: [chat]
			})
		).toEqual({ step: "welcome", road: null })
	})

	test("an admin whose pub can reply starts on What to do", () => {
		expect(
			wizardStart({
				isAdmin: true,
				hasChatDefault: true,
				connections: [chat]
			})
		).toEqual({ step: "purpose", road: null })
	})

	test("an admin with a connection and no chat default resumes on the service road", () => {
		expect(
			wizardStart({
				isAdmin: true,
				hasChatDefault: false,
				connections: [chat]
			})
		).toEqual({ step: "llm", road: "service" })
	})

	test("a row that does not say its modality counts as text generation", () => {
		expect(
			wizardStart({
				isAdmin: true,
				hasChatDefault: false,
				connections: [{}]
			})
		).toEqual({ step: "llm", road: "service" })
	})

	test("an admin with nothing yet starts on Get started", () => {
		expect(
			wizardStart({
				isAdmin: true,
				hasChatDefault: false,
				connections: []
			})
		).toEqual({ step: "welcome", road: null })
	})

	test("an embeddings-only connection is not on the chat road", () => {
		expect(
			wizardStart({
				isAdmin: true,
				hasChatDefault: false,
				connections: [embeddings]
			})
		).toEqual({ step: "welcome", road: null })
	})
})
