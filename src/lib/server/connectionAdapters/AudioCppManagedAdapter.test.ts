import { describe, expect, it, vi } from "vitest"

// The adapter's module imports the settings store, which reaches the database.
vi.mock("$lib/server/audiocpp/settings", () => ({
	ensureAudioCppSettings: vi.fn()
}))

import { modelsFromPackages } from "./AudioCppManagedAdapter"

const tts = { id: "kitten", name: "Kitten", task: "tts", family: "kitten" }
const asr = { id: "whisper", name: "Whisper", task: "asr", family: "whisper" }

describe("modelsFromPackages — size as model facts", () => {
	it("a sized tts and asr package declare their size", () => {
		const rows = modelsFromPackages([
			{ ...tts, sizeBytes: 123 },
			{ ...asr, sizeBytes: 456 }
		] as never)
		expect(rows[0]).toEqual({
			id: "kitten",
			name: "Kitten",
			modality: "tts",
			family: "kitten",
			facts: { sizeBytes: 123, source: "file" }
		})
		expect(rows[1]).toMatchObject({
			modality: "asr",
			reads: ["audio"],
			writes: ["text"],
			facts: { sizeBytes: 456, source: "file" }
		})
	})
	it("an unsized, zero, NaN or null size declares nothing", () => {
		const rows = modelsFromPackages([
			tts,
			{ ...tts, sizeBytes: 0 },
			{ ...asr, sizeBytes: NaN },
			{ ...asr, sizeBytes: null }
		] as never)
		for (const row of rows) expect(row).not.toHaveProperty("facts")
	})
})
