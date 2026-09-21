import { describe, expect, test } from "vitest"
import {
	capabilitiesServedBy,
	contextLabel,
	downloadSourcesFor,
	formatUptime,
	kcppExternalLine,
	kcppLoadedLine,
	kcppPerfLine,
	kcppProcessLine,
	managedConnectionIds,
	managedLabel,
	managedStage,
	managedTabs,
	ollamaStatusLine,
	ollamaUnreachableSentence,
	removeConfirmation,
	uptimeSince
} from "./managedConnectionView"

describe("managedStage", () => {
	const base = {
		managedMode: null as "managed" | "external" | null,
		hasBinary: false,
		pickerRequested: false,
		connected: false
	}
	test("Ollama has no setup screen — the card carries its one bad state", () => {
		expect(managedStage("ollama", base)).toBe("tabs")
		expect(managedStage("ollama", { ...base, connected: true })).toBe(
			"tabs"
		)
	})
	test("KoboldCPP with no mode chosen asks which", () => {
		expect(managedStage("koboldcpp", base)).toBe("kcpp-mode")
	})
	test("managed without a binary goes to the picker", () => {
		expect(
			managedStage("koboldcpp", { ...base, managedMode: "managed" })
		).toBe("kcpp-binary")
	})
	test("managed with a binary goes to the tabs", () => {
		expect(
			managedStage("koboldcpp", {
				...base,
				managedMode: "managed",
				hasBinary: true
			})
		).toBe("tabs")
	})
	test("Change binary re-opens the picker over the tabs", () => {
		expect(
			managedStage("koboldcpp", {
				...base,
				managedMode: "managed",
				hasBinary: true,
				pickerRequested: true
			})
		).toBe("kcpp-binary")
	})
	test("external is the address screen until something answers", () => {
		expect(
			managedStage("koboldcpp", { ...base, managedMode: "external" })
		).toBe("kcpp-external-setup")
		expect(
			managedStage("koboldcpp", {
				...base,
				managedMode: "external",
				connected: true
			})
		).toBe("tabs")
	})
})

describe("managedTabs", () => {
	test("four tabs, only once there are tabs", () => {
		expect(managedTabs("kcpp-mode")).toEqual([])
		expect(managedTabs("kcpp-binary")).toEqual([])
		expect(managedTabs("tabs").map((t) => t.value)).toEqual([
			"models",
			"get",
			"downloads",
			"settings"
		])
	})
	test("Get models is its own tab, not the retired Available one", () => {
		expect(managedTabs("tabs").map((t) => t.label)).toContain("Get models")
		expect(managedTabs("tabs").map((t) => t.label)).not.toContain(
			"Available"
		)
	})
})

describe("downloadSourcesFor", () => {
	test("KoboldCPP owns its models AND its binary", () => {
		expect(downloadSourcesFor("koboldcpp")).toEqual([
			"koboldcpp",
			"koboldcpp-binary"
		])
		expect(downloadSourcesFor("ollama")).toEqual(["ollama"])
	})
})

describe("kcppProcessLine", () => {
	const now = Date.parse("2026-09-17T12:04:12Z")
	test("nothing has answered — the line is left out, never guessed", () => {
		expect(kcppProcessLine({ status: null }, now)).toBeNull()
	})
	test("running says which process and for how long", () => {
		expect(
			kcppProcessLine(
				{
					status: "running",
					pid: 4321,
					startedAt: "2026-09-17T12:00:00Z"
				},
				now
			)
		).toEqual({ dot: "ok", label: "Running", meta: "PID 4321 · 4m 12s" })
	})
	test("stopped is quiet, not a fault", () => {
		const line = kcppProcessLine({ status: "stopped" }, now)
		expect(line?.dot).toBe("quiet")
		expect(line?.meta).toBeNull()
	})
	test("crashed is the one that is", () => {
		expect(kcppProcessLine({ status: "crashed", pid: null }, now)).toEqual({
			dot: "error",
			label: "Crashed",
			meta: null
		})
	})
	test("a start in the future prints no uptime", () => {
		expect(
			kcppProcessLine(
				{ status: "running", startedAt: "2099-01-01T00:00:00Z" },
				now
			)?.meta
		).toBeNull()
	})
})

describe("formatUptime / uptimeSince", () => {
	test("seconds, minutes, hours", () => {
		expect(formatUptime(12)).toBe("12s")
		expect(formatUptime(252)).toBe("4m 12s")
		expect(formatUptime(3840)).toBe("1h 04m")
	})
	test("an unparseable or absent start is no uptime at all", () => {
		expect(uptimeSince(null)).toBeNull()
		expect(uptimeSince("not a date")).toBeNull()
	})
})

describe("contextLabel", () => {
	test("thousands as k, and small windows in full", () => {
		expect(contextLabel(8192)).toBe("8k")
		expect(contextLabel(12288)).toBe("12k")
		expect(contextLabel(512)).toBe("512")
		expect(contextLabel(0)).toBeNull()
		expect(contextLabel(null)).toBeNull()
	})
})

describe("kcppLoadedLine", () => {
	test("nothing loaded says it loads itself", () => {
		expect(kcppLoadedLine(null)).toEqual({
			text: "Nothing loaded · loads on first use",
			loaded: false
		})
	})
	test("a text model carries its context window", () => {
		expect(
			kcppLoadedLine({
				text: { file: "mythomax.gguf", contextSize: 8192 }
			})
		).toEqual({
			text: "Loaded · mythomax.gguf · 8k context",
			loaded: true
		})
	})
	test("an image-only load is loaded, and has no context to report", () => {
		expect(kcppLoadedLine({ image: { file: "sdxl.gguf" } })).toEqual({
			text: "Loaded · sdxl.gguf",
			loaded: true
		})
	})
	test("both keys are read", () => {
		expect(
			kcppLoadedLine({
				text: { file: "a.gguf" },
				image: { file: "b.gguf" }
			}).text
		).toBe("Loaded · a.gguf, b.gguf")
	})
})

describe("kcppPerfLine", () => {
	test("no answer, no line", () => {
		expect(kcppPerfLine(null)).toBeNull()
	})
	test("idle with nothing generated yet drops the speed rather than printing a zero", () => {
		expect(
			kcppPerfLine({ idle: true, avgGenSpeed: 0, totalGens: 0, queue: 0 })
		).toBe("Idle · 0 generations · queue 0")
	})
	test("busy names the rate, the count and the queue", () => {
		expect(
			kcppPerfLine({
				idle: false,
				avgGenSpeed: 24.31,
				totalGens: 1,
				queue: 2
			})
		).toBe("Busy · 24.3 tok/s · 1 generation · queue 2")
	})
})

describe("kcppExternalLine", () => {
	test("reached, and not", () => {
		expect(
			kcppExternalLine({ connected: true, version: "1.97.4" })
		).toEqual({ dot: "ok", label: "Connected", meta: "1.97.4" })
		expect(kcppExternalLine({ connected: false })).toEqual({
			dot: "warning",
			label: "Not reachable",
			meta: null
		})
	})
})

describe("ollamaStatusLine", () => {
	test("nothing has answered — no line", () => {
		expect(ollamaStatusLine({ reachable: null })).toBeNull()
	})
	test("not reachable says only that", () => {
		expect(
			ollamaStatusLine({ reachable: false, version: "0.6.3" })
		).toEqual({ dot: "warning", label: "Not reachable", meta: null })
	})
	test("running names the version and the counts", () => {
		expect(
			ollamaStatusLine({
				reachable: true,
				version: "0.6.3",
				modelCount: 12,
				runningCount: 1
			})
		).toEqual({
			dot: "ok",
			label: "Running",
			meta: "0.6.3 · 12 models · 1 in memory"
		})
	})
	test("a count nobody gave is left out, and nothing resident says nothing", () => {
		expect(
			ollamaStatusLine({
				reachable: true,
				modelCount: 1,
				runningCount: 0
			})?.meta
		).toBe("1 model")
	})
})

describe("ollamaUnreachableSentence", () => {
	test("names the address and whose job the fix is", () => {
		expect(ollamaUnreachableSentence("http://box:11434")).toBe(
			"Nothing answered at http://box:11434. Ollama runs outside Serene Pub, so start it there, or point this at another machine."
		)
		expect(ollamaUnreachableSentence(null)).toContain(
			"http://localhost:11434"
		)
	})
})

describe("managedConnectionIds", () => {
	const rows = [
		{ id: 1, type: "koboldcpp_managed" },
		{ id: 2, type: "koboldcpp_managed_image" },
		{ id: 3, type: "ollama" },
		{ id: 4, type: "openai" },
		{ id: null, type: "ollama" }
	]
	test("KoboldCPP is two rows, one install", () => {
		expect(managedConnectionIds("koboldcpp", rows)).toEqual([1, 2])
	})
	test("Ollama is one, and a row with no id is not one", () => {
		expect(managedConnectionIds("ollama", rows)).toEqual([3])
	})
})

describe("capabilitiesServedBy", () => {
	test("only the transforms whose default points at these rows", () => {
		expect(
			capabilitiesServedBy([1, 2], {
				"text->text": { connectionId: 1 },
				"text->image": { connectionId: 2 },
				"text->embedding": { connectionId: 9 },
				"text->entities": { connectionId: null },
				"text->speech": undefined
			})
		).toEqual(["text->text", "text->image"])
	})
})

describe("removeConfirmation", () => {
	test("KoboldCPP promises the files stay", () => {
		const copy = removeConfirmation("koboldcpp", [])
		expect(copy.title).toBe("Remove KoboldCPP from this pub?")
		expect(copy.body).toContain("stay on disk")
		expect(copy.cost).toBeNull()
		expect(copy.confirmLabel).toBe("Remove KoboldCPP")
	})
	test("Ollama promises it keeps running", () => {
		expect(removeConfirmation("ollama", []).body).toContain(
			"Ollama itself keeps running"
		)
	})
	test("the cost names what stops, in a sentence", () => {
		expect(removeConfirmation("koboldcpp", ["Chat"]).cost).toBe(
			"KoboldCPP currently answers for Chat. Those stop until you pick another model."
		)
		expect(
			removeConfirmation("ollama", ["Chat", "Images", "Embeddings"]).cost
		).toContain("Chat, Images and Embeddings")
	})
})

describe("managedLabel", () => {
	test("what a person calls each one", () => {
		expect(managedLabel("koboldcpp")).toBe("KoboldCPP")
		expect(managedLabel("ollama")).toBe("Ollama")
	})
})
