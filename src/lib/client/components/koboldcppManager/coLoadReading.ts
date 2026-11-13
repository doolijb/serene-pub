import type { MachineHardware } from "$lib/shared/connections/machineHardware"

/**
 * True when this machine gives no free graphics-memory reading, so the co-load
 * decision can never find room and the two models always swap.
 *
 * Free graphics memory is read with `nvidia-smi` only (`freeGpuMemoryGib`,
 * `connections/hardware.ts`); `gpu.vendor === "nvidia"` means nvidia-smi
 * answered at boot. `undefined` is "not answered yet", so say nothing.
 */
export function coLoadUnmeasured(
	hw: MachineHardware | null | undefined
): boolean {
	return hw !== undefined && hw?.gpu.vendor !== "nvidia"
}
