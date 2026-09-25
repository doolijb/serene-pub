import { describe, expect, test } from "vitest"
import {
	connectionRowStatus,
	hostOf,
	stateTone,
	type RowConnection
} from "./connectionRowStatus"

const base: RowConnection = {
	id: 1,
	name: "A connection",
	type: null,
	preset: null,
	baseUrl: "https://openrouter.ai/api/v1/",
	hasCredential: true,
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
	test("fills the four slots and composes no sentence", () => {
		const status = connectionRowStatus(
			{
				...base,
				models: [model(), model({ name: "claude" })],
				modelsSync: { at: "2026-09-17T10:00:00Z", error: null }
			},
			{ kind: "api", timeAgo }
		)
		expect(status).toEqual({
			state: "ready",
			label: "Ready",
			detail: "openrouter.ai/api/v1",
			metric: "2 models",
			action: null
		})
	})

	test("no slot ever carries a ' · ' joined list", () => {
		const status = connectionRowStatus(
			{
				...base,
				models: [model()],
				modelsSync: { at: "2026-09-17T10:00:00Z", error: null }
			},
			{ kind: "api", timeAgo }
		)
		for (const slot of [status.label, status.detail, status.metric])
			expect(slot ?? "").not.toContain(" · ")
	})

	test("a failed listing is broken, and carries the host's own words", () => {
		const status = connectionRowStatus(
			{ ...base, modelsSync: { at: null, error: "401 Unauthorized" } },
			{ kind: "api", timeAgo }
		)
		expect(status.state).toBe("broken")
		expect(status.label).toBe("Not working")
		expect(status.detail).toBe("401 Unauthorized")
		expect(status.action?.verb).toBe("fix")
	})

	test("never checked is idle, not a failure", () => {
		const status = connectionRowStatus(
			{ ...base, models: [model()] },
			{ kind: "api", timeAgo }
		)
		expect(status.state).toBe("idle")
		expect(status.label).toBe("Not tested")
	})

	test("a model the host stopped listing is unfinished, not red", () => {
		const status = connectionRowStatus(
			{
				...base,
				models: [
					model(),
					model({ missingSince: "2026-09-01T00:00:00Z" })
				],
				modelsSync: { at: "2026-09-17T10:00:00Z", error: null }
			},
			{ kind: "api", timeAgo }
		)
		expect(status.state).toBe("unfinished")
		expect(status.label).toBe("1 no longer listed")
		expect(status.action?.verb).toBe("refresh")
	})

	test("a successful listing that named nothing asks for a refresh", () => {
		const status = connectionRowStatus(
			{
				...base,
				modelsSync: { at: "2026-09-17T10:00:00Z", error: null }
			},
			{ kind: "api", timeAgo }
		)
		expect(status.state).toBe("unfinished")
		expect(status.label).toBe("No models")
	})
})

/**
 * The regression this whole split exists for: on a fresh install two of four
 * rows were red with Fix buttons because two connections had no API key yet.
 */
describe("a cloud connection with no key yet", () => {
	const keyless: RowConnection = {
		...base,
		type: "openai",
		preset: "openrouter",
		hasCredential: false,
		modelsSync: { at: null, error: "Missing credentials" }
	}

	test("is unfinished and gold, never broken and never red", () => {
		const status = connectionRowStatus(keyless, { kind: "api", timeAgo })
		expect(status.state).toBe("unfinished")
		expect(stateTone(status.state)).toBe("primary")
		expect(status.label).toBe("Needs a key")
	})

	test("does not report the listing error a missing key obviously caused", () => {
		const status = connectionRowStatus(keyless, { kind: "api", timeAgo })
		expect(status.detail).toBe("openrouter.ai/api/v1")
		expect(status.detail).not.toContain("Missing credentials")
	})

	test("offers Set up rather than Fix", () => {
		expect(
			connectionRowStatus(keyless, { kind: "api", timeAgo }).action?.verb
		).toBe("setup")
	})

	test("once the key is there, a real rejection IS broken", () => {
		const status = connectionRowStatus(
			{
				...keyless,
				hasCredential: true,
				modelsSync: { at: null, error: "401 Unauthorized" }
			},
			{ kind: "api", timeAgo }
		)
		expect(status.state).toBe("broken")
		expect(status.detail).toBe("401 Unauthorized")
	})

	test("a local host with no key is not unfinished — it wants none", () => {
		const status = connectionRowStatus(
			{
				...base,
				type: "openai",
				preset: null,
				baseUrl: "http://localhost:8080/v1/",
				hasCredential: false,
				models: [model()],
				modelsSync: { at: "2026-09-17T10:00:00Z", error: null }
			},
			{ kind: "api", timeAgo }
		)
		expect(status.state).toBe("ready")
	})
})

describe("a managed KoboldCPP", () => {
	const managed = { ...base, type: "koboldcpp_managed", baseUrl: null }

	test("with the manager off is unfinished, and offers Set up", () => {
		const status = connectionRowStatus(managed, {
			kind: "koboldcpp-managed",
			managerEnabled: false
		})
		expect(status.state).toBe("unfinished")
		expect(status.label).toBe("Not installed")
		expect(status.action?.verb).toBe("setup")
	})

	test("with no binary chosen says so rather than offering Start", () => {
		const status = connectionRowStatus(managed, {
			kind: "koboldcpp-managed",
			managerEnabled: true,
			kcppSetUp: false
		})
		expect(status.label).toBe("Not set up")
		expect(status.action?.verb).toBe("setup")
	})

	test("running names the loaded file under the name and counts on disk", () => {
		const status = connectionRowStatus(
			{ ...managed, models: [model(), model()] },
			{
				kind: "koboldcpp-managed",
				managerEnabled: true,
				kcpp: { run: "running", loadedFiles: ["Nemo 12B"] } as any
			}
		)
		expect(status.state).toBe("ready")
		expect(status.detail).toBe("Nemo 12B")
		expect(status.metric).toBe("2 on disk")
		expect(status.action?.verb).toBe("stop")
	})

	test("stopped is idle — the manager starts it on first use", () => {
		const status = connectionRowStatus(managed, {
			kind: "koboldcpp-managed",
			managerEnabled: true,
			kcpp: { run: "stopped" } as any
		})
		expect(status.state).toBe("idle")
		expect(stateTone(status.state)).toBe("quiet")
		expect(status.action?.verb).toBe("start")
	})

	test("crashed is the one that is red", () => {
		const status = connectionRowStatus(managed, {
			kind: "koboldcpp-managed",
			managerEnabled: true,
			kcpp: { run: "crashed" } as any
		})
		expect(status.state).toBe("broken")
		expect(status.action?.verb).toBe("start")
	})

	test("nothing answered claims nothing", () => {
		const status = connectionRowStatus(managed, {
			kind: "koboldcpp-managed",
			managerEnabled: true
		})
		expect(status.state).toBe("idle")
		expect(status.label).toBe("Installed")
	})
})

describe("an Ollama", () => {
	const ollama = {
		...base,
		type: "ollama",
		baseUrl: "http://localhost:11434/"
	}

	test("reachable is ready, with the host under the name", () => {
		const status = connectionRowStatus(
			{ ...ollama, models: [model(), model(), model(), model()] },
			{ kind: "ollama", ollama: { reachable: true } as any }
		)
		expect(status).toEqual({
			state: "ready",
			label: "Running",
			detail: "localhost:11434",
			metric: "4 models",
			action: null
		})
	})

	test("configured and not answering is broken", () => {
		const status = connectionRowStatus(ollama, {
			kind: "ollama",
			ollama: { reachable: false } as any
		})
		expect(status.state).toBe("broken")
		expect(status.label).toBe("Not reachable")
		expect(status.action?.verb).toBe("fix")
	})

	test("nothing answered is idle", () => {
		expect(connectionRowStatus(ollama, { kind: "ollama" }).state).toBe(
			"idle"
		)
	})
})

describe("a local ONNX lane", () => {
	const onnx = { ...base, type: "local_onnx_embeddings", baseUrl: null }
	const local = (state: string, over: Record<string, unknown> = {}) => ({
		...model({ name: "bge-small", model: "bge-small" }),
		local: { state, ...over } as any
	})

	test("nothing active is unfinished", () => {
		const status = connectionRowStatus(
			{ ...onnx, models: [local("on_disk")] },
			{ kind: "onnx-embeddings", lane: {} as any }
		)
		expect(status.state).toBe("unfinished")
		expect(status.label).toBe("Nothing active")
	})

	test("loaded reads its idle time in the metric slot", () => {
		const now = Date.parse("2026-09-17T10:04:00Z")
		const status = connectionRowStatus(
			{ ...onnx, models: [local("on_disk")] },
			{
				kind: "onnx-embeddings",
				lane: {
					modelId: "bge-small",
					loaded: true,
					lastUsedAt: "2026-09-17T10:00:00Z"
				} as any,
				now
			}
		)
		expect(status.state).toBe("ready")
		expect(status.detail).toBe("bge-small")
		expect(status.metric).toBe("idle 4 min")
	})

	test("a download in flight is busy, with its percent as the metric", () => {
		const status = connectionRowStatus(
			{ ...onnx, models: [local("downloading", { percent: 42 })] },
			{ kind: "onnx-embeddings", lane: {} as any }
		)
		expect(status.state).toBe("busy")
		expect(status.label).toBe("Downloading")
		expect(status.metric).toBe("42%")
	})

	test("an active model whose files are gone is unfinished", () => {
		const status = connectionRowStatus(
			{ ...onnx, models: [local("not_downloaded")] },
			{
				kind: "onnx-embeddings",
				lane: { modelId: "bge-small", loaded: false } as any
			}
		)
		expect(status.state).toBe("unfinished")
		expect(status.label).toBe("Not downloaded")
	})
})

describe("a sync in flight", () => {
	test("is busy, whatever kind the endpoint is", () => {
		const status = connectionRowStatus(base, { kind: "api", syncing: true })
		expect(status.state).toBe("busy")
		expect(status.label).toBe("Checking")
		expect(status.action).toBeNull()
	})
})

describe("stateTone", () => {
	test("maps each state to exactly one role, and only broken is error", () => {
		expect(stateTone("ready")).toBe("ok")
		expect(stateTone("idle")).toBe("quiet")
		expect(stateTone("unfinished")).toBe("primary")
		expect(stateTone("busy")).toBe("warning")
		expect(stateTone("broken")).toBe("error")
	})
})
