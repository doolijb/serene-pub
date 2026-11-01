import { describe, expect, it } from "vitest"
import { wavDurationMs } from "$lib/server/connectionAdapters/speech/openAiSpeechDialect"
import { joinAudio, looksLikeWav, parseWav, silence, splitForLimit, writeWav, type WavFormat, speechBudgetMs, trimWav } from "./audio"

const F16: WavFormat = { audioFormat: 1, channels: 1, sampleRate: 1000, bitsPerSample: 16, blockAlign: 2 }
/** 1000 Hz mono 16-bit: 2 bytes per ms. */
const wav = (ms: number, format = F16, fill = 1) =>
	writeWav(format, Buffer.alloc((ms * format.sampleRate * format.blockAlign) / 1000, fill))
const part = (bytes: Buffer, mime = "audio/wav") => ({ bytes, mime })

describe("parseWav / writeWav", () => {
	it("round-trips a canonical WAV", () => {
		const w = wav(500)
		expect(looksLikeWav(w)).toBe(true)
		const p = parseWav(w)!
		expect(p.format).toEqual(F16)
		expect(p.durationMs).toBe(500)
		expect(p.data.length).toBe(1000)
	})
	it("reads a streamed header (size 0 or 0xffffffff) to the end of the buffer", () => {
		for (const size of [0, 0xffffffff]) {
			const w = Buffer.from(wav(250))
			w.writeUInt32LE(size, 40)
			expect(parseWav(w)!.durationMs).toBe(250)
		}
	})
	it("trims a partial trailing frame", () => {
		const w = Buffer.concat([wav(10), Buffer.from([1])])
		w.writeUInt32LE(0xffffffff, 40)
		expect(parseWav(w)!.data.length % 2).toBe(0)
	})
	it("refuses non-WAV, compressed and truncated input", () => {
		expect(parseWav(Buffer.from("ID3....not a wav at all"))).toBeNull()
		expect(parseWav(Buffer.alloc(0))).toBeNull()
		const comp = Buffer.from(wav(10))
		comp.writeUInt16LE(2, 20) // ADPCM
		expect(parseWav(comp)).toBeNull()
		expect(parseWav(wav(10).subarray(0, 30))).toBeNull()
	})
	it("silence is zero, or 0x80 for 8-bit PCM", () => {
		expect(silence(F16, 200).length).toBe(400)
		expect(silence(F16, 200).every((b) => b === 0)).toBe(true)
		const f8: WavFormat = { ...F16, bitsPerSample: 8, blockAlign: 1 }
		expect(silence(f8, 10).every((b) => b === 0x80)).toBe(true)
		expect(silence(F16, -5).length).toBe(0)
	})
})

describe("joinAudio", () => {
	it("no parts -> null", () => {
		expect(joinAudio([], [])).toBeNull()
	})
	it("one part of any format passes through untouched", () => {
		const mp3 = Buffer.from("ID3-bytes")
		const j = joinAudio([part(mp3, "audio/mpeg")], [])!
		expect(j.bytes).toBe(mp3)
		expect(j).toMatchObject({ mime: "audio/mpeg", durationMs: null, spans: [], source: "none" })
		const w = wav(300)
		expect(joinAudio([part(w)], [])).toMatchObject({
			durationMs: 300,
			spans: [{ startMs: 0, endMs: 300 }],
			source: "concatenated"
		})
	})
	it("joins same-format WAVs sample-exact with the gap before each later part", () => {
		const j = joinAudio([part(wav(100)), part(wav(300)), part(wav(50))], [0, 200, 200])!
		expect(j.source).toBe("concatenated")
		expect(j.mime).toBe("audio/wav")
		expect(j.spans).toEqual([
			{ startMs: 0, endMs: 100 },
			{ startMs: 300, endMs: 600 },
			{ startMs: 800, endMs: 850 }
		])
		expect(j.durationMs).toBe(850)
		expect(parseWav(j.bytes)!.durationMs).toBe(850)
	})
	it("ignores the first gap, treats a missing or negative gap as 0", () => {
		const j = joinAudio([part(wav(100)), part(wav(100)), part(wav(100))], [500, -5])!
		expect(j.spans.map((s) => s.startMs)).toEqual([0, 100, 200])
	})
	it("silence lies between, the audio itself intact", () => {
		const j = joinAudio([part(wav(10, F16, 7)), part(wav(10, F16, 9))], [0, 20])!
		const d = parseWav(j.bytes)!.data
		expect(d[0]).toBe(7)
		expect(d[d.length - 1]).toBe(9)
		expect(d[20]).toBe(0) // inside the 20 ms gap
	})
	it("mismatched WAV formats are converted to the first part's", () => {
		const other = { ...F16, sampleRate: 2000, blockAlign: 2 }
		const j = joinAudio([part(wav(10)), part(wav(10, other))], [0, 200])!
		expect(parseWav(j.bytes)!.format.sampleRate).toBe(1000)
		expect(j.resampled).toEqual({ parts: 1, toRate: 1000 })
	})
	it("a WAV beside a non-WAV, or non-MP3 non-WAV audio -> null", () => {
		expect(joinAudio([part(wav(10)), part(Buffer.from("xx"), "audio/mpeg")], [0, 200])).toBeNull()
		expect(
			joinAudio([part(Buffer.from("a"), "audio/ogg"), part(Buffer.from("b"), "audio/ogg")], [0, 200])
		).toBeNull()
	})
	it("all-MP3 byte-joins with no gap and an empty cue map", () => {
		const a = Buffer.from("AAA")
		const b = Buffer.from("BBB")
		const j = joinAudio([part(a, "audio/mpeg"), part(b, "audio/mp3")], [0, 200])!
		expect(j.bytes.toString()).toBe("AAABBB")
		expect(j).toMatchObject({ mime: "audio/mpeg", durationMs: null, spans: [], source: "none" })
	})
})

describe("splitForLimit", () => {
	it("returns [] for blank, one piece when it fits", () => {
		expect(splitForLimit("   ", 10)).toEqual([])
		expect(splitForLimit(" short ", 10)).toEqual(["short"])
		expect(splitForLimit("anything long", 0)).toEqual(["anything long"])
		expect(splitForLimit("anything long", Number.NaN)).toEqual(["anything long"])
	})
	it("splits at a sentence end when it can", () => {
		const text = "First sentence here. Second sentence here. Third one."
		const parts = splitForLimit(text, 30)
		expect(parts[0]).toBe("First sentence here.")
		expect(parts.every((p) => p.length <= 30 && p.length > 0)).toBe(true)
		expect(parts.join(" ")).toBe(text)
	})
	it("else at a space, else hard", () => {
		expect(splitForLimit("aaa bbb ccc ddd", 8)).toEqual(["aaa bbb", "ccc ddd"])
		expect(splitForLimit("x".repeat(25), 10)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)])
	})
	it("splits at the CJK sentence mark", () => {
		const parts = splitForLimit("これは文です。" + "あ".repeat(10) + "。", 12)
		expect(parts.every((p) => p.length <= 12)).toBe(true)
		expect(parts.join("")).toBe("これは文です。" + "あ".repeat(10) + "。")
	})
	it("Ollama's 4096 limit: long text is chunked under it and loses nothing", () => {
		const sentence = "This is a sentence of moderate length. "
		const text = sentence.repeat(300).trim()
		const parts = splitForLimit(text, 4096)
		expect(parts.length).toBeGreaterThan(2)
		expect(parts.every((p) => p.length <= 4096)).toBe(true)
		expect(parts.join(" ")).toBe(text)
	})
})

describe("wavDurationMs (dialect)", () => {
	it("reads a canonical WAV from its header and bytes", () => {
		expect(wavDurationMs(wav(500))).toBe(500)
	})
	it("a streamed 0xffffffff data size takes the actual byte count", () => {
		const w = Buffer.from(wav(400))
		w.writeUInt32LE(0xffffffff, 40)
		expect(wavDurationMs(w)).toBe(400)
	})
	it("non-WAV or too-short bytes -> undefined", () => {
		expect(wavDurationMs(Buffer.from("not a wav, though it is long enough to pass 44 bytes ok"))).toBeUndefined()
		expect(wavDurationMs(new Uint8Array(10))).toBeUndefined()
	})
})

describe("run-on guard (owner report 2026-10-29)", () => {
	it("speechBudgetMs grows with the words and is generous", () => {
		expect(speechBudgetMs("Or,")).toBe(5250)
		expect(speechBudgetMs("one two three four five six seven eight nine ten")).toBe(18750)
	})
	it("trimWav cuts a WAV past the budget and leaves one within it alone", () => {
		const format = { audioFormat: 1, channels: 1, sampleRate: 24000, bitsPerSample: 16, blockAlign: 2 }
		const tenSeconds = writeWav(format, Buffer.alloc(24000 * 2 * 10))
		const cut = trimWav(tenSeconds, 5250)!
		expect(cut.durationMs).toBe(5250)
		expect(parseWav(cut.bytes)!.durationMs).toBe(5250)
		expect(trimWav(writeWav(format, Buffer.alloc(24000 * 2)), 5250)).toBeNull()
	})
})

describe("joinAudio: parts in another format are converted to the first part's", () => {
	const mk = (rate: number, channels: number, bits: 16 | 32, audioFormat: 1 | 3, ms: number): Buffer => {
		const blockAlign = channels * (bits / 8)
		const format: WavFormat = { audioFormat, channels, sampleRate: rate, bitsPerSample: bits, blockAlign }
		return writeWav(format, Buffer.alloc((ms * rate * blockAlign) / 1000))
	}
	it("24 kHz + 22.05 kHz mono int16 -> one 24 kHz WAV, spans in ms", () => {
		const j = joinAudio([part(mk(24000, 1, 16, 1, 1000)), part(mk(22050, 1, 16, 1, 1000))], [0, 200])!
		const p = parseWav(j.bytes)!
		expect(p.format.sampleRate).toBe(24000)
		expect(j.resampled).toEqual({ parts: 1, toRate: 24000 })
		expect(j.spans[0]).toEqual({ startMs: 0, endMs: 1000 })
		expect(j.spans[1]!.startMs).toBe(1200)
		expect(Math.abs(j.spans[1]!.endMs - 2200)).toBeLessThanOrEqual(2)
		expect(Math.abs(p.durationMs - 2200)).toBeLessThanOrEqual(2)
	})
	it("stereo + mono", () => {
		const j = joinAudio([part(mk(24000, 2, 16, 1, 500)), part(mk(24000, 1, 16, 1, 500))], [0, 0])!
		const p = parseWav(j.bytes)!
		expect(p.format.channels).toBe(2)
		expect(p.durationMs).toBe(1000)
		expect(j.resampled?.parts).toBe(1)
	})
	it("float32 into int16", () => {
		const j = joinAudio([part(mk(24000, 1, 16, 1, 500)), part(mk(16000, 1, 32, 3, 500))], [0, 0])!
		expect(parseWav(j.bytes)!.format.bitsPerSample).toBe(16)
		expect(parseWav(j.bytes)!.durationMs).toBe(1000)
	})
	it("mixed containers still refuse", () => {
		expect(joinAudio([part(mk(24000, 1, 16, 1, 100)), part(Buffer.from("ID3x"), "audio/mpeg")], [0, 0])).toBeNull()
	})
})
