/**
 * Connection forms edit `connection.extraJson` through local field state
 * (plan PLAN-connections-bugfix-2026-10-11, batch B):
 *
 * - opening a form never writes into the draft (the sidebar compares it to
 *   its baseline, so a write on mount reads as unsaved changes);
 * - an edit MERGES over `extraJson`, so keys another form or the server owns
 *   (`profile`) survive (B1);
 * - a draft replaced from outside re-seeds the fields without writing (B7);
 * - emptied number inputs remove their key instead of saving null (B4, B5);
 * - Ollama's keep-alive round-trips "0m" and "-1" (B4);
 * - both KoboldCPP forms draw every switch with the same one-line help, from
 *   `connectionFieldWords` (PLAN-less-confusing I2).
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { listeners, socket } = vi.hoisted(() => {
	const listeners = new Map<string, Set<(msg: any) => void>>()
	return {
		listeners,
		socket: { emit: () => {}, on: () => {}, off: () => {} }
	}
})
const listen = (key: string, handler: (msg: any) => void) => {
	let set = listeners.get(key)
	if (!set) listeners.set(key, (set = new Set()))
	set.add(handler)
	return () => set!.delete(handler)
}
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket,
	typedSocketOrNull: () => socket
}))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (k: string, h: (m: any) => void) => listen(k, h),
	useInterest: (k: string, h: (m: any) => void) => listen(k, h),
	requestWithInterest: () => () => {}
}))
vi.mock("$lib/client/stores/completionTemplateOptions.svelte", () => ({
	completionTemplateOptions: () => ({ value: [] })
}))
vi.mock("$lib/client/stores/connectionWireMode.svelte", () => ({
	connectionWireMode: () => ({ of: () => "chat" })
}))
vi.mock("$lib/client/components/inputs/Select.svelte", () => ({
	default: () => {}
}))

import KoboldCppManagedForm from "./KoboldCppManagedForm.svelte"
import KoboldCppForm from "./KoboldCppForm.svelte"
import {
	KOBOLDCPP_FLASH_ATTENTION,
	KOBOLDCPP_REQUEST_SWITCHES,
	PROMPT_FORMAT,
	TOKEN_COUNTER
} from "./connectionFieldWords"
import OllamaForm from "./OllamaForm.svelte"
import AnthropicForm from "./AnthropicForm.svelte"
import ImageConnectionForm from "./ImageConnectionForm.svelte"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

let view: ReturnType<typeof mount> | null = null
let target: HTMLElement

function mountForm(component: any, connection: Record<string, any>) {
	const holder = $state({ connection })
	target = document.createElement("div")
	document.body.appendChild(target)
	view = mount(component, {
		target,
		props: {
			get connection() {
				return holder.connection
			},
			set connection(v) {
				holder.connection = v
			}
		}
	})
	flushSync()
	return holder
}

const snapshot = (v: unknown) => JSON.parse(JSON.stringify(v))

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
	el.value = value
	el.dispatchEvent(new Event("input", { bubbles: true }))
	el.dispatchEvent(new Event("change", { bubbles: true }))
	flushSync()
}

afterEach(() => {
	if (view) unmount(view)
	view = null
	target?.remove()
	listeners.clear()
})

describe("KoboldCPP, run by Serene Pub", () => {
	const row = () => ({
		id: 7,
		type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
		tokenCounter: "estimate",
		extraJson: {
			useMemory: true,
			memory: "old",
			profile: { sampler: "euler" },
			managedConfig: { gpuLayers: 20, batchSize: 256 }
		}
	})

	test("opening the form writes nothing into the draft", () => {
		const before = row()
		const holder = mountForm(KoboldCppManagedForm, row())
		expect(snapshot(holder.connection)).toEqual(before)
	})

	test("a text edit keeps extraJson.profile (merge, never replace)", () => {
		const holder = mountForm(KoboldCppManagedForm, row())
		typeInto(target.querySelector("#memory") as HTMLTextAreaElement, "new")
		const extraJson = snapshot(holder.connection.extraJson)
		expect(extraJson.memory).toBe("new")
		expect(extraJson.profile).toEqual({ sampler: "euler" })
	})

	test("an emptied number input drops its managedConfig key", () => {
		const holder = mountForm(KoboldCppManagedForm, row())
		typeInto(target.querySelector("#gpuLayers") as HTMLInputElement, "")
		const managed = snapshot(holder.connection.extraJson).managedConfig
		expect("gpuLayers" in managed).toBe(false)
		expect(managed.batchSize).toBe(256)
	})

	test("a draft replaced from outside re-seeds the fields without writing", () => {
		const holder = mountForm(KoboldCppManagedForm, row())
		const replaced = row()
		replaced.extraJson.memory = "saved elsewhere"
		holder.connection = replaced
		flushSync()
		expect(
			(target.querySelector("#memory") as HTMLTextAreaElement).value
		).toBe("saved elsewhere")
		expect(snapshot(holder.connection)).toEqual(snapshot(replaced))
		// …and the next real edit still writes through.
		typeInto(target.querySelector("#memory") as HTMLTextAreaElement, "x")
		expect(holder.connection.extraJson.memory).toBe("x")
	})
})

describe("Ollama keep-alive", () => {
	const row = (keepAlive?: string) => ({
		id: 3,
		type: CONNECTION_TYPE.OLLAMA,
		baseUrl: "http://localhost:11434",
		tokenCounter: "estimate",
		extraJson: {
			stream: true,
			...(keepAlive === undefined ? {} : { keepAlive }),
			legacy: "kept"
		}
	})
	const number = () =>
		target.querySelector("#keepAliveNumber") as HTMLInputElement

	test.each([
		["0m", "0"],
		["-1", "-1"],
		["30s", "30"]
	])("%s is shown losslessly and not rewritten on open", (stored, shown) => {
		const before = row(stored)
		const holder = mountForm(OllamaForm, row(stored))
		expect(number().value).toBe(shown)
		expect(snapshot(holder.connection)).toEqual(before)
	})

	test("-1 survives an unrelated edit unchanged", () => {
		const holder = mountForm(OllamaForm, row("-1"))
		typeInto(number(), "-1")
		expect(holder.connection.extraJson.keepAlive).toBe("-1")
		expect(holder.connection.extraJson.legacy).toBe("kept")
	})

	test("an emptied number omits keepAlive (the adapter's 5m applies)", () => {
		const holder = mountForm(OllamaForm, row("10m"))
		typeInto(number(), "")
		expect("keepAlive" in holder.connection.extraJson).toBe(false)
		expect(holder.connection.extraJson.legacy).toBe("kept")
	})
})

describe("Anthropic", () => {
	test("opening the form writes nothing into the draft", () => {
		const row = () => ({
			id: 4,
			type: CONNECTION_TYPE.ANTHROPIC,
			tokenCounter: "estimate",
			extraJson: { apiKey: "k", legacy: 1 }
		})
		const holder = mountForm(AnthropicForm, row())
		expect(snapshot(holder.connection)).toEqual(row())
	})

	test("only this connection's test result is shown (B6)", () => {
		mountForm(AnthropicForm, {
			id: 4,
			type: CONNECTION_TYPE.ANTHROPIC,
			tokenCounter: "estimate",
			extraJson: { apiKey: "k" }
		})
		const send = (msg: Record<string, unknown>) => {
			for (const h of listeners.get("connections:test") ?? []) h(msg)
			flushSync()
		}
		send({ ok: false, error: "not mine", connectionId: 99 })
		expect(target.textContent).not.toContain("not mine")
		send({ ok: false, error: "mine", connectionId: 4 })
		expect(target.textContent).toContain("mine")
	})
})

describe("image backend settings", () => {
	test("the declared defaults are shown, never written into the draft (B2)", () => {
		const row = () => ({
			id: 9,
			type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
			tokenCounter: "estimate",
			extraJson: null as Record<string, unknown> | null
		})
		const holder = mountForm(ImageConnectionForm, row())
		for (const h of listeners.get("images:profileSchema") ?? [])
			h({
				type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
				schema: { sampler: { type: "string", label: "Sampler" } },
				defaults: { sampler: "euler" }
			})
		flushSync()
		expect(snapshot(holder.connection)).toEqual(row())
		const sampler = target.querySelector("#sf-sampler") as HTMLInputElement
		expect(sampler?.value).toBe("euler")
	})
})

describe("KoboldCPP switches say what they do (I2)", () => {
	const row = (type: string) => ({
		id: 11,
		type,
		baseUrl: "http://localhost:5001",
		tokenCounter: "estimate",
		extraJson: {}
	})

	test.each([
		["KoboldCPP", KoboldCppForm, CONNECTION_TYPE.KOBOLDCPP],
		[
			"KoboldCPP, run by Serene Pub",
			KoboldCppManagedForm,
			CONNECTION_TYPE.KOBOLDCPP_MANAGED
		]
	])("%s draws every switch with its help line", (_name, form, type) => {
		mountForm(form, row(type))
		const body = target.textContent ?? ""
		for (const s of KOBOLDCPP_REQUEST_SWITCHES) {
			expect(body, s.key).toContain(s.label)
			expect(body, s.key).toContain(s.help)
		}
		expect(body).toContain(TOKEN_COUNTER.help)
	})

	test("Flash attention has its help line where it is drawn", () => {
		mountForm(KoboldCppManagedForm, row(CONNECTION_TYPE.KOBOLDCPP_MANAGED))
		expect(target.textContent).toContain(KOBOLDCPP_FLASH_ATTENTION.help)
	})

	test("each help is one plain sentence, sentence-case label, no em-dash", () => {
		const all = [
			...KOBOLDCPP_REQUEST_SWITCHES,
			KOBOLDCPP_FLASH_ATTENTION,
			PROMPT_FORMAT,
			TOKEN_COUNTER
		]
		for (const w of all) {
			expect(w.help, w.label).not.toMatch(/[—\n]/)
			expect(w.help, w.label).toMatch(/\.$/)
			expect(w.help, w.label).not.toMatch(/\.\s+[A-Z]/)
			expect(w.label.slice(1), w.label).not.toMatch(/\b[A-Z][a-z]/)
		}
	})
})
