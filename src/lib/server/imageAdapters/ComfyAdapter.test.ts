/**
 * ComfyUI's transport, against a fake server: upload, submit, follow the
 * socket, key the outputs by node, fall back to the history, interrupt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ComfyExports, { __setComfySocketFactory, describePromptRefusal, type ComfySocket } from "./ComfyAdapter"
import { STARTER_WORKFLOWS } from "$lib/server/imageGen/comfy/starters"
import type { ImageWorkflowDocument } from "$lib/shared/imageGen/types"
import type { RenderedSeriesItem } from "$lib/server/imageGen/packing"

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

const starter = (k: string): ImageWorkflowDocument => {
	const s = STARTER_WORKFLOWS.find((x) => x.seedKey === k)!
	return { id: 7, name: s.name, dialect: "comfyui", document: s.document, variables: s.variables, outputNode: s.outputNode }
}

class FakeSocket implements ComfySocket {
	binaryType = "blob"
	listeners: Record<string, Array<(ev: any) => void>> = {}
	closed = false
	addEventListener(type: string, l: (ev: any) => void) {
		;(this.listeners[type] ??= []).push(l)
	}
	close() {
		this.closed = true
	}
	emit(type: string, ev: any) {
		for (const l of this.listeners[type] ?? []) l(ev)
	}
	send(msg: unknown) {
		this.emit("message", { data: typeof msg === "string" ? msg : JSON.stringify(msg) })
	}
}

let socket: FakeSocket
let calls: Array<{ url: string; init?: RequestInit }>
let submitted: any
/** What the fake server does after `POST /prompt`. */
let afterSubmit: (promptId: string) => void
let history: Record<string, unknown> = {}
let viewHas = new Set<string>()

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

beforeEach(() => {
	calls = []
	submitted = null
	history = {}
	viewHas = new Set()
	afterSubmit = () => {}
	__setComfySocketFactory(() => {
		socket = new FakeSocket()
		queueMicrotask(() => socket.emit("open", {}))
		return socket
	})
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({ url, init })
			const u = new URL(url)
			if (u.pathname === "/prompt") {
				submitted = JSON.parse(String(init!.body))
				const bad = Object.values(submitted.prompt).some((n: any) => n.class_type === "Nope")
				if (bad)
					return json(
						{
							error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation", details: "" },
							node_errors: { "4": { class_type: "CheckpointLoaderSimple", errors: [{ message: "Value not in list", details: "ckpt_name: 'x' not in []" }] } }
						},
						400
					)
				setTimeout(() => afterSubmit("p-1"), 0)
				return json({ prompt_id: "p-1", number: 1, node_errors: {} })
			}
			if (u.pathname === "/view") {
				const name = u.searchParams.get("filename")!
				if (u.searchParams.get("type") === "input")
					return new Response("", { status: viewHas.has(name) ? 200 : 404 })
				return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } })
			}
			if (u.pathname === "/upload/image") return json({ name: "uploaded.png", subfolder: "", type: "input" })
			if (u.pathname.startsWith("/history/")) return json(history)
			if (u.pathname === "/interrupt") return json({})
			return new Response("not found", { status: 404 })
		})
	)
})

afterEach(() => {
	vi.unstubAllGlobals()
	__setComfySocketFactory(null)
})

const adapter = () =>
	new ComfyExports.Adapter({ id: 1, type: "comfyui", baseUrl: "http://comfy:8188/", extraJson: {}, model: "sd_xl_base_1.0.safetensors" } as any)

describe("ComfyAdapter.generateImage", () => {
	it("refuses with no workflow", async () => {
		await expect(adapter().generateImage({ prompt: "x" })).rejects.toThrow(/Choose a workflow/)
	})

	it("submits the rendered graph, maps progress and previews, and keys outputs by the marked node", async () => {
		const wf = starter("workflow-comfyui-sdxl-txt2img")
		const progress: any[] = []
		afterSubmit = (id) => {
			socket.send({ type: "executing", data: { node: "4", prompt_id: id } })
			socket.send({ type: "progress", data: { value: 5, max: 20, prompt_id: id, node: "3" } })
			const frame = Buffer.concat([Buffer.from([0, 0, 0, 1, 0, 0, 0, 2]), PNG])
			socket.emit("message", { data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) })
			socket.send({ type: "executed", data: { node: wf.outputNode, prompt_id: id, output: { images: [{ filename: "a.png", subfolder: "serene", type: "output" }] } } })
			socket.send({ type: "executing", data: { node: null, prompt_id: id } })
		}
		const res = await adapter().generateImage(
			{ prompt: 'a "knight"', negativePrompt: "blurry", steps: 12, width: 768, height: 512, seed: 5, clipSkip: 2 },
			{ workflow: wf, runId: "run-9", onProgress: (p) => progress.push(p) }
		)
		const graph = submitted.prompt
		expect(submitted.client_id).toBeTruthy()
		const sampler = Object.values(graph).find((n: any) => n.class_type === "KSampler") as any
		expect(sampler.inputs).toMatchObject({ steps: 12, seed: 5 })
		expect(graph["6"].inputs.text).toBe('a "knight"')
		expect(graph["4"].inputs.ckpt_name).toBe("sd_xl_base_1.0.safetensors")
		expect(graph[wf.outputNode!].inputs.filename_prefix).toBe("serene/run-9/1")
		expect(res.media).toHaveLength(1)
		expect(res.media[0]).toMatchObject({ kind: "image", mime: "image/png", base64: PNG.toString("base64") })
		expect(res.media[0]!.key).toBeUndefined()
		expect(res.applied).toEqual(expect.arrayContaining(["prompt", "negativePrompt", "steps", "width", "height", "seed", "model"]))
		expect(res.ignored).toContain("clipSkip")
		expect(progress.map((p) => p.stage)).toEqual(expect.arrayContaining(["queued", "loading", "sampling", "saving"]))
		expect(progress.find((p) => p.step === 5)).toMatchObject({ steps: 20, percent: 25 })
		expect(progress.find((p) => p.preview)?.preview.mime).toBe("image/png")
		expect(socket.closed).toBe(true)
	})

	it("merges a series into one prompt and keys each picture by its node prefix", async () => {
		const wf = starter("workflow-comfyui-sdxl-txt2img")
		afterSubmit = (id) => {
			for (const key of ["joy", "anger"])
				socket.send({ type: "executed", data: { node: `${key}:${wf.outputNode}`, prompt_id: id, output: { images: [{ filename: `${key}.png`, type: "output" }] } } })
			socket.send({ type: "executed", data: { node: "joy:99", prompt_id: id, output: { images: [{ filename: "temp.png", type: "temp" }] } } })
			socket.send({ type: "execution_success", data: { prompt_id: id } })
		}
		const res = await adapter().generateImage(
			{ prompt: "smiling", batch: 2 },
			{
				workflow: wf,
				series: [
					{ key: "joy", prompt: "smiling" },
					{ key: "anger", prompt: "scowling" }
				]
			}
		)
		const ids = Object.keys(submitted.prompt)
		expect(ids.filter((i) => submitted.prompt[i].class_type === "CheckpointLoaderSimple")).toHaveLength(1)
		expect(ids.filter((i) => submitted.prompt[i].class_type === "SaveImage").sort()).toEqual([`anger:${wf.outputNode}`, `joy:${wf.outputNode}`])
		expect(res.media.map((m) => m.key).sort()).toEqual(["anger", "joy"])
		expect(res.ignored).not.toContain("batch")
	})

	it("falls back to the history when the socket saw no outputs", async () => {
		const wf = starter("workflow-comfyui-sd15-txt2img")
		afterSubmit = (id) => {
			history = { [id]: { status: { completed: true, status_str: "success" }, outputs: { [wf.outputNode!]: { images: [{ filename: "h.png", type: "output" }] }, "77": { images: [{ filename: "x.png", type: "temp" }] } } } }
			socket.send({ type: "executing", data: { node: null, prompt_id: id } })
		}
		const res = await adapter().generateImage({ prompt: "p" }, { workflow: wf })
		expect(res.media).toHaveLength(1)
		expect(calls.some((c) => c.url.includes("/history/p-1"))).toBe(true)
	})

	it("uploads a reference once, under a content-addressed name, and points LoadImage at it", async () => {
		const wf = starter("workflow-comfyui-sdxl-ipadapter-sprite")
		afterSubmit = (id) => {
			socket.send({ type: "executed", data: { node: wf.outputNode, prompt_id: id, output: { images: [{ filename: "s.png", type: "output" }] } } })
			socket.send({ type: "executing", data: { node: null, prompt_id: id } })
		}
		const res = await adapter().generateImage(
			{ prompt: "hero", references: [{ uuid: "u1", kind: "image", mime: "image/png" } as any, { uuid: "u2", kind: "image", mime: "image/png" } as any] },
			{ workflow: wf, loadMedia: async () => ({ bytes: PNG, mime: "image/png" }) }
		)
		const uploads = calls.filter((c) => c.url.endsWith("/upload/image"))
		expect(uploads).toHaveLength(1)
		const load = Object.values(submitted.prompt).find((n: any) => n.class_type === "LoadImage") as any
		expect(load.inputs.image).toBe("uploaded.png")
		// The starter reads one reference; the second is reported, not sent.
		expect(res.ignored).toContain("references")
		expect(res.applied).toContain("references")
	})

	it("surfaces ComfyUI's own execution error verbatim", async () => {
		const wf = starter("workflow-comfyui-sd15-txt2img")
		afterSubmit = (id) =>
			socket.send({ type: "execution_error", data: { prompt_id: id, node_id: "4", node_type: "CheckpointLoaderSimple", exception_type: "FileNotFoundError", exception_message: "no such file" } })
		await expect(adapter().generateImage({ prompt: "p" }, { workflow: wf })).rejects.toThrow(
			"ComfyUI stopped at node 4 (CheckpointLoaderSimple): FileNotFoundError: no such file"
		)
	})

	it("surfaces the queue's node_errors verbatim", () => {
		expect(
			describePromptRefusal(400, {
				error: { message: "Prompt outputs failed validation", details: "" },
				node_errors: { "4": { class_type: "CheckpointLoaderSimple", errors: [{ message: "Value not in list", details: "ckpt_name: 'x' not in []" }] } }
			})
		).toBe(
			"ComfyUI refused the workflow: Prompt outputs failed validation. Node 4 (CheckpointLoaderSimple): Value not in list: ckpt_name: 'x' not in []"
		)
	})

	it("interrupts its own prompt on cancel", async () => {
		const wf = starter("workflow-comfyui-sd15-txt2img")
		const controller = new AbortController()
		afterSubmit = (id) => {
			socket.send({ type: "progress", data: { value: 1, max: 20, prompt_id: id } })
			controller.abort()
		}
		const res = await adapter().generateImage({ prompt: "p" }, { workflow: wf, signal: controller.signal })
		expect(res.isAborted).toBe(true)
		const interrupt = calls.find((c) => c.url.endsWith("/interrupt"))
		expect(interrupt).toBeDefined()
		expect(JSON.parse(String(interrupt!.init!.body))).toEqual({ prompt_id: "p-1" })
	})
})

describe("ComfyAdapter packing", () => {
	const items = (keys: string[]): RenderedSeriesItem[] => keys.map((key) => ({ key, label: key, prompt: key }))
	const sheet = { ...ComfyExports.sheet, perCall: 2 }

	it("packs distinct keys as keyed graphs, chunked at seriesMax", () => {
		expect(ComfyExports.packKeyedGraph!(items(["a", "b", "c"]), sheet)).toEqual([
			{ index: 0, keys: ["a", "b"], count: 2 },
			{ index: 1, keys: ["c"], count: 1 }
		])
	})

	it("leaves one item, or copies of one key, to batch or loop", () => {
		expect(ComfyExports.packKeyedGraph!(items(["a"]), sheet)).toBeNull()
		expect(ComfyExports.packKeyedGraph!(items(["1", "1", "1"]), sheet)).toBeNull()
	})

	it("reads seriesMax off the profile", () => {
		expect(ComfyExports.sheetFor!({ type: "comfyui", extraJson: { profile: { seriesMax: 3 } } }).perCall).toBe(3)
		expect(ComfyExports.sheetFor!({ type: "comfyui" }).payload).toBe("template")
	})
})
