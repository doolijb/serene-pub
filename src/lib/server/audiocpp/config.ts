/**
 * The `server.json` Serene Pub owns for audio.cpp (plan D5).
 *
 * `buildServerConfig` is PURE: settings row + enabled packages in, the config
 * object out, with a fixed key order so the file (and its hash) is stable.
 * Everything that touches disk or the database is below it.
 *
 * Confirmed against audio.cpp's server examples: `host`, `port`, `backend`,
 * `device`, `threads`, `lazy_load`, `max_loaded_models`, `ui`, `ui_management`
 * and per-model `id/family/path/task/mode/default_voice_preset` are documented.
 * Per-model `lazy` is NOT documented (lazy loading is the global `lazy_load`),
 * so it is omitted. `idle_unload_ms` is not in the shipped examples; it is
 * written only when the person set it.
 */
import os from "node:os"
import { createHash } from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import {
	KOKORO_VOICE_IDS,
	QWEN3_PRESET_VOICES,
	qwen3Variant
} from "$lib/shared/speech/catalogues"
import { resolveAudioCppBinaryDir } from "./binary"
import { ensureAudioCppSettings, type AudioCppSettingsRow } from "./settings"

/** The part of the settings row the config reads. */
export type ConfigSettings = Pick<
	AudioCppSettingsRow,
	| "port"
	| "backend"
	| "deviceIndex"
	| "threads"
	| "maxLoadedModels"
	| "idleUnloadMs"
>

export interface ConfigPackage {
	id: string
	family: string
	task: string
	variant?: string
	path: string
}

/** ★A9: Admin › Hardware will own these later; overrides the settings row. */
export interface HardwareOverride {
	backend?: string | null
	deviceIndex?: number | null
	threads?: number | null
}

export interface ServerConfigModel {
	id: string
	family: string
	path: string
	task: string
	mode: "offline"
	default_voice_preset?: { voice_id: string }
}

export interface ServerConfig {
	host: "127.0.0.1"
	port: number
	backend: string
	device?: number
	threads?: number
	lazy_load: true
	max_loaded_models: number
	idle_unload_ms?: number
	ui: false
	ui_management: false
	models: ServerConfigModel[]
}

const GPU_BACKENDS = new Set(["vulkan", "cuda", "metal", "rocm"])

function defaultVoice(p: ConfigPackage): string | null {
	if (p.family === "kokoro_tts") return KOKORO_VOICE_IDS[0] ?? null
	if (p.family === "qwen3_tts") {
		const variant = (p.variant ?? "").toLowerCase() || qwen3Variant(p.id)
		if (variant !== "customvoice") return null
		// audio.cpp takes the preset as spelled in the model card (Uncle_Fu).
		const first = QWEN3_PRESET_VOICES[0]
		return first ? first.name.replace(/ /g, "_") : null
	}
	return null
}

export function buildServerConfig(
	settings: ConfigSettings,
	enabledPackages: readonly ConfigPackage[],
	hardware?: HardwareOverride
): ServerConfig {
	const backend = hardware?.backend ?? settings.backend ?? "cpu"
	const deviceIndex =
		hardware?.deviceIndex !== undefined
			? hardware.deviceIndex
			: settings.deviceIndex
	const threads =
		hardware?.threads !== undefined ? hardware.threads : settings.threads
	const maxLoaded =
		settings.maxLoadedModels ?? (GPU_BACKENDS.has(backend) ? 2 : 1)

	const ordered: Record<string, unknown> = {
		host: "127.0.0.1",
		port: settings.port,
		backend
	}
	if (deviceIndex != null) ordered.device = deviceIndex
	if (threads != null) ordered.threads = threads
	ordered.lazy_load = true
	ordered.max_loaded_models = maxLoaded
	if (settings.idleUnloadMs != null)
		ordered.idle_unload_ms = settings.idleUnloadMs
	ordered.ui = false
	ordered.ui_management = false
	ordered.models = [...enabledPackages]
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
		.map((p) => {
			const m: ServerConfigModel = {
				id: p.id,
				family: p.family,
				path: p.path,
				task: p.task,
				mode: "offline"
			}
			const voice = defaultVoice(p)
			if (voice) m.default_voice_preset = { voice_id: voice }
			return m
		})
	return ordered as unknown as ServerConfig
}

export function serializeServerConfig(obj: ServerConfig): string {
	return JSON.stringify(obj, null, 2) + "\n"
}

export function hashServerConfig(text: string): string {
	return createHash("sha256").update(text).digest("hex")
}

type DirSettings = Pick<AudioCppSettingsRow, "binaryDir">

export function audioCppConfigPath(settings: DirSettings): string {
	return path.join(resolveAudioCppBinaryDir(settings), "serene-pub.server.json")
}

export function audioCppLogPath(settings: DirSettings): string {
	return path.join(resolveAudioCppBinaryDir(settings), "audiocpp_server.log")
}

/** Build from the database and write the file only when its text differs. */
export async function writeAudioCppConfig(
	db: Db
): Promise<{ path: string; hash: string; changed: boolean; modelCount: number }> {
	const stored = await ensureAudioCppSettings(db)
	// Unset threads meant audio.cpp ran on ONE thread (lane V V-10): default
	// to half the machine's logical cores, at least one, until Admin ›
	// Hardware owns the allotment (★A9).
	const settings =
		stored.threads == null
			? { ...stored, threads: Math.max(1, Math.floor(os.cpus().length / 2)) }
			: stored
	const { enabledPackagesForConfig } = await import("./packages")
	const packages = await enabledPackagesForConfig(db)
	const text = serializeServerConfig(buildServerConfig(settings, packages))
	const hash = hashServerConfig(text)
	const file = audioCppConfigPath(settings)
	let current: string | null = null
	try {
		current = await fs.readFile(file, "utf8")
	} catch {}
	const modelCount = packages.length
	if (current === text) return { path: file, hash, changed: false, modelCount }
	await fs.mkdir(path.dirname(file), { recursive: true })
	const tmp = `${file}.tmp`
	await fs.writeFile(tmp, text, "utf8")
	await fs.rename(tmp, file)
	return { path: file, hash, changed: true, modelCount }
}
