/**
 * 🚧 Hearing audio for a run (O9): the resolution, the access-checked read,
 * the adapter call and the cache on the file — with every seam stubbed, so
 * no provider is called and no database is opened.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

const target = vi.fn()
const getAdapter = vi.fn()
const resolveAttachments = vi.fn()
vi.mock("$lib/server/connections/capabilityTarget", () => ({
	resolveCapabilityTarget: (...a: unknown[]) => target(...a)
}))
vi.mock("$lib/server/utils/getTranscriptionAdapter", () => ({
	getTranscriptionAdapter: (...a: unknown[]) => getAdapter(...a)
}))
vi.mock("$lib/server/pipelines/runtime/dispatch", () => ({
	resolveAttachments: (...a: unknown[]) => resolveAttachments(...a)
}))
vi.mock("$lib/server/db/schema", () => ({ files: { uuid: "files.uuid" } }))
vi.mock("drizzle-orm", () => ({ eq: (a: unknown, b: unknown) => ({ eq: [a, b] }) }))

const { transcribeFiles } = await import("./transcribe")

/** A db that records the cache writes. */
function fakeDb() {
	const writes: Array<{ set: unknown; where: unknown }> = []
	return {
		writes,
		update: () => ({
			set: (set: unknown) => ({
				where: async (where: unknown) => {
					writes.push({ set, where })
				}
			})
		})
	}
}

const heard = vi.fn()
beforeEach(() => {
	target.mockReset()
	getAdapter.mockReset()
	resolveAttachments.mockReset()
	heard.mockReset()
	getAdapter.mockResolvedValue({
		Adapter: class {
			transcribeAudio = heard
		}
	})
	resolveAttachments.mockImplementation(async (_db: unknown, [uuid]: string[]) => [
		{ bytes: Buffer.from(`bytes of ${uuid}`), mime: "audio/ogg", filename: `${uuid}.ogg` }
	])
})

describe("transcribeFiles", () => {
	test("hears each file on the Transcription default, caches the words, and says so", async () => {
		target.mockResolvedValue({ ok: true, connection: { type: "openai" } })
		heard.mockResolvedValueOnce({ text: " meet at noon ", isAborted: false })
		const db = fakeDb()
		const out = await transcribeFiles(db as any, {
			files: [{ uuid: "a-1" }],
			language: "en",
			sessionId: 7,
			userId: 3
		})
		expect(target.mock.calls[0]![1]).toMatchObject({ capability: "audio->text", pipelineConfig: null })
		expect(resolveAttachments.mock.calls[0]![2]).toEqual({ sessionId: 7, userId: 3 })
		expect(heard.mock.calls[0]![0]).toEqual({
			audio: { bytes: Buffer.from("bytes of a-1"), mime: "audio/ogg", filename: "a-1.ogg" },
			language: "en"
		})
		expect(out.transcripts).toEqual({ "a-1": "meet at noon" })
		expect(db.writes).toEqual([{ set: { transcript: "meet at noon" }, where: { eq: ["files.uuid", "a-1"] } }])
		expect(out.notes).toEqual(["1 audio file was transcribed, so the reply reads what it says."])
	})

	test("the step's own pick is the pair asked for", async () => {
		target.mockResolvedValue({ ok: true, connection: { type: "openai" } })
		heard.mockResolvedValue({ text: "x", isAborted: false })
		await transcribeFiles(fakeDb() as any, { files: [{ uuid: "a" }], connectionId: 4, connectionModelId: 9 })
		expect(target.mock.calls[0]![1]).toMatchObject({
			pipelineConfig: { connectionId: 4, connectionModelId: 9 }
		})
	})

	test("no model set up to hear: nothing sent, the files pass through, the receipt says why", async () => {
		target.mockResolvedValue({ ok: false, problem: { message: "Nothing is set for Transcription." } })
		const out = await transcribeFiles(fakeDb() as any, { files: [{ uuid: "a" }, { uuid: "b" }] })
		expect(heard).not.toHaveBeenCalled()
		expect(out.transcripts).toEqual({})
		expect(out.notes[0]).toMatch(/^2 audio files the reply cannot hear were sent as names: no model is set up to hear audio/)
		expect(out.notes[0]).toMatch(/Fill the Transcription loadout/)
	})

	test("a type with no transcription module says so; a failed file is counted, never thrown", async () => {
		target.mockResolvedValue({ ok: true, connection: { type: "anthropic" } })
		getAdapter.mockResolvedValueOnce(null)
		const none = await transcribeFiles(fakeDb() as any, { files: [{ uuid: "a" }] })
		expect(none.notes[0]).toMatch(/cannot transcribe audio/)

		heard.mockRejectedValueOnce(new Error("503")).mockResolvedValueOnce({ text: "ok", isAborted: false })
		const mixed = await transcribeFiles(fakeDb() as any, { files: [{ uuid: "a" }, { uuid: "b" }] })
		expect(mixed.transcripts).toEqual({ b: "ok" })
		expect(mixed.notes).toEqual([
			"1 audio file was transcribed, so the reply reads what it says.",
			"1 audio file could not be transcribed and is sent as its name."
		])
	})
})
