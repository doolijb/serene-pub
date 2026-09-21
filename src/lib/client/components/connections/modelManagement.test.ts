import { describe, expect, test } from "vitest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	endpointKind,
	formatBytes,
	formatMegabytes,
	formatProgress,
	formatTokens,
	managerFor,
	manualAddAllowed,
	modelsSourceHint,
	orderOnnxRows,
	removeAllowed,
	rowAction,
	type EndpointKind
} from "./modelManagement"

describe("managerFor", () => {
	test("Ollama and managed KoboldCPP endpoints are manager-owned", () => {
		expect(managerFor(CONNECTION_TYPE.OLLAMA)?.panel).toBe("ollama")
		expect(managerFor(CONNECTION_TYPE.OLLAMA_EMBEDDINGS)?.panel).toBe(
			"ollama"
		)
		expect(managerFor(CONNECTION_TYPE.KOBOLDCPP_MANAGED)?.panel).toBe(
			"koboldcpp"
		)
		expect(managerFor(CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE)?.panel).toBe(
			"koboldcpp"
		)
	})

	test("a plain KoboldCPP or any API endpoint has no manager", () => {
		expect(managerFor(CONNECTION_TYPE.KOBOLDCPP)).toBeNull()
		expect(managerFor(CONNECTION_TYPE.OPENAI)).toBeNull()
		expect(managerFor(undefined)).toBeNull()
	})
})

describe("manualAddAllowed / removeAllowed", () => {
	test("hand-named models are allowed where the listing can be incomplete", () => {
		for (const type of [
			CONNECTION_TYPE.OPENAI,
			CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			CONNECTION_TYPE.ANTHROPIC,
			CONNECTION_TYPE.LLAMACPP,
			CONNECTION_TYPE.LM_STUDIO,
			CONNECTION_TYPE.KOBOLDCPP,
			CONNECTION_TYPE.A1111
		]) {
			expect(manualAddAllowed(type)).toBe(true)
			expect(removeAllowed(type)).toBe(true)
			expect(modelsSourceHint(type)).toBeNull()
		}
	})

	test("manager-owned and local ONNX endpoints offer neither, and say why", () => {
		for (const type of [
			CONNECTION_TYPE.OLLAMA,
			CONNECTION_TYPE.OLLAMA_EMBEDDINGS,
			CONNECTION_TYPE.KOBOLDCPP_MANAGED,
			CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE,
			CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
			CONNECTION_TYPE.LOCAL_ONNX_NER
		]) {
			expect(manualAddAllowed(type)).toBe(false)
			expect(removeAllowed(type)).toBe(false)
			expect(modelsSourceHint(type)).toBeTruthy()
		}
	})

	test("unknown means nothing offered", () => {
		expect(manualAddAllowed(undefined)).toBe(false)
		expect(modelsSourceHint(undefined)).toBeNull()
	})
})

describe("endpointKind", () => {
	test("the four shaped kinds, and everything else", () => {
		expect(endpointKind(CONNECTION_TYPE.KOBOLDCPP_MANAGED)).toBe(
			"koboldcpp-managed"
		)
		expect(endpointKind(CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE)).toBe(
			"koboldcpp-managed"
		)
		expect(endpointKind(CONNECTION_TYPE.OLLAMA)).toBe("ollama")
		expect(endpointKind(CONNECTION_TYPE.OLLAMA_EMBEDDINGS)).toBe("ollama")
		expect(endpointKind(CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS)).toBe(
			"onnx-embeddings"
		)
		expect(endpointKind(CONNECTION_TYPE.LOCAL_ONNX_NER)).toBe(
			"onnx-entities"
		)
		// A plain KoboldCPP is an API endpoint: nothing here runs the process.
		expect(endpointKind(CONNECTION_TYPE.KOBOLDCPP)).toBe("api")
		expect(endpointKind(CONNECTION_TYPE.OPENAI)).toBe("api")
		expect(endpointKind(undefined)).toBe("api")
	})
})

describe("rowAction", () => {
	const onnx: EndpointKind[] = ["onnx-embeddings", "onnx-entities"]

	test("a local ONNX row's action follows its files", () => {
		for (const kind of onnx) {
			expect(
				rowAction(kind, {
					model: "bge",
					local: { state: "not_downloaded" }
				})
			).toEqual({ verb: "download", label: "Download" })
			expect(
				rowAction(kind, {
					model: "bge",
					local: { state: "downloading" }
				})
			).toEqual({ verb: "cancel", label: "Cancel" })
			expect(
				rowAction(kind, { model: "bge", local: { state: "error" } })
			).toEqual({ verb: "retry", label: "Retry" })
			expect(
				rowAction(kind, { model: "bge", local: { state: "on_disk" } })
			).toEqual({ verb: "makeActive", label: "Make active" })
		}
	})

	test("the active model on disk has nothing left to do", () => {
		expect(
			rowAction(
				"onnx-embeddings",
				{ model: "bge", local: { state: "on_disk" } },
				{ isDefault: true }
			)
		).toBeNull()
	})

	test("a local row the server has not answered for offers nothing", () => {
		// Silence is not "not downloaded": an action guessed from it fails on
		// press. The row still opens.
		expect(rowAction("onnx-embeddings", { model: "bge" })).toBeNull()
		expect(
			rowAction("onnx-entities", { model: "bge", local: null })
		).toBeNull()
	})

	test("a managed KoboldCPP row offers Load, and Cancel while downloading", () => {
		expect(rowAction("koboldcpp-managed", { model: "a.gguf" })).toEqual({
			verb: "load",
			label: "Load"
		})
		expect(
			rowAction(
				"koboldcpp-managed",
				{ model: "a.gguf" },
				{ kcppLoaded: true }
			)
		).toBeNull()
		expect(
			rowAction(
				"koboldcpp-managed",
				{ model: "a.gguf" },
				{ kcppDownloading: true, kcppLoaded: true }
			)
		).toEqual({ verb: "cancelKcpp", label: "Cancel" })
	})

	test("Ollama and API rows carry no action — their door is elsewhere", () => {
		expect(rowAction("ollama", { model: "llama3.1:8b" })).toBeNull()
		expect(
			rowAction("api", { model: "gpt-4o" }, { isDefault: false })
		).toBeNull()
	})
})

describe("orderOnnxRows", () => {
	function row(
		name: string,
		tier?: "fast" | "balanced" | "best",
		sizeMb?: number
	) {
		return { name, local: { catalog: { tier, sizeMb } } }
	}

	test("within a tier, smaller comes before bigger", () => {
		const groups = orderOnnxRows([
			row("EmbeddingGemma-300M", "balanced", 334),
			row("bge-base-en-v1.5", "balanced", 111)
		])
		expect(groups).toEqual([
			{
				tier: "balanced",
				rows: [
					row("bge-base-en-v1.5", "balanced", 111),
					row("EmbeddingGemma-300M", "balanced", 334)
				]
			}
		])
	})

	test("tiers render Fast, Balanced, Best, then rows without a tier last", () => {
		const groups = orderOnnxRows([
			row("added-model"),
			row("best-model", "best", 900),
			row("fast-model", "fast", 90),
			row("balanced-model", "balanced", 300)
		])
		expect(groups.map((g) => g.tier)).toEqual([
			"fast",
			"balanced",
			"best",
			"added"
		])
	})

	test("a row with no size sorts after every sized row in its tier, then by name", () => {
		const groups = orderOnnxRows([
			row("z-no-size", "fast"),
			row("b-sized", "fast", 200),
			row("a-no-size", "fast")
		])
		expect(groups[0].rows.map((r) => r.name)).toEqual([
			"b-sized",
			"a-no-size",
			"z-no-size"
		])
	})

	test("an empty list yields no groups", () => {
		expect(orderOnnxRows([])).toEqual([])
	})
})

describe("size and token formatting", () => {
	test("decimal units, one decimal only above a gigabyte", () => {
		expect(formatBytes(1_200_000_000)).toBe("1.2 GB")
		expect(formatBytes(420_000_000)).toBe("420 MB")
		expect(formatBytes(980_000)).toBe("980 kB")
		expect(formatBytes(null)).toBeNull()
		expect(formatBytes(-1)).toBeNull()
	})

	test("the recommended list's megabytes climb the same ladder", () => {
		expect(formatMegabytes(133)).toBe("133 MB")
		expect(formatMegabytes(1_400)).toBe("1.4 GB")
		expect(formatMegabytes(undefined)).toBeNull()
	})

	test("token counts read as people say them, on both ladders", () => {
		expect(formatTokens(8192)).toBe("8k")
		expect(formatTokens(32_768)).toBe("32k")
		expect(formatTokens(512)).toBe("512")
		expect(formatTokens(128_000)).toBe("128k")
		expect(formatTokens(200_000)).toBe("200k")
		expect(formatTokens(0)).toBeNull()
	})

	test("progress needs a total, or it says nothing", () => {
		expect(formatProgress(400_000_000, 1_200_000_000, "GB")).toBe(
			"0.4 of 1.2 GB"
		)
		expect(formatProgress(0, 133_000_000, "MB")).toBe("0.0 of 133 MB")
		expect(formatProgress(10, 0, "MB")).toBeNull()
		expect(formatProgress(10, undefined, "GB")).toBeNull()
	})
})
