import { describe, expect, test } from "vitest"
import {
	connectionRowStatus,
	hostOf,
	type RowConnection
} from "./connectionRowStatus"

const base: RowConnection = {
	id: 1,
	name: "A connection",
	type: null,
	baseUrl: "https://openrouter.ai/api/v1/",
	models: [],
	modelsSync: { at: null, error: null }
}
const model = (over: Partial<RowConnection["models"][number]> = {}) => ({
	name: "gpt-4o",
	model: "openai/gpt-4o",
	missingSince: null,
	...over
})
const timeAgo = () => "3 minutes ago"

describe("hostOf", () => {
	test("drops the scheme and the trailing slash, keeps a path", () => {
		expect(hostOf("https://openrouter.ai/api/v1/")).toBe(
			"openrouter.ai/api/v1"
		)
		expect(hostOf("http://localhost:11434/")).toBe("localhost:11434")
		expect(hostOf("not a url")).toBe("not a url")
		expect(hostOf(null)).toBe("")
	})
})

describe("an API host", () => {
	test("counts its models, names its host and says when it was checked", () => {
		const status = connectionRowStatus(
			{
				...base,
				models: [model(), model({ name: "claude" })],
				modelsSync: { at: "2026-09-17T10:00:00Z", error: null }
			},
			{ kind: "api", timeAgo }
		)
		expect(status.dot).toBe("ok")
		expect(status.sentence).toBe(
			"2 models · openrouter.ai/api/v1 · checked 3 minutes ago"
		)
		expect(status.action).toBeNull()
	})

	test("a failed listing says so and offers Fix", () => {
		const status = connectionRowStatus(
			{ ...base, modelsSync: { at: null, error: "401 Unauthorized" } },
			{ kind: "api", timeAgo }
		)
		expect(status.sentence).toBe("Couldn't list models · 401 Unauthorized")
		expect(status.action?.verb).toBe("fix")
	})

	test("models that went missing offer Refresh", () => {
		const status = connectionRowStatus(
			{
				...base,
				models: [
					model(),
					model({ missingSince: "2026-09-12T00:00:00Z" })
				]
			},
			{ kind: "api", timeAgo }
		)
		expect(status.sentence).toBe("1 of 2 no longer listed")
		expect(status.action?.verb).toBe("refresh")
	})
})

describe("the managed KoboldCPP", () => {
	const kcpp = { ...base, name: "KoboldCPP", models: [model(), model()] }

	test("running names the loaded file and offers Stop", () => {
		const status = connectionRowStatus(kcpp, {
			kind: "koboldcpp-managed",
			managerEnabled: true,
			kcpp: {
				run: "running",
				loadedFiles: ["qwen3-8b.gguf"],
				downloads: []
			}
		})
		expect(status.sentence).toBe("Running · qwen3-8b.gguf · 2 on disk")
		expect(status.action?.verb).toBe("stop")
	})

	test("stopped is not a fault — it starts on first use", () => {
		const status = connectionRowStatus(kcpp, {
			kind: "koboldcpp-managed",
			managerEnabled: true,
			kcpp: { run: "stopped", loadedFiles: [], downloads: [] }
		})
		expect(status.dot).toBe("quiet")
		expect(status.sentence).toBe(
			"Stopped · starts on first use · 2 on disk"
		)
		expect(status.action?.verb).toBe("start")
	})

	test("crashed is", () => {
		const status = connectionRowStatus(kcpp, {
			kind: "koboldcpp-managed",
			managerEnabled: true,
			kcpp: { run: "crashed", loadedFiles: [], downloads: [] }
		})
		expect(status.dot).toBe("error")
		expect(status.action?.verb).toBe("start")
	})

	test("the flag off means nobody finished installing it", () => {
		const status = connectionRowStatus(kcpp, {
			kind: "koboldcpp-managed",
			managerEnabled: false
		})
		expect(status.sentence).toBe("Not installed · one tap to set up")
		expect(status.action).toBeNull()
	})

	test("the flag on but no mode or binary yet is a setup stage, not a stopped process", () => {
		const status = connectionRowStatus(kcpp, {
			kind: "koboldcpp-managed",
			managerEnabled: true,
			kcppSetUp: false,
			kcpp: { run: "stopped", loadedFiles: [], downloads: [] }
		})
		expect(status.sentence).toBe("Not set up · choose how to run it")
		expect(status.action).toBeNull()
	})

	test("an unanswered process says only what the row knows", () => {
		const status = connectionRowStatus(kcpp, {
			kind: "koboldcpp-managed",
			managerEnabled: true,
			kcpp: null
		})
		expect(status.sentence).toBe("2 on disk")
		expect(status.action).toBeNull()
	})
})

describe("an Ollama host", () => {
	const ollama = {
		...base,
		name: "Ollama",
		baseUrl: "http://localhost:11434/",
		models: [model({ name: "llama3.1:8b" })]
	}

	test("reachable counts its models and names the host", () => {
		const status = connectionRowStatus(ollama, {
			kind: "ollama",
			ollama: { reachable: true, version: "0.5.0", running: [] }
		})
		expect(status.sentence).toBe("Running · 1 model · localhost:11434")
	})

	test("unreachable says so and offers Fix", () => {
		const status = connectionRowStatus(ollama, {
			kind: "ollama",
			ollama: { reachable: false, version: null, running: [] }
		})
		expect(status.sentence).toBe("Not reachable · localhost:11434")
		expect(status.action?.verb).toBe("fix")
	})
})

describe("a local ONNX endpoint", () => {
	const onnx = {
		...base,
		name: "Embeddings",
		baseUrl: null,
		models: [
			model({
				name: "bge-small",
				model: "bge-small",
				local: { state: "on_disk" }
			})
		]
	}

	test("names the active model and how long it has been idle", () => {
		const status = connectionRowStatus(onnx, {
			kind: "onnx-embeddings",
			lane: {
				modelId: "bge-small",
				loaded: true,
				lastUsedAt: "2026-09-17T09:56:00Z",
				pending: null
			},
			now: Date.parse("2026-09-17T10:00:00Z")
		})
		expect(status.sentence).toBe("bge-small active · loaded, idle 4 min")
	})

	test("on disk but not loaded is still healthy", () => {
		const status = connectionRowStatus(onnx, {
			kind: "onnx-embeddings",
			lane: {
				modelId: "bge-small",
				loaded: false,
				lastUsedAt: null,
				pending: null
			}
		})
		expect(status.dot).toBe("ok")
		expect(status.sentence).toBe("bge-small active · on disk, not loaded")
	})

	test("a download in flight outranks the lane", () => {
		const status = connectionRowStatus(
			{
				...onnx,
				models: [
					model({
						name: "bge-large",
						model: "bge-large",
						local: { state: "downloading", percent: 51.4 }
					})
				]
			},
			{ kind: "onnx-embeddings", lane: null }
		)
		expect(status.dot).toBe("pending")
		expect(status.sentence).toBe("Downloading bge-large · 51%")
	})

	test("nothing active counts what is on disk", () => {
		const status = connectionRowStatus(onnx, {
			kind: "onnx-embeddings",
			lane: null
		})
		expect(status.sentence).toBe("Nothing active · 1 on disk")
	})
})

test("a listing in flight says so on every kind", () => {
	const status = connectionRowStatus(base, { kind: "api", syncing: true })
	expect(status.sentence).toBe("Checking models…")
	expect(status.action).toBeNull()
})
