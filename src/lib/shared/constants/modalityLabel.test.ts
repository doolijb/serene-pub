import { describe, expect, test } from "vitest"
import { modalityLabel } from "./ConnectionTypes"

describe("modalityLabel", () => {
	test("speech and transcription read as words, not raw ids", () => {
		expect(modalityLabel("tts")).toBe("speech")
		expect(modalityLabel("asr")).toBe("transcription")
		expect(modalityLabel("text-gen")).toBe("text generation")
		expect(modalityLabel("")).toBe("this modality")
	})
})
