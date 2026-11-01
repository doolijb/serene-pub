/**
 * 🚧 Detecting the graphics card and memory of the computer Serene Pub runs on,
 * so the model finder can propose a KoboldCPP build and a memory answer instead
 * of asking. Answers `models:machineHardware` (admin only), once per boot.
 *
 * Probes, in order: Apple silicon (unified memory, nothing to run),
 * `nvidia-smi`, then on Linux `rocm-smi` and the kernel's `/sys/class/drm`
 * for AMD. Each probe is bounded by `HARDWARE_PROBE_TIMEOUT_MS`; a missing
 * tool, a non-zero exit or a timeout is silence, never an error.
 *
 * ⚠ Detects the machine the pub runs on, not the device the page is open on.
 * ⚠ Not the **memory tier**: that is the person's own answer; this is what
 * detection found. ⚠ Silence is not "none": vendor null means no probe
 * answered.
 */
import { execFile } from "node:child_process"
import { readdir, readFile } from "node:fs/promises"
import os from "node:os"
import type {
	GpuVendor,
	MachineHardware,
	MachinePlatform
} from "$lib/shared/connections/machineHardware"

export const HARDWARE_PROBE_TIMEOUT_MS = 5000

/** An AMD card under this is an APU carve-out, not a card worth naming. */
const MIN_AMD_CARD_GIB = 2

const gib = (bytes: number) => Math.round((bytes / 1024 ** 3) * 10) / 10

/** `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` */
export function parseNvidiaSmi(
	csv: string
): { name: string; memoryGb: number } | null {
	let best: { name: string; memoryGb: number; mib: number } | null = null
	for (const raw of String(csv ?? "").split(/\r?\n/)) {
		const line = raw.trim()
		if (!line) continue
		const at = line.lastIndexOf(",")
		if (at < 1) continue
		const name = line.slice(0, at).trim()
		const memText = line.slice(at + 1).trim()
		if (!name || !/^\d+(\.\d+)?$/.test(memText)) continue
		const mib = Number(memText)
		if (!(mib > 0)) continue
		if (!best || mib > best.mib) {
			best = { name, mib, memoryGb: Math.round((mib / 1024) * 10) / 10 }
		}
	}
	return best ? { name: best.name, memoryGb: best.memoryGb } : null
}

/** `rocm-smi --showproductname --showmeminfo vram --json` */
export function parseRocmSmi(
	stdout: string
): { name: string | null; memoryGb: number } | null {
	const text = String(stdout ?? "")
	const start = text.indexOf("{")
	if (start < 0) return null
	let json: any
	try {
		json = JSON.parse(text.slice(start))
	} catch {
		return null
	}
	if (!json || typeof json !== "object") return null
	let best: { name: string | null; bytes: number } | null = null
	for (const [key, card] of Object.entries<any>(json)) {
		if (!/^card/i.test(key) || !card || typeof card !== "object") continue
		const bytes = Number(card["VRAM Total Memory (B)"])
		if (!Number.isFinite(bytes) || bytes <= 0) continue
		const pick = (v: unknown) =>
			typeof v === "string" &&
			v.trim() &&
			!/^0x[0-9a-f]+$/i.test(v.trim())
				? v.trim()
				: null
		const name = pick(card["Card series"]) ?? pick(card["Card SKU"])
		if (!best || bytes > best.bytes) best = { name, bytes }
	}
	return best ? { name: best.name, memoryGb: gib(best.bytes) } : null
}

/** `/sys/class/drm/card*` reads, for AMD cards without ROCm installed. */
export function parseAmdSysfs(
	cards: { vendor: string; vramBytes: string | null }[]
): number | null {
	let best: number | null = null
	for (const card of cards ?? []) {
		if (
			String(card?.vendor ?? "")
				.trim()
				.toLowerCase() !== "0x1002"
		)
			continue
		const bytes = Number(String(card.vramBytes ?? "").trim())
		if (!Number.isFinite(bytes) || bytes <= 0) continue
		const g = gib(bytes)
		if (g < MIN_AMD_CARD_GIB) continue
		if (best === null || g > best) best = g
	}
	return best
}

export interface HardwareProbeDeps {
	run?: (
		cmd: string,
		args: string[],
		timeoutMs: number
	) => Promise<string | null>
	readAmdSysfs?: () => Promise<{ vendor: string; vramBytes: string | null }[]>
	platform?: NodeJS.Platform
	arch?: string
	totalmem?: () => number
	now?: () => Date
}

function defaultRun(
	cmd: string,
	args: string[],
	timeoutMs: number
): Promise<string | null> {
	return new Promise((resolve) => {
		try {
			execFile(
				cmd,
				args,
				{
					timeout: timeoutMs,
					windowsHide: true,
					maxBuffer: 1024 * 1024
				},
				(error, stdout) => resolve(error ? null : String(stdout))
			)
		} catch {
			resolve(null)
		}
	})
}

async function defaultReadAmdSysfs(): Promise<
	{ vendor: string; vramBytes: string | null }[]
> {
	if (process.platform !== "linux") return []
	try {
		const base = "/sys/class/drm"
		const read = async (p: string) => {
			try {
				return (await readFile(p, "utf8")).trim()
			} catch {
				return null
			}
		}
		const out: { vendor: string; vramBytes: string | null }[] = []
		for (const entry of await readdir(base)) {
			if (!/^card\d+$/.test(entry)) continue
			const vendor = await read(`${base}/${entry}/device/vendor`)
			if (vendor === null) continue
			out.push({
				vendor,
				vramBytes: await read(
					`${base}/${entry}/device/mem_info_vram_total`
				)
			})
		}
		return out
	} catch {
		return []
	}
}

const PLATFORMS: Partial<Record<NodeJS.Platform, MachinePlatform>> = {
	linux: "linux",
	win32: "windows",
	darwin: "macos"
}

export async function detectMachineHardware(
	deps: HardwareProbeDeps = {}
): Promise<MachineHardware> {
	const platform = deps.platform ?? process.platform
	const arch = deps.arch ?? process.arch
	let systemMemoryGb = 0
	let detectedAt = new Date().toISOString()
	try {
		systemMemoryGb = gib((deps.totalmem ?? os.totalmem)())
		detectedAt = (deps.now ?? (() => new Date()))().toISOString()
	} catch {
		/* keep the defaults */
	}
	const result = (
		vendor: GpuVendor | null,
		name: string | null,
		memoryGb: number | null
	): MachineHardware => ({
		gpu: { vendor, name, memoryGb },
		systemMemoryGb,
		platform: PLATFORMS[platform] ?? "other",
		arch,
		detectedAt
	})
	try {
		const run = deps.run ?? defaultRun
		if (platform === "darwin" && arch === "arm64") {
			return result("apple", null, null)
		}
		const nvidia = parseNvidiaSmi(
			(await run(
				"nvidia-smi",
				[
					"--query-gpu=name,memory.total",
					"--format=csv,noheader,nounits"
				],
				HARDWARE_PROBE_TIMEOUT_MS
			)) ?? ""
		)
		if (nvidia) return result("nvidia", nvidia.name, nvidia.memoryGb)
		if (platform === "linux") {
			const rocm = parseRocmSmi(
				(await run(
					"rocm-smi",
					["--showproductname", "--showmeminfo", "vram", "--json"],
					HARDWARE_PROBE_TIMEOUT_MS
				)) ?? ""
			)
			if (rocm) return result("amd", rocm.name, rocm.memoryGb)
			const sysfs = parseAmdSysfs(
				await (deps.readAmdSysfs ?? defaultReadAmdSysfs)()
			)
			if (sysfs !== null) return result("amd", null, sysfs)
		}
	} catch {
		/* silence is not an error */
	}
	return result(null, null, null)
}

let cached: Promise<MachineHardware> | null = null

/** Detect at most once per process; concurrent first callers share one run. */
export function machineHardware(): Promise<MachineHardware> {
	cached ??= detectMachineHardware()
	return cached
}

export function resetMachineHardwareForTests(): void {
	cached = null
}
