import { readFileSync } from "fs"
import { join } from "path"
import { describe, expect, test } from "vitest"
import {
	buildServerConfig,
	hashServerConfig,
	serializeServerConfig,
	type ConfigPackage,
	type ConfigSettings
} from "./config"

const base: ConfigSettings = {
	port: 5002,
	backend: null,
	deviceIndex: null,
	threads: null,
	maxLoadedModels: null,
	idleUnloadMs: null
}

const pkgs: ConfigPackage[] = [
	{
		id: "parakeet_tdt_0_6b_v3_q8_0",
		family: "parakeet_tdt",
		task: "asr",
		path: "/m/asr/parakeet_tdt/P/parakeet.gguf"
	},
	{
		id: "qwen3_tts_1_7b_customvoice_q8_0",
		family: "qwen3_tts",
		task: "tts",
		variant: "customvoice",
		path: "/m/tts/qwen3_tts/Q/qwen3-cv.gguf"
	},
	{
		id: "kokoro_82m_q8_0",
		family: "kokoro_tts",
		task: "tts",
		path: "/m/tts/kokoro_tts/K/kokoro.gguf"
	}
]

describe("buildServerConfig", () => {
	test("golden file", () => {
		const text = serializeServerConfig(
			buildServerConfig({ ...base, backend: "vulkan", deviceIndex: 0, threads: 4, idleUnloadMs: 600000 }, pkgs)
		)
		const golden = readFileSync(
			join(__dirname, "__fixtures__", "server.golden.json"),
			"utf8"
		)
		expect(text).toBe(golden)
	})

	test("key order is deterministic and models sorted by id", () => {
		const a = buildServerConfig(base, pkgs)
		const b = buildServerConfig(base, [...pkgs].reverse())
		expect(serializeServerConfig(a)).toBe(serializeServerConfig(b))
		expect(Object.keys(a)).toEqual([
			"host", "port", "backend", "lazy_load", "max_loaded_models", "ui", "ui_management", "models"
		])
		expect(a.models.map((m) => m.id)).toEqual([
			"kokoro_82m_q8_0",
			"parakeet_tdt_0_6b_v3_q8_0",
			"qwen3_tts_1_7b_customvoice_q8_0"
		])
		expect("voice_dir" in a).toBe(false)
	})

	test("max_loaded_models: 2 on GPU backends, 1 on cpu/unknown, setting wins", () => {
		for (const b of ["vulkan", "cuda", "metal", "rocm"] as const)
			expect(buildServerConfig({ ...base, backend: b }, []).max_loaded_models).toBe(2)
		expect(buildServerConfig({ ...base, backend: "cpu" }, []).max_loaded_models).toBe(1)
		expect(buildServerConfig(base, []).max_loaded_models).toBe(1)
		expect(buildServerConfig(base, []).backend).toBe("cpu")
		expect(buildServerConfig({ ...base, backend: "cuda", maxLoadedModels: 3 }, []).max_loaded_models).toBe(3)
	})

	test("device, threads and idle_unload_ms only when set", () => {
		const bare = buildServerConfig(base, [])
		expect("device" in bare || "threads" in bare || "idle_unload_ms" in bare).toBe(false)
		const set = buildServerConfig({ ...base, deviceIndex: 0, threads: 6, idleUnloadMs: 5 }, [])
		expect(set.device).toBe(0)
		expect(set.threads).toBe(6)
		expect(set.idle_unload_ms).toBe(5)
	})

	test("hardware override beats the settings row", () => {
		const c = buildServerConfig(base, [], { backend: "cuda", deviceIndex: 1, threads: 2 })
		expect(c.backend).toBe("cuda")
		expect(c.device).toBe(1)
		expect(c.threads).toBe(2)
		expect(c.max_loaded_models).toBe(2)
	})

	test("default voice only for kokoro and qwen3 customvoice", () => {
		const c = buildServerConfig(base, [
			...pkgs,
			{ id: "qwen3_vd", family: "qwen3_tts", task: "vdes", variant: "voicedesign", path: "/x" }
		])
		const by = Object.fromEntries(c.models.map((m) => [m.id, m]))
		expect(by.kokoro_82m_q8_0.default_voice_preset).toEqual({ voice_id: "af_heart" })
		expect(by.qwen3_tts_1_7b_customvoice_q8_0.default_voice_preset).toEqual({ voice_id: "Vivian" })
		expect(by.qwen3_vd.default_voice_preset).toBeUndefined()
		expect(by.parakeet_tdt_0_6b_v3_q8_0.default_voice_preset).toBeUndefined()
		expect(by.kokoro_82m_q8_0.mode).toBe("offline")
	})

	test("hash is stable and changes with content", () => {
		const t = serializeServerConfig(buildServerConfig(base, pkgs))
		expect(hashServerConfig(t)).toBe(hashServerConfig(t))
		expect(hashServerConfig(t)).toMatch(/^[0-9a-f]{64}$/)
		expect(hashServerConfig(t)).not.toBe(
			hashServerConfig(serializeServerConfig(buildServerConfig({ ...base, port: 5003 }, pkgs)))
		)
		expect(t.endsWith("}\n")).toBe(true)
	})
})
