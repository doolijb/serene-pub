/**
 * 🚧 What the finder and the KoboldCPP build picker propose from the machine.
 *
 * Both ask a question the server can answer itself: "how much memory
 * does this computer have?" and "which build is mine?". The server detects the
 * graphics card and the memory once per boot (`machineHardware.ts`); this
 * module turns that into a proposed **memory tier** and a proposed build, each
 * with one plain sentence saying why.
 *
 * ⚠ It only PROPOSES. A tier the person chose (`readStoredMemoryTier`) and a
 * build they clicked always win; nothing here writes storage or selects
 * anything. And pickers explain why: every proposal carries its reason, which
 * the view prints beside the choice rather than leaving it a silent default.
 *
 * Pure: no Svelte, no socket, so every rule below is a plain test.
 */
import type { MachineHardware } from "$lib/shared/connections/machineHardware"
import type { MemoryTier } from "./memoryTier"

const COMMON_SIZES = [
	2, 3, 4, 6, 8, 10, 11, 12, 16, 20, 24, 32, 36, 48, 64, 96, 128, 192, 256
]

/** A memory size as a person reads it: 31.2 reads "32 GB", not "31 GB". */
export function formatGb(gb: number): string {
	for (const size of COMMON_SIZES) {
		if (Math.abs(gb - size) <= size * 0.08) return `${size} GB`
	}
	return `${Math.round(gb)} GB`
}

/**
 * The GiB a model can use here, or null when that is not known.
 * Apple shares system memory with the GPU (macOS gives it about two-thirds by
 * default); with no card the system and the app keep half.
 */
export function usableModelMemoryGb(hw: MachineHardware): number | null {
	switch (hw.gpu.vendor) {
		case "nvidia":
		case "amd":
			return hw.gpu.memoryGb
		case "apple":
			return (hw.systemMemoryGb * 2) / 3
		default:
			return hw.systemMemoryGb / 2
	}
}

const TIER_STEPS: readonly { tier: MemoryTier; gb: number }[] = [
	{ tier: "24gb", gb: 24 },
	{ tier: "12gb", gb: 12 },
	{ tier: "8gb", gb: 8 },
	{ tier: "4gb", gb: 4 }
]

function tierReason(hw: MachineHardware): string {
	switch (hw.gpu.vendor) {
		case "nvidia":
			return `Picked because this computer has an NVIDIA card with ${formatGb(hw.gpu.memoryGb ?? 0)}.`
		case "amd":
			return `Picked because this computer has an AMD card with ${formatGb(hw.gpu.memoryGb ?? 0)}.`
		case "apple":
			return `Picked because this Mac has ${formatGb(hw.systemMemoryGb)} of memory, and models get about two-thirds.`
		default:
			return `Picked because no graphics card was found; this computer has ${formatGb(hw.systemMemoryGb)}, and models get about half.`
	}
}

/** The tier this machine suggests, and why; null when it cannot say. */
export function detectedMemoryTier(
	hw: MachineHardware | null | undefined
): { tier: MemoryTier; reason: string } | null {
	if (!hw) return null
	const usable = usableModelMemoryGb(hw)
	if (usable == null || usable < 3.5) return null
	const step = TIER_STEPS.find((s) => s.gb <= usable + 0.5)
	return step ? { tier: step.tier, reason: tierReason(hw) } : null
}

function tokensOf(name: string): string[] {
	return name
		.toLowerCase()
		.replace(/\.exe$/, "")
		.split(/[-_]/)
		.filter(Boolean)
}

const X64 = ["x64", "amd64"]
const ARM64 = ["arm64", "aarch64"]

function archOk(tokens: string[], name: string, hw: MachineHardware): boolean {
	const hasX = tokens.some((t) => X64.includes(t))
	const hasArm = tokens.some((t) => ARM64.includes(t))
	if (hasX && hasArm) return true
	const wantArm = ARM64.includes(hw.arch) || hw.arch === "arm64"
	if (hasArm) return wantArm
	if (hasX) return !wantArm
	// No arch token: a Windows .exe is x64; anything else is left alone.
	if (hw.platform === "windows" && name.toLowerCase().endsWith(".exe"))
		return !wantArm
	return true
}

const NOT_FULL = [
	"nocuda",
	"oldpc",
	"rocm",
	"vulkan",
	"opencl",
	"clblast",
	"metal",
	"mac"
]

/** The build to propose from a release's list, and why; null when none fits. */
export function detectedBuild<V extends { name: string; platform: string }>(
	variants: readonly V[],
	hw: MachineHardware | null | undefined
): { variant: V; reason: string } | null {
	if (!hw || hw.platform === "other") return null
	const pool = variants
		.filter((v) => v.platform === hw.platform)
		.map((v) => ({ v, tokens: tokensOf(v.name) }))
		.filter((c) => archOk(c.tokens, c.v.name, hw))
	const has = (c: { tokens: string[] }, ...words: string[]) =>
		c.tokens.some((t) => words.includes(t))
	const full = () =>
		pool.find((c) => !NOT_FULL.some((w) => c.tokens.includes(w)))
	let found: { v: V } | undefined
	let reason = ""
	switch (hw.gpu.vendor) {
		case "nvidia":
			found = pool.find((c) => has(c, "cuda", "cu12", "cu11")) ?? full()
			reason = "Picked because this computer has an NVIDIA card."
			break
		case "amd":
			found =
				pool.find((c) => has(c, "rocm")) ??
				pool.find((c) => has(c, "nocuda")) ??
				full()
			reason = "Picked because this computer has an AMD card."
			break
		case "apple":
			found = pool.find((c) => has(c, "mac", "macos", "metal"))
			reason = "Picked because this is a Mac with Apple silicon."
			break
		default:
			found = pool.find((c) => has(c, "nocuda")) ?? full()
			reason =
				"Picked because no graphics card was found; this build works on any computer."
	}
	return found ? { variant: found.v, reason } : null
}
