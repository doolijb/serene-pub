import { afterEach, describe, expect, test, vi } from "vitest"

const calls = vi.hoisted(() => [] as Array<{ level: string; data: any }>)

vi.mock("@skeletonlabs/skeleton-svelte", () => {
	const record = (data: any) => {
		calls.push({ level: data.type ?? "create", data })
		return data.id ?? "toast:1"
	}
	const store = {
		attrs: {},
		subscribe: () => () => {},
		create: record,
		error: (data: any) => record({ ...data, type: "error" }),
		warning: (data: any) => record({ ...data, type: "warning" }),
		success: (data: any) => record({ ...data, type: "success" }),
		info: (data: any) => record({ ...data, type: "info" }),
		remove: () => {}
	}
	return { createToaster: () => store }
})

import { TOAST_DURATION_MS, toaster } from "./toaster"
import { notify, toastIdFor } from "./notify"

afterEach(() => {
	calls.length = 0
	vi.restoreAllMocks()
})

describe("toaster defaults (L4.4)", () => {
	test("errors and warnings stay 8s, successes and infos 4s", () => {
		toaster.error({ title: "a" })
		toaster.warning({ title: "b" })
		toaster.success({ title: "c" })
		toaster.info({ title: "d" })
		expect(calls.map((c) => [c.data.type, c.data.duration])).toEqual([
			["error", 8000],
			["warning", 8000],
			["success", 4000],
			["info", 4000]
		])
		expect(TOAST_DURATION_MS.error).toBe(8000)
	})

	test("a caller's own duration wins, and create() gets the default by type", () => {
		toaster.error({ title: "kept", duration: Infinity })
		toaster.create({ title: "typed", type: "success" })
		toaster.create({ title: "loading", type: "loading" })
		expect(calls[0]!.data.duration).toBe(Infinity)
		expect(calls[1]!.data.duration).toBe(4000)
		expect(calls[2]!.data.duration).toBeUndefined()
	})
})

describe("notify (L13.6)", () => {
	test("a source becomes the toast id, so a repeat replaces it", () => {
		notify.error({ title: "Ollama failed", source: "ollama" })
		notify.error({ title: "Ollama failed again", source: "ollama" })
		expect(calls.map((c) => c.data.id)).toEqual([
			toastIdFor("ollama"),
			toastIdFor("ollama")
		])
		expect(calls[1]!.data).toMatchObject({
			type: "error",
			title: "Ollama failed again",
			duration: 8000
		})
		expect(calls[1]!.data).not.toHaveProperty("source")
	})

	test("silent says nothing; fromPoll is logged, never toasted", () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => {})
		notify.success({ title: "Light mode enabled", silent: true })
		notify.error({
			title: "Ollama version failed",
			description: "Failed to connect",
			fromPoll: true
		})
		expect(calls).toEqual([])
		expect(info).toHaveBeenCalledTimes(1)
	})

	test("no source, no id: the toast stands alone", () => {
		notify.info({ title: "Saved", description: "All of it" })
		expect(calls[0]!.data).toEqual({
			type: "info",
			title: "Saved",
			description: "All of it",
			duration: 4000
		})
	})
})
