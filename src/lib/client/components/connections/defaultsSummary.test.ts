import { describe, expect, test } from "vitest"
import { TRANSFORMS } from "@serene-pub/sdk"
import {
	defaultsSummary,
	groupDefaultsByOutputKind,
	pairState,
	resolvePair,
	type SummaryConnection,
	type SummaryModel
} from "./defaultsSummary"

const model = (over: Partial<SummaryModel> = {}): SummaryModel => ({
	id: 11,
	name: "llama3.1:8b",
	enabled: true,
	missingSince: null,
	...over
})

const rows: SummaryConnection[] = [
	{ id: 1, name: "Ollama (local)", models: [model(), model({ id: 12 })] },
	{
		id: 2,
		name: "Local embeddings",
		models: [
			model({
				id: 21,
				name: "bge-small",
				local: { state: "on_disk", loaded: false }
			}),
			model({
				id: 22,
				name: "e5-large",
				local: { state: "not_downloaded", loaded: false }
			})
		]
	}
]

describe("resolvePair", () => {
	test("both halves must be here", () => {
		expect(
			resolvePair(rows, { connectionId: 1, connectionModelId: 11 }).model
				?.id
		).toBe(11)
	})

	test("an endpoint with no model half resolves to nothing", () => {
		// §10: a registration naming only the endpoint is incomplete, and an
		// endpoint has no model it is presumed to mean.
		expect(
			resolvePair(rows, { connectionId: 1, connectionModelId: null })
		).toEqual({})
	})

	test("a model the endpoint no longer carries resolves to nothing", () => {
		expect(
			resolvePair(rows, { connectionId: 1, connectionModelId: 99 })
		).toEqual({})
		expect(
			resolvePair(rows, { connectionId: 404, connectionModelId: 11 })
		).toEqual({})
		expect(resolvePair(rows, undefined)).toEqual({})
	})
})

describe("pairState", () => {
	test("a listed, enabled, non-local model is ready", () => {
		expect(pairState(model())).toEqual({
			state: "ok",
			stateWord: "ready"
		})
	})

	test("gone from the host and switched off both need a person", () => {
		expect(
			pairState(model({ missingSince: "2026-09-12T00:00:00Z" }))
		).toMatchObject({ state: "warning", stateWord: "not listed" })
		expect(pairState(model({ enabled: false }))).toMatchObject({
			state: "warning",
			stateWord: "switched off"
		})
	})

	test("not listed wins over switched off", () => {
		expect(
			pairState(
				model({ enabled: false, missingSince: "2026-09-12T00:00:00Z" })
			).stateWord
		).toBe("not listed")
	})

	test("a local row's disk state is part of the answer", () => {
		expect(pairState(model({ local: { state: "on_disk" } })).state).toBe(
			"ok"
		)
		expect(
			pairState(model({ local: { state: "on_disk", loaded: true } }))
		).toMatchObject({ state: "ok", stateWord: "loaded" })
		expect(
			pairState(model({ local: { state: "downloading" } }))
		).toMatchObject({ state: "pending", stateWord: "downloading" })
		expect(pairState(model({ local: { state: "error" } }))).toMatchObject({
			state: "warning",
			stateWord: "download failed"
		})
		expect(
			pairState(model({ local: { state: "not_downloaded" } }))
		).toMatchObject({ state: "warning", stateWord: "not downloaded" })
	})
})

describe("defaultsSummary with an unreachable host", () => {
	const unreachableRows: SummaryConnection[] = [
		{
			id: 1,
			name: "Ollama (local)",
			models: [model()],
			modelsSync: { at: "2026-09-12T00:00:00Z", error: "ECONNREFUSED" }
		}
	]

	test("an enabled, listed model on an unreachable host still warns", () => {
		const summary = defaultsSummary(unreachableRows, {
			"text->text": { connectionId: 1, connectionModelId: 11 }
		})
		const entry = summary.entries.find((e) => e.capability === "text->text")
		expect(entry).toMatchObject({
			set: true,
			state: "warning",
			stateWord: "host unreachable"
		})
	})

	test("the same connection with no sync error is success", () => {
		const reachableRows: SummaryConnection[] = [
			{
				...unreachableRows[0],
				modelsSync: { at: "2026-09-12T00:00:00Z", error: null }
			}
		]
		const summary = defaultsSummary(reachableRows, {
			"text->text": { connectionId: 1, connectionModelId: 11 }
		})
		const entry = summary.entries.find((e) => e.capability === "text->text")
		expect(entry).toMatchObject({
			set: true,
			state: "ok",
			stateWord: "ready"
		})
	})
})

describe("defaultsSummary", () => {
	const total = Object.keys(TRANSFORMS).length

	test("one entry per transform the SDK declares, in its order", () => {
		const summary = defaultsSummary(rows, {})
		expect(summary.total).toBe(total)
		expect(summary.entries.map((e) => e.capability)).toEqual(
			Object.keys(TRANSFORMS)
		)
		expect(summary.setCount).toBe(0)
		expect(summary.unsetCount).toBe(total)
		expect(summary.pills).toHaveLength(0)
	})

	test("N of M counts only registrations that still resolve", () => {
		const summary = defaultsSummary(rows, {
			"text->text": { connectionId: 1, connectionModelId: 11 },
			// The model half is gone: registered, and not set.
			"text->image": { connectionId: 1, connectionModelId: 99 },
			"text->embedding": { connectionId: 2, connectionModelId: 22 }
		})
		expect(summary.setCount).toBe(2)
		expect(summary.unsetCount).toBe(total - 2)
		expect(summary.pills.map((p) => p.capability)).toEqual([
			"text->text",
			"text->embedding"
		])
	})

	test("a set pill carries its own state, an unset entry carries none", () => {
		const summary = defaultsSummary(rows, {
			"text->text": { connectionId: 1, connectionModelId: 11 },
			"text->embedding": { connectionId: 2, connectionModelId: 22 }
		})
		const byId = Object.fromEntries(
			summary.entries.map((e) => [e.capability, e])
		)
		expect(byId["text->text"]).toMatchObject({
			label: "Chat",
			outputKind: "text",
			state: "ok",
			stateWord: "ready"
		})
		expect(byId["text->text"].connection?.name).toBe("Ollama (local)")
		// On disk is not downloaded: the default is registered and will stall.
		expect(byId["text->embedding"]).toMatchObject({
			set: true,
			state: "warning",
			stateWord: "not downloaded"
		})
		expect(byId["text->image"]).toMatchObject({
			set: false,
			state: "unset"
		})
		expect(byId["text->image"].model).toBeUndefined()
	})
})

describe("groupDefaultsByOutputKind", () => {
	const summary = defaultsSummary(rows, {
		"text->text": { connectionId: 1, connectionModelId: 11 }
	})
	const groups = groupDefaultsByOutputKind(summary.entries)

	test("groups run in IO_KINDS order and carry their own counts", () => {
		expect(groups.map((g) => g.kind)).toEqual([
			"text",
			"image",
			"audio",
			"embedding",
			"entities"
		])
		const text = groups[0]
		expect(text.label).toBe("Text")
		expect(text.icon).toBe("Type")
		expect(text.total).toBe(4)
		expect(text.setCount).toBe(1)
	})

	test("every transform lands in exactly one group", () => {
		expect(groups.reduce((n, g) => n + g.total, 0)).toBe(summary.total)
	})
})
