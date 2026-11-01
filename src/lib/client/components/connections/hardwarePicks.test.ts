import { describe, expect, test } from "vitest"
import type {
	GpuVendor,
	MachineHardware,
	MachinePlatform
} from "$lib/shared/connections/machineHardware"
import {
	detectedBuild,
	detectedMemoryTier,
	formatGb,
	usableModelMemoryGb
} from "./hardwarePicks"

function hw(
	vendor: GpuVendor | null,
	opts: {
		cardGb?: number | null
		systemGb?: number
		platform?: MachinePlatform
		arch?: string
	} = {}
): MachineHardware {
	return {
		gpu: {
			vendor,
			name: vendor ? "Card" : null,
			memoryGb: opts.cardGb === undefined ? null : opts.cardGb
		},
		systemMemoryGb: opts.systemGb ?? 16,
		platform: opts.platform ?? "linux",
		arch: opts.arch ?? "x64",
		detectedAt: "2026-10-30T00:00:00.000Z"
	}
}

const v = (name: string, platform: string) => ({ name, platform })
const NEW = [
	v("koboldcpp-linux-x64", "linux"),
	v("koboldcpp-linux-x64-nocuda", "linux"),
	v("koboldcpp-linux-x64-oldpc", "linux"),
	v("koboldcpp-mac-arm64", "macos"),
	v("koboldcpp.exe", "windows"),
	v("koboldcpp-nocuda.exe", "windows"),
	v("koboldcpp-oldpc.exe", "windows")
]
const OLD = [
	v("koboldcpp_linux_x64_cu12", "linux"),
	v("koboldcpp_linux_x64_nocuda", "linux"),
	v("koboldcpp_linux_x64_rocm", "linux"),
	v("koboldcpp_win_cuda12.exe", "windows"),
	v("koboldcpp_nocuda.exe", "windows")
]

describe("formatGb", () => {
	test("snaps to a common size within 8%", () => {
		expect(formatGb(31.2)).toBe("32 GB")
		expect(formatGb(15.5)).toBe("16 GB")
		expect(formatGb(11.9)).toBe("12 GB")
		expect(formatGb(7.8)).toBe("8 GB")
	})
	test("rounds otherwise", () => {
		expect(formatGb(14)).toBe("14 GB")
		expect(formatGb(5.2)).toBe("5 GB")
	})
})

describe("usableModelMemoryGb", () => {
	test("card, unified and system shares", () => {
		expect(usableModelMemoryGb(hw("nvidia", { cardGb: 12 }))).toBe(12)
		expect(usableModelMemoryGb(hw("amd", { cardGb: null }))).toBeNull()
		expect(usableModelMemoryGb(hw("apple", { systemGb: 48 }))).toBe(32)
		expect(usableModelMemoryGb(hw(null, { systemGb: 16 }))).toBe(8)
	})
})

describe("detectedMemoryTier", () => {
	const tier = (h: MachineHardware) => detectedMemoryTier(h)?.tier ?? null
	test("NVIDIA boundaries", () => {
		expect(tier(hw("nvidia", { cardGb: 12 }))).toBe("12gb")
		expect(tier(hw("nvidia", { cardGb: 11.9 }))).toBe("12gb")
		expect(tier(hw("nvidia", { cardGb: 8 }))).toBe("8gb")
		expect(tier(hw("nvidia", { cardGb: 6 }))).toBe("4gb")
		expect(tier(hw("nvidia", { cardGb: 3 }))).toBeNull()
		expect(tier(hw("nvidia", { cardGb: 24 }))).toBe("24gb")
		expect(tier(hw("nvidia", { cardGb: 48 }))).toBe("24gb")
		expect(tier(hw("nvidia", { cardGb: null }))).toBeNull()
	})
	test("Apple and no card", () => {
		expect(tier(hw("apple", { systemGb: 32 }))).toBe("12gb")
		expect(tier(hw("apple", { systemGb: 16 }))).toBe("8gb")
		expect(tier(hw("apple", { systemGb: 64 }))).toBe("24gb")
		expect(tier(hw(null, { systemGb: 16 }))).toBe("8gb")
		expect(tier(hw(null, { systemGb: 32 }))).toBe("12gb")
		expect(tier(hw(null, { systemGb: 8 }))).toBe("4gb")
		expect(tier(hw(null, { systemGb: 4 }))).toBeNull()
	})
	test("exact reasons", () => {
		expect(detectedMemoryTier(hw("nvidia", { cardGb: 12 }))?.reason).toBe(
			"Picked because this computer has an NVIDIA card with 12 GB."
		)
		expect(detectedMemoryTier(hw("amd", { cardGb: 16 }))?.reason).toBe(
			"Picked because this computer has an AMD card with 16 GB."
		)
		expect(detectedMemoryTier(hw("apple", { systemGb: 32 }))?.reason).toBe(
			"Picked because this Mac has 32 GB of memory, and models get about two-thirds."
		)
		expect(detectedMemoryTier(hw(null, { systemGb: 16 }))?.reason).toBe(
			"Picked because no graphics card was found; this computer has 16 GB, and models get about half."
		)
	})
	test("missing hardware says nothing", () => {
		expect(detectedMemoryTier(null)).toBeNull()
		expect(detectedMemoryTier(undefined)).toBeNull()
	})
})

describe("detectedBuild", () => {
	const name = (list: typeof NEW, h: MachineHardware | null | undefined) =>
		detectedBuild(list, h)?.variant.name ?? null
	test("current release, every vendor and platform", () => {
		expect(name(NEW, hw("nvidia", { cardGb: 12 }))).toBe(
			"koboldcpp-linux-x64"
		)
		expect(name(NEW, hw("amd", { cardGb: 16 }))).toBe(
			"koboldcpp-linux-x64-nocuda"
		)
		expect(name(NEW, hw(null))).toBe("koboldcpp-linux-x64-nocuda")
		expect(name(NEW, hw("nvidia", { platform: "windows" }))).toBe(
			"koboldcpp.exe"
		)
		expect(name(NEW, hw("amd", { platform: "windows" }))).toBe(
			"koboldcpp-nocuda.exe"
		)
		expect(name(NEW, hw(null, { platform: "windows" }))).toBe(
			"koboldcpp-nocuda.exe"
		)
		expect(
			name(NEW, hw("apple", { platform: "macos", arch: "arm64" }))
		).toBe("koboldcpp-mac-arm64")
	})
	test("older underscore names", () => {
		expect(name(OLD, hw("nvidia"))).toBe("koboldcpp_linux_x64_cu12")
		expect(name(OLD, hw("amd"))).toBe("koboldcpp_linux_x64_rocm")
		expect(name(OLD, hw(null))).toBe("koboldcpp_linux_x64_nocuda")
		expect(name(OLD, hw("nvidia", { platform: "windows" }))).toBe(
			"koboldcpp_win_cuda12.exe"
		)
	})
	test("arch mismatch gets nothing", () => {
		expect(name(NEW, hw("nvidia", { arch: "arm64" }))).toBeNull()
		expect(
			name(NEW, hw("apple", { platform: "macos", arch: "x64" }))
		).toBeNull()
	})
	test("other platform or missing hardware gets nothing", () => {
		expect(name(NEW, hw(null, { platform: "other" }))).toBeNull()
		expect(name(NEW, null)).toBeNull()
		expect(name(NEW, undefined)).toBeNull()
		expect(name([], hw(null))).toBeNull()
	})
	test("exact reasons", () => {
		expect(detectedBuild(NEW, hw("nvidia"))?.reason).toBe(
			"Picked because this computer has an NVIDIA card."
		)
		expect(detectedBuild(NEW, hw("amd"))?.reason).toBe(
			"Picked because this computer has an AMD card."
		)
		expect(
			detectedBuild(
				NEW,
				hw("apple", { platform: "macos", arch: "arm64" })
			)?.reason
		).toBe("Picked because this is a Mac with Apple silicon.")
		expect(detectedBuild(NEW, hw(null))?.reason).toBe(
			"Picked because no graphics card was found; this build works on any computer."
		)
	})
})
