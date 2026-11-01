/**
 * 🚧 What the computer Serene Pub runs on has for running models — its
 * graphics card, if one answered, and its memory — as one client-safe shape.
 *
 * Detected once per boot on the server (`server/connections/hardware.ts`) and
 * answered on `models:machineHardware`. The finder and the KoboldCPP build
 * picker read it to PROPOSE an answer and say why; the person's own answer
 * (the **memory tier** in `localStorage`, a build they clicked) always wins.
 *
 * ⚠ A fact about the machine the pub runs on, which is where a managed
 * KoboldCPP or Ollama loads its models — not about the device the page is
 * open on. ⚠ Not the **memory tier** (`memoryTier.ts`): that is the person's
 * answer; this is what detection found, and a tier is only derived from it.
 *
 * ⚠ Silence is not "none". `gpu.vendor: null` means no probe answered (no
 * `nvidia-smi`, no `rocm-smi`, no AMD card in sysfs), never that the machine
 * has no graphics card; copy says "no graphics card was found".
 */

/** Who made the graphics card that answered, or null when none did. */
export type GpuVendor = "nvidia" | "amd" | "apple"

/** Exactly the KoboldCPP build list's `platform` words. */
export type MachinePlatform = "linux" | "windows" | "macos" | "other"

export interface MachineHardware {
	gpu: {
		vendor: GpuVendor | null
		/** The card's own name as its tool printed it, or null. */
		name: string | null
		/**
		 * The card's memory in GiB (one decimal), or null when unknown. Apple
		 * silicon has no card memory of its own: null there, and
		 * `systemMemoryGb` is the unified memory.
		 */
		memoryGb: number | null
	}
	/** `os.totalmem()` in GiB, one decimal. */
	systemMemoryGb: number
	platform: MachinePlatform
	/** `process.arch`: `x64`, `arm64`, … */
	arch: string
	/** ISO time the probes ran. */
	detectedAt: string
}
