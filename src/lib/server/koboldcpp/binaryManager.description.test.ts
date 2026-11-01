import { describe, expect, test } from "vitest"
import { makeDescription } from "./binaryManager"

describe("makeDescription — the KoboldCPP release's real asset names (v1.123.1)", () => {
	test("the full builds say NVIDIA, on Windows and on Linux", () => {
		for (const name of ["koboldcpp.exe", "koboldcpp-linux-x64"])
			expect(makeDescription(name)).toBe(
				"NVIDIA graphics cards (CUDA 12); also works with other cards or none"
			)
	})

	test("the -nocuda builds say other cards or none", () => {
		for (const name of [
			"koboldcpp-nocuda.exe",
			"koboldcpp-linux-x64-nocuda"
		])
			expect(makeDescription(name)).toBe(
				"Other graphics cards (Vulkan) or no graphics card; smaller download"
			)
	})

	test("the -oldpc builds say older computers", () => {
		for (const name of ["koboldcpp-oldpc.exe", "koboldcpp-linux-x64-oldpc"])
			expect(makeDescription(name)).toBe(
				"Older computers and older NVIDIA cards (CUDA 11)"
			)
	})

	test("the Mac build says Metal", () => {
		expect(makeDescription("koboldcpp-mac-arm64")).toBe("Metal (Apple GPU)")
	})

	test("older release names keep their words", () => {
		expect(makeDescription("koboldcpp_cu12.exe")).toBe("NVIDIA CUDA 12.x")
		expect(makeDescription("koboldcpp_rocm.exe")).toBe("AMD ROCm (GPU)")
		expect(makeDescription("koboldcpp_something")).toBe("CPU")
	})
})
