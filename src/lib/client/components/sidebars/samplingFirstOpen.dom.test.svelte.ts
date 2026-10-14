/**
 * Owner note 26 (2026-10-02): "clicking large language models in the sampling
 * sidebar shows empty on first click, populated if i back out and go back in".
 *
 * The cause was ORDER. Every `samplingConfigs:` reply is gated on the server's
 * interest set, and the sidebar's `samplingConfigs:get` effect was declared
 * before its `useInterest` effects — so the mount-time ask reached the server
 * ahead of the interest sync naming `samplingConfigs:get`, and its reply was
 * dropped. Opening the category then set the SAME id, so nothing asked again.
 *
 * The view is a list column now (design 2026-10-09 D, built 10-10): the
 * category level is gone and a row IS the config. The rule it guards is the
 * same — the first click on a row renders that config — and so is the gate
 * below: a request whose reply key had no subscriber at the moment it was
 * emitted gets no answer. `useInterest` is stood in for by an `$effect`, as
 * the real one is, so declaration order means here what it means in the app.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { emitted, socket, listeners, listen } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	/** Every request, with whether its reply key was declared when it left. */
	const emitted: Array<{ event: string; payload: any; heard: boolean }> = []
	return {
		emitted,
		listeners,
		socket: {
			emit: (event: string, payload: any) =>
				emitted.push({ event, payload, heard: listeners.has(event) }),
			on: () => {},
			off: () => {}
		},
		listen: (key: string, handler: (msg: any) => void) => {
			listeners.set(key, handler)
			return () => {
				if (listeners.get(key) === handler) listeners.delete(key)
			}
		}
	}
})

vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: (key: string, handler: (msg: any) => void) => {
		$effect(() => listen(key, handler))
	}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: () => {}, info: () => {}, success: () => {} }
}))
vi.mock("./SamplingValuesForm.svelte", () => ({ default: () => {} }))

import { S } from "@serene-pub/sdk"
import { capabilityForSamplingShape } from "$lib/shared/capabilities/samplingShape"
import SamplingSidebar from "./SamplingSidebar.svelte"
import { samplingSidebarMemory } from "./samplingList"

const ROW = {
	id: 7,
	name: "Balanced",
	shape: S.textGen,
	isImmutable: false,
	values: {},
	enabled: [] as string[]
}

/** The server: answers every request whose reply someone was listening for. */
function serve() {
	for (const req of emitted.splice(0)) {
		if (!req.heard) continue
		const reply = listeners.get(req.event)
		if (req.event === "samplingConfigs:list")
			reply?.({ samplingConfigsList: [ROW] })
		if (req.event === "samplingConfigs:usedBy")
			reply?.({ jobs: [], pipelines: [] })
		if (req.event === "samplingConfigs:get" && req.payload.id === ROW.id)
			reply?.({ sampling: ROW })
	}
	flushSync()
}

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	emitted.length = 0
	listeners.clear()
	samplingSidebarMemory.selectedId = null
	document.body.innerHTML = ""
})

describe("Sampling — first open of a config", () => {
	test("a row shows its config on the FIRST click", async () => {
		const capability = capabilityForSamplingShape(S.textGen)!
		samplingSidebarMemory.selectedId = null
		app = mount(SamplingSidebar, {
			target: document.body,
			props: {},
			context: new Map([
				[
					"systemSettingsCtx",
					{
						capabilityDefaults: {
							[capability]: { samplingConfigId: ROW.id }
						}
					}
				]
			])
		})
		flushSync()
		await tick()
		serve()

		const row = [...document.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Balanced")
		)
		expect(row, "the list rendered the config's row").toBeTruthy()
		row!.click()
		flushSync()
		await tick()
		serve()
		await tick()
		serve()

		const name = document.querySelector<HTMLInputElement>("#samplingName")
		expect(name, "the config form rendered on the first open").toBeTruthy()
		expect(name!.value).toBe("Balanced")
	})
})
