import { describe, expect, test } from "vitest"
import {
	acppApplyLine,
	acppBackendLabel,
	acppBuildLine,
	acppInstallState,
	acppLoadedLine,
	acppProcessLine,
	capabilitiesServedBy,
	contextLabel,
	downloadSourcesFor,
	duplicateOllamaHosts,
	formatUptime,
	kcppExternalLine,
	kcppInstallState,
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
import { connectionRowStatus } from "./connectionRowStatus"

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
	test("three tabs, only once there are tabs", () => {
		expect(managedTabs("kcpp-mode")).toEqual([])
		expect(managedTabs("kcpp-binary")).toEqual([])
		expect(managedTabs("tabs").map((t) => t.value)).toEqual([
			"models",
			"downloads",
			"settings"
		])
	})
	test("there is no Get tab (the Get more… door replaced it), nor the retired Available one", () => {
		expect(managedTabs("tabs").map((t) => t.label)).not.toContain("Get")
		expect(managedTabs("tabs", "ollama").map((t) => t.value)).not.toContain("get")
		expect(managedTabs("tabs").map((t) => t.label)).not.toContain(
			"Available"
		)
	})

	test("every label is one word, so four fit across the dock", () => {
		// "Get models" and "Downloads" rendered as "Get mo…" / "Downlo…".
		for (const tab of managedTabs("tabs"))
			expect(tab.label.split(" ")).toHaveLength(1)
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
	test("idle with nothing generated yet drops the speed AND the count rather than printing zeros or pings", () => {
		expect(
			kcppPerfLine({ idle: true, avgGenSpeed: 0, totalGens: 0, queue: 0 })
		).toBe("Idle · queue 0")
		// koboldcpp's own counter ticks for readiness pings (29 on a fresh
		// install, 2026-11-08); with no speed it has generated nothing real.
		expect(
			kcppPerfLine({ idle: true, avgGenSpeed: 0, totalGens: 29, queue: 0 })
		).toBe("Idle · queue 0")
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

// Plan 2026-09-24 A2: ONE reading of the install, shared by the index row and
// this view. The table pins both halves for every settings combination, so a
// row that says "Not installed" can never open a view that says "Stopped".
describe("kcppInstallState — the row and the view read the install once", () => {
	const cases: Array<{
		name: string
		settings: Parameters<typeof kcppInstallState>[0]
		state: ReturnType<typeof kcppInstallState>
		rowLabel: string
		rowVerb: string | null
	}> = [
		{
			name: "no settings yet",
			settings: undefined,
			state: "loading",
			rowLabel: "Checking",
			rowVerb: null
		},
		{
			name: "flag off, nothing set up",
			settings: {
				koboldCppManagerEnabled: false,
				koboldCppManagedMode: null
			},
			state: "not-installed",
			rowLabel: "Not installed",
			rowVerb: "setup"
		},
		{
			name: "flag off, managed with a binary",
			settings: {
				koboldCppManagerEnabled: false,
				koboldCppManagedMode: "managed",
				koboldCppManagedBinaryVariant: "koboldcpp-linux-x64"
			},
			state: "offline",
			rowLabel: "Offline",
			rowVerb: "start-offline"
		},
		{
			name: "flag off, managed without a binary",
			settings: {
				koboldCppManagerEnabled: false,
				koboldCppManagedMode: "managed"
			},
			state: "not-installed",
			rowLabel: "Not installed",
			rowVerb: "setup"
		},
		{
			name: "flag off, external",
			settings: {
				koboldCppManagerEnabled: false,
				koboldCppManagedMode: "external"
			},
			state: "offline",
			rowLabel: "Offline",
			rowVerb: "start-offline"
		},
		{
			name: "flag on, no mode",
			settings: {
				koboldCppManagerEnabled: true,
				koboldCppManagedMode: null
			},
			state: "no-mode",
			rowLabel: "Not set up",
			rowVerb: "setup"
		},
		{
			name: "flag on, managed without a binary",
			settings: {
				koboldCppManagerEnabled: true,
				koboldCppManagedMode: "managed"
			},
			state: "no-binary",
			rowLabel: "Not set up",
			rowVerb: "setup"
		}
	]
	for (const c of cases) {
		test(c.name, () => {
			const state = kcppInstallState(c.settings)
			expect(state).toBe(c.state)
			const row = connectionRowStatus(
				{
					id: 1,
					name: "KoboldCPP",
					type: "koboldcpp_managed",
					baseUrl: null,
					models: []
				} as any,
				{ kind: "koboldcpp-managed", kcppInstall: state }
			)
			expect(row.label).toBe(c.rowLabel)
			expect(row.action?.verb ?? null).toBe(c.rowVerb)
		})
	}
	test("flag on and set up hands over to the process status", () => {
		expect(
			kcppInstallState({
				koboldCppManagerEnabled: true,
				koboldCppManagedMode: "managed",
				koboldCppManagedBinaryVariant: "x"
			})
		).toBe("ready")
	})
})

describe("other Ollama connections on this host", () => {
	type Row = {
		id: number | null
		type: string
		baseUrl: string
		name: string
	}
	const rows: Row[] = [
		{ id: 1, type: "ollama", baseUrl: "http://localhost:11434", name: "Ollama" },
		{ id: 2, type: "ollama", baseUrl: "http://localhost:11434/", name: "Ollama embeddings" },
		{ id: 3, type: "ollama", baseUrl: "http://ollama.lan:11434", name: "Lan" },
		{ id: 4, type: "openai", baseUrl: "http://localhost:11434", name: "Compat" }
	]

	test("finds the other row on the same host, forgiving a trailing slash", () => {
		expect(duplicateOllamaHosts(rows[0], rows).map((r) => r.id)).toEqual([2])
	})

	test("never counts itself", () => {
		expect(duplicateOllamaHosts(rows[1], rows).map((r) => r.id)).toEqual([1])
	})

	test("ignores another host, and another type on the same host", () => {
		// An OpenAI-compatible row at Ollama's address is a different service.
		expect(duplicateOllamaHosts(rows[2], rows)).toEqual([])
	})

	test("says nothing for a row with no id yet", () => {
		expect(duplicateOllamaHosts({ ...rows[0], id: null }, rows)).toEqual([])
		expect(duplicateOllamaHosts(undefined, rows)).toEqual([])
	})
})

// ── audio.cpp, run by Serene Pub 🚧 (lane D, 2026-10-29) ────────────────────

describe("audio.cpp — the third kind", () => {
	const facts = {
		managedMode: null as "managed" | "external" | null,
		hasBinary: false,
		pickerRequested: false,
		connected: false
	}
	const status = (
		over: Partial<Sockets.AudioCpp.StatusView> = {}
	): Sockets.AudioCpp.StatusView => ({
		status: "running",
		pid: 4242,
		startedAt: new Date(Date.now() - 65_000).toISOString(),
		restartCount: 0,
		port: 5002,
		baseUrl: "http://127.0.0.1:5002",
		loaded: [],
		configApplied: true,
		lastError: null,
		...over
	})

	test("one stage before the tabs: the binary, never a mode", () => {
		expect(managedStage("audiocpp", facts)).toBe("acpp-binary")
		expect(managedStage("audiocpp", { ...facts, hasBinary: true })).toBe(
			"tabs"
		)
		expect(
			managedStage("audiocpp", {
				...facts,
				hasBinary: true,
				pickerRequested: true
			})
		).toBe("acpp-binary")
		// A KoboldCPP mode in the facts means nothing to audio.cpp.
		expect(
			managedStage("audiocpp", {
				...facts,
				managedMode: "external",
				hasBinary: true
			})
		).toBe("tabs")
	})

	test("tabs: Models · Process · Arriving · Settings — no Get", () => {
		expect(managedTabs("acpp-binary", "audiocpp")).toEqual([])
		expect(managedTabs("tabs", "audiocpp").map((t) => t.label)).toEqual([
			"Models",
			"Process",
			"Arriving",
			"Settings"
		])
		// The other two have three.
		expect(managedTabs("tabs").map((t) => t.value)).toEqual([
			"models",
			"downloads",
			"settings"
		])
	})

	test("label, feeds, rows and the Remove words", () => {
		expect(managedLabel("audiocpp")).toBe("audio.cpp")
		expect(downloadSourcesFor("audiocpp")).toEqual([
			"audiocpp",
			"audiocpp-binary"
		])
		expect(
			managedConnectionIds("audiocpp", [
				{ id: 1, type: "audiocpp_managed" },
				{ id: 2, type: "audiocpp" },
				{ id: 3, type: "koboldcpp_managed" }
			])
		).toEqual([1])
		const copy = removeConfirmation("audiocpp", [])
		expect(copy.title).toBe("Remove audio.cpp from this pub?")
		expect(copy.body).toContain("stops running audio.cpp")
		// KoboldCPP's words did not move when the body took the label.
		expect(removeConfirmation("koboldcpp", []).body).toContain(
			"stops running KoboldCPP"
		)
	})

	test("install state from the settings alone", () => {
		expect(acppInstallState(undefined)).toBe("loading")
		expect(
			acppInstallState({ enabled: false, binaryVariant: null })
		).toBe("not-installed")
		expect(
			acppInstallState({ enabled: false, binaryVariant: "cpu-portable" })
		).toBe("offline")
		expect(acppInstallState({ enabled: true, binaryVariant: null })).toBe(
			"no-binary"
		)
		expect(
			acppInstallState({ enabled: true, binaryVariant: "cpu-portable" })
		).toBe("ready")
	})

	test("process line: KoboldCPP's five words, crash said", () => {
		expect(acppProcessLine(null)).toBe(null)
		const running = acppProcessLine(status())!
		expect(running.dot).toBe("ok")
		expect(running.label).toBe("Running")
		expect(running.meta).toContain("PID 4242")
		const crashed = acppProcessLine(
			status({ status: "crashed", pid: null, lastError: "exit 1" })
		)!
		expect(crashed.dot).toBe("error")
		expect(crashed.meta).toBe("exit 1")
		expect(acppProcessLine(status({ status: "stopped" }))!.dot).toBe(
			"quiet"
		)
	})

	test("loaded line: lazy load makes nothing loaded the idle state", () => {
		expect(acppLoadedLine(status()).loaded).toBe(false)
		expect(acppLoadedLine(status()).text).toBe(
			"Nothing loaded · loads on first use"
		)
		const line = acppLoadedLine(
			status({
				loaded: [
					{ id: "kokoro_82m_q8_0", device: "cpu" },
					{ id: "parakeet_tdt_0_6b_v3_q8_0" }
				]
			})
		)
		expect(line.loaded).toBe(true)
		expect(line.text).toBe(
			"Loaded · kokoro_82m_q8_0 (cpu), parakeet_tdt_0_6b_v3_q8_0"
		)
		// A stopped process holds nothing, whatever the last list said.
		expect(
			acppLoadedLine(
				status({ status: "stopped", loaded: [{ id: "x" }] })
			).loaded
		).toBe(false)
	})

	test("build line and backend words; unverified is said", () => {
		expect(acppBackendLabel("cuda")).toBe("CUDA")
		expect(acppBackendLabel(null)).toBe(null)
		expect(
			acppBuildLine({ version: "v0.9.3", backend: "cpu", verified: true })
		).toBe("v0.9.3 · CPU")
		expect(
			acppBuildLine({
				releaseTag: "v0.9.3",
				backend: "vulkan",
				verified: false
			})
		).toBe("v0.9.3 · Vulkan · unverified")
		expect(acppBuildLine({})).toBe(null)
	})

	test("apply line only while the process is moving onto the new file", () => {
		expect(acppApplyLine(status())).toBe(null)
		expect(acppApplyLine(status({ configApplied: false }))).toBe(
			"Restarting to apply"
		)
		expect(
			acppApplyLine(status({ status: "stopping", configApplied: false }))
		).toBe("Restarting to apply")
		// A Stop someone pressed is not a restart.
		expect(acppApplyLine(status({ status: "stopping" }))).toBe(null)
		expect(
			acppApplyLine(status({ status: "stopped", configApplied: false }))
		).toBe(null)
		expect(acppApplyLine(null)).toBe(null)
	})
})
