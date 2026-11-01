import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

import AudioCppProcessTab from "./AudioCppProcessTab.svelte"

const mounted: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of mounted.splice(0)) unmount(app)
	document.body.innerHTML = ""
})

const status = (over: Record<string, unknown> = {}) => ({
	status: "running",
	pid: 1234,
	startedAt: new Date().toISOString(),
	restartCount: 0,
	isExternal: false,
	port: 5002,
	baseUrl: "http://127.0.0.1:5002",
	version: "v0.9.3",
	backend: "cpu",
	loaded: [{ id: "kokoro", device: "CPU" }],
	configApplied: true,
	lastError: null,
	...over
})

function render(props: Record<string, unknown>) {
	const target = document.createElement("div")
	document.body.appendChild(target)
	const fns = { onStart: vi.fn(), onStop: vi.fn(), onRestart: vi.fn() }
	mounted.push(
		mount(AudioCppProcessTab, {
			target,
			props: {
				status: null,
				install: null,
				offline: false,
				busy: null,
				...fns,
				...props
			} as any
		})
	)
	flushSync()
	const buttons = () =>
		Array.from(target.querySelectorAll("button")).map((b) => ({
			text: (b.textContent ?? "").trim(),
			disabled: (b as HTMLButtonElement).disabled
		}))
	return { text: () => target.textContent ?? "", buttons, fns }
}

describe("AudioCppProcessTab", () => {
	test("running: Restart and Stop, loaded list", () => {
		const r = render({ status: status() })
		const names = r.buttons().map((b) => b.text)
		expect(names.includes("Restart")).toBe(true)
		expect(names.includes("Stop")).toBe(true)
		expect(names.includes("Start")).toBe(false)
		expect(r.text().includes("kokoro")).toBe(true)
		expect(r.text().includes("CPU")).toBe(true)
	})

	test("stopped: Start is offered, not Restart", () => {
		const r = render({ status: status({ status: "stopped", pid: null }) })
		const names = r.buttons().map((b) => b.text)
		expect(names.includes("Start")).toBe(true)
		expect(names.includes("Restart")).toBe(false)
	})

	test("external: Stop disabled with the reason", () => {
		const r = render({ status: status({ isExternal: true }) })
		const stop = r.buttons().find((b) => b.text === "Stop")
		expect(stop?.disabled).toBe(true)
		expect(
			r
				.text()
				.includes(
					"Serene Pub did not start this audio.cpp, so it cannot stop it."
				)
		).toBe(true)
	})

	test("config not applied while running says Restarting to apply", () => {
		const r = render({ status: status({ configApplied: false }) })
		expect(r.text().includes("Restarting to apply")).toBe(true)
	})

	test("unverified install says so", () => {
		const r = render({
			status: status(),
			install: { installed: true, binaryPath: "/x", verified: false }
		})
		expect(r.text().includes("installed without a published checksum")).toBe(
			true
		)
	})

	test("offline: switched-off sentence and Start; null status: not checked", () => {
		const off = render({ offline: true, status: null })
		expect(off.text().includes("audio.cpp is switched off.")).toBe(true)
		expect(off.buttons().some((b) => b.text === "Start")).toBe(true)
		const none = render({ status: null })
		expect(none.text().includes("Not checked yet")).toBe(true)
	})
})
