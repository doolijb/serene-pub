/**
 * 🚧 Sounds and moving pictures at the upload choke point (O4): recognised
 * only where the caller takes them, filed under the format table's mime.
 */
import { describe, expect, test } from "vitest"
import { sniffMedia } from "./sniff"

const wav = () => {
	const b = Buffer.alloc(44)
	b.write("RIFF", 0, "ascii")
	b.writeUInt32LE(36, 4)
	b.write("WAVE", 8, "ascii")
	b.write("fmt ", 12, "ascii")
	b.writeUInt32LE(16, 16)
	b.writeUInt16LE(1, 20)
	b.writeUInt16LE(1, 22)
	b.writeUInt32LE(16000, 24)
	b.writeUInt32LE(32000, 28)
	b.writeUInt16LE(2, 32)
	b.writeUInt16LE(16, 34)
	b.write("data", 36, "ascii")
	return b
}

describe("sniffMedia — audio", () => {
	test("a WAV is a sound, filed as audio/wav, where media is allowed", async () => {
		expect(await sniffMedia(wav(), { allowDocuments: true, allowMedia: true })).toEqual({
			ext: "wav",
			mime: "audio/wav",
			kind: "audio"
		})
	})

	test("refused where the caller takes no media — an avatar field is not handed a sound", async () => {
		await expect(sniffMedia(wav())).rejects.toThrow(/not a recognized image type/)
		await expect(sniffMedia(wav(), { allowDocuments: true })).rejects.toThrow(/Unrecognized file type/)
	})
})
