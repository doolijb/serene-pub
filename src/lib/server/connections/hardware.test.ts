import { beforeEach, describe, expect, test, vi } from "vitest"
import {
	detectMachineHardware,
	machineHardware,
	parseAmdSysfs,
	parseNvidiaSmi,
	parseRocmSmi,
	resetMachineHardwareForTests
} from "./hardware"

const GIB = 1024 ** 3

const ONE_GPU = "NVIDIA GeForce RTX 3060, 12288\n"
const TWO_GPUS =
	"NVIDIA GeForce GTX 1050, 4096\nNVIDIA GeForce RTX 4090, 24564\n"

const ROCM_ONE = JSON.stringify({
	card0: {
		"VRAM Total Memory (B)": "17163091968",
		"VRAM Total Used Memory (B)": "1000",
		"Card series": "Navi 21 [Radeon RX 6800/6800 XT / 6900 XT]",
		"Card model": "0x73bf",
		"Card vendor": "Advanced Micro Devices, Inc. [AMD/ATI]"
	},
	system: { "Driver version": "6.1" }
})
const ROCM_TWO = JSON.stringify({
	card0: { "VRAM Total Memory (B)": String(8 * GIB), "Card series": "Small" },
	card1: { "VRAM Total Memory (B)": String(16 * GIB), "Card series": "Big" }
})
const ROCM_HEX = JSON.stringify({
	card0: { "VRAM Total Memory (B)": String(8 * GIB), "Card model": "0x73bf" }
})

describe("parseNvidiaSmi", () => {
	test("one GPU", () => {
		expect(parseNvidiaSmi(ONE_GPU)).toEqual({
			name: "NVIDIA GeForce RTX 3060",
			memoryGb: 12
		})
	})
	test("largest of several wins", () => {
		expect(parseNvidiaSmi(TWO_GPUS)).toEqual({
			name: "NVIDIA GeForce RTX 4090",
			memoryGb: 24
		})
	})
	test("CRLF line ends", () => {
		expect(parseNvidiaSmi("RTX A, 8192\r\nRTX B, 4096\r\n")?.name).toBe(
			"RTX A"
		)
	})
	test("skips [N/A] and malformed lines", () => {
		expect(
			parseNvidiaSmi("Weird, [N/A]\nnonsense\n\nRTX C, 6144\n")
		).toEqual({
			name: "RTX C",
			memoryGb: 6
		})
	})
	test("empty is null", () => {
		expect(parseNvidiaSmi("")).toBeNull()
		expect(parseNvidiaSmi("X, [Not Supported]")).toBeNull()
	})
})

describe("parseRocmSmi", () => {
	test("one card with a name", () => {
		expect(parseRocmSmi(ROCM_ONE)).toEqual({
			name: "Navi 21 [Radeon RX 6800/6800 XT / 6900 XT]",
			memoryGb: 16
		})
	})
	test("largest card wins", () => {
		expect(parseRocmSmi(ROCM_TWO)).toEqual({ name: "Big", memoryGb: 16 })
	})
	test("leading WARNING lines are skipped", () => {
		expect(
			parseRocmSmi(`WARNING: stuff\nWARNING: more\n${ROCM_ONE}`)?.memoryGb
		).toBe(16)
	})
	test("no card keys or garbage is null", () => {
		expect(parseRocmSmi('{"system": {}}')).toBeNull()
		expect(parseRocmSmi("not json {")).toBeNull()
		expect(parseRocmSmi("")).toBeNull()
	})
	test("a hex-only model id is not a name", () => {
		expect(parseRocmSmi(ROCM_HEX)).toEqual({ name: null, memoryGb: 8 })
	})
})

describe("parseAmdSysfs", () => {
	test("AMD counts, NVIDIA vendor ignored", () => {
		expect(
			parseAmdSysfs([
				{ vendor: "0x10de", vramBytes: String(24 * GIB) },
				{ vendor: "0x1002", vramBytes: String(8 * GIB) }
			])
		).toBe(8)
	})
	test("under 2 GiB is ignored", () => {
		expect(
			parseAmdSysfs([{ vendor: "0x1002", vramBytes: String(GIB) }])
		).toBeNull()
		expect(
			parseAmdSysfs([{ vendor: "0x1002", vramBytes: null }])
		).toBeNull()
	})
})

describe("detectMachineHardware", () => {
	const base = {
		totalmem: () => 15.96 * GIB,
		now: () => new Date("2026-10-30T00:00:00Z")
	}
	test("Apple silicon needs no probe", async () => {
		const run = vi.fn(async () => null)
		const hw = await detectMachineHardware({
			...base,
			run,
			platform: "darwin",
			arch: "arm64"
		})
		expect(hw.gpu).toEqual({ vendor: "apple", name: null, memoryGb: null })
		expect(hw.platform).toBe("macos")
		expect(run).not.toHaveBeenCalled()
	})
	test("NVIDIA path, with rounding and stamp", async () => {
		const hw = await detectMachineHardware({
			...base,
			run: async () => ONE_GPU,
			platform: "win32",
			arch: "x64"
		})
		expect(hw.gpu).toEqual({
			vendor: "nvidia",
			name: "NVIDIA GeForce RTX 3060",
			memoryGb: 12
		})
		expect(hw.systemMemoryGb).toBe(16)
		expect(hw.platform).toBe("windows")
		expect(hw.arch).toBe("x64")
		expect(hw.detectedAt).toBe("2026-10-30T00:00:00.000Z")
	})
	test("Linux rocm path", async () => {
		const run = async (cmd: string) =>
			cmd === "rocm-smi" ? ROCM_ONE : null
		const hw = await detectMachineHardware({
			...base,
			run,
			platform: "linux",
			arch: "x64"
		})
		expect(hw.gpu.vendor).toBe("amd")
		expect(hw.gpu.memoryGb).toBe(16)
	})
	test("Linux sysfs fallback", async () => {
		const hw = await detectMachineHardware({
			...base,
			run: async () => null,
			readAmdSysfs: async () => [
				{ vendor: "0x1002", vramBytes: String(12 * GIB) }
			],
			platform: "linux",
			arch: "x64"
		})
		expect(hw.gpu).toEqual({ vendor: "amd", name: null, memoryGb: 12 })
	})
	test("Windows with nothing found never tries rocm or sysfs", async () => {
		const run = vi.fn(async () => null)
		const readAmdSysfs = vi.fn(async () => [])
		const hw = await detectMachineHardware({
			...base,
			run,
			readAmdSysfs,
			platform: "win32",
			arch: "x64"
		})
		expect(hw.gpu.vendor).toBeNull()
		expect(run).toHaveBeenCalledTimes(1)
		expect(readAmdSysfs).not.toHaveBeenCalled()
	})
	test("a throwing run never throws out", async () => {
		const hw = await detectMachineHardware({
			...base,
			run: async () => {
				throw new Error("boom")
			},
			platform: "linux",
			arch: "x64"
		})
		expect(hw.gpu.vendor).toBeNull()
	})
	test("other platforms map to other", async () => {
		const hw = await detectMachineHardware({
			...base,
			run: async () => null,
			platform: "freebsd",
			arch: "x64"
		})
		expect(hw.platform).toBe("other")
	})
})

describe("machineHardware", () => {
	beforeEach(() => resetMachineHardwareForTests())
	test("shares one promise per process", async () => {
		const a = machineHardware()
		const b = machineHardware()
		expect(a).toBe(b)
		await a
	})
})
