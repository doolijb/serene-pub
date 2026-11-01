import { beforeEach, describe, expect, test, vi } from "vitest"

const invoke = vi.hoisted(() => vi.fn())
vi.mock("$lib/client/components/frames/pluginActions", () => ({ invokePluginAction: invoke }))

import { answerFilePick } from "./filePick"
import { answerFileSave } from "./fileSave"

const from = { owner: "worlds" }
const b64 = (s: string) => btoa(s)

function stubDownload() {
	const link: { href: string; download: string; style: { display: string }; click: () => void; remove: () => void } = {
		href: "",
		download: "",
		style: { display: "" },
		click: vi.fn(),
		remove: vi.fn()
	}
	const blobs: Blob[] = []
	vi.stubGlobal("URL", {
		createObjectURL: (b: Blob) => (blobs.push(b), "blob:x"),
		revokeObjectURL: vi.fn()
	})
	vi.stubGlobal("document", {
		createElement: () => link,
		body: { appendChild: vi.fn() }
	})
	return { link, blobs }
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.unstubAllGlobals()
})

describe("answerFileSave", () => {
	test("passes target to the handler with the suggestion", async () => {
		const { link } = stubDownload()
		invoke.mockResolvedValue("hello")
		await answerFileSave(
			{ name: "summer.zip", mime: "application/zip", source: "handler:world.export", target: "summer:zip" },
			from
		)
		expect(invoke).toHaveBeenCalledWith("worlds", "world.export", {
			name: "summer.zip",
			mime: "application/zip",
			target: "summer:zip"
		})
		expect(link.download).toBe("summer.zip")
	})

	test("no target is sent when the frame gave none", async () => {
		stubDownload()
		invoke.mockResolvedValue("hello")
		await answerFileSave({ name: "a.txt", mime: "text/plain", source: "handler:x" }, from)
		expect(invoke.mock.calls[0][2]).toEqual({ name: "a.txt", mime: "text/plain" })
	})

	test("the answer's name and mime replace the suggestion", async () => {
		const { link, blobs } = stubDownload()
		invoke.mockResolvedValue({ bytes: b64("zz"), name: "summer-v2.json", mime: "application/json" })
		await answerFileSave({ name: "a.bin", mime: "application/octet-stream", source: "handler:x" }, from)
		expect(link.download).toBe("summer-v2.json")
		expect(blobs[0].type).toBe("application/json")
	})

	test("a path in the answered name is stripped to its file name", async () => {
		const { link } = stubDownload()
		invoke.mockResolvedValue({ bytes: b64("zz"), name: "../../etc/pass\\wd.txt" })
		await answerFileSave({ name: "a.bin", mime: "text/plain", source: "handler:x" }, from)
		expect(link.download).toBe("wd.txt")
	})

	test("an empty or folder-only answered name falls back; long names are cut", async () => {
		const { link } = stubDownload()
		invoke.mockResolvedValue({ bytes: b64("zz"), name: "dir/" })
		await answerFileSave({ name: "a.bin", mime: "text/plain", source: "handler:x" }, from)
		expect(link.download).toBe("a.bin")
		invoke.mockResolvedValue({ bytes: b64("zz"), name: "n".repeat(500) })
		await answerFileSave({ name: "a.bin", mime: "text/plain", source: "handler:x" }, from)
		expect(link.download).toHaveLength(200)
	})

	test("an over-long target is refused before anything runs", async () => {
		await expect(
			answerFileSave(
				{ name: "a", mime: "text/plain", source: "handler:x", target: "t".repeat(513) },
				from
			)
		).rejects.toThrow(/512/)
		expect(invoke).not.toHaveBeenCalled()
	})
})

describe("answerFilePick", () => {
	test("an over-long target is refused before the picker opens", async () => {
		await expect(
			answerFilePick({ accept: [".png"], action: "world.image", target: "t".repeat(513) }, from)
		).rejects.toThrow(/512/)
		expect(invoke).not.toHaveBeenCalled()
	})

	test("target reaches the handler beside the file", async () => {
		const input: Record<string, any> = {
			style: {},
			files: [{ name: "p.png", type: "image/png" }],
			listeners: {} as Record<string, () => void>,
			addEventListener(ev: string, fn: () => void) {
				this.listeners[ev] = fn
			},
			click() {
				queueMicrotask(() => this.listeners.change())
			},
			remove: vi.fn()
		}
		vi.stubGlobal("navigator", {})
		vi.stubGlobal("document", { createElement: () => input, body: { appendChild: vi.fn() } })
		vi.stubGlobal(
			"FileReader",
			class {
				result = "data:image/png;base64,QUJD"
				onload: () => void = () => {}
				onerror: () => void = () => {}
				readAsDataURL() {
					queueMicrotask(() => this.onload())
				}
			}
		)
		invoke.mockResolvedValue(undefined)
		await answerFilePick({ accept: [".png"], action: "world.image", target: "summer/portrait" }, from)
		expect(invoke).toHaveBeenCalledWith("worlds", "world.image", {
			name: "p.png",
			mime: "image/png",
			bytes: "QUJD",
			target: "summer/portrait"
		})
	})
})
