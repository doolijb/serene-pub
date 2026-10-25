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

describe("defaultsSummary with a pair that can no longer do its job", () => {
	// A sync restated the model's modality after it was registered for chat:
	// the server now judges it able to embed only.
	const restated: SummaryConnection[] = [
		{
			id: 1,
			name: "Ollama (local)",
			models: [
				model({
					name: "nomic-embed-text",
					satisfiableCapabilities: ["text->embedding"]
				})
			]
		}
	]
	const chat = (rows: SummaryConnection[]) =>
		defaultsSummary(rows, {
			"text->text": { connectionId: 1, connectionModelId: 11 }
		}).entries.find((e) => e.capability === "text->text")

	test("is registered and broken, saying why", () => {
		expect(chat(restated)).toMatchObject({
			set: true,
			state: "warning",
			stateWord: "can't do this loadout's work"
		})
	})

	test("the same model registered for a job it can do is ready", () => {
		const entry = defaultsSummary(restated, {
			"text->embedding": { connectionId: 1, connectionModelId: 11 }
		}).entries.find((e) => e.capability === "text->embedding")
		expect(entry).toMatchObject({ state: "ok", stateWord: "ready" })
	})

	test("an unanswered judgement is never read as a refusal", () => {
		const silent: SummaryConnection[] = [
			{
				...restated[0],
				models: [model({ satisfiableCapabilities: undefined })]
			}
		]
		expect(chat(silent)).toMatchObject({ state: "ok", stateWord: "ready" })
	})

	test("not listed keeps its own word, though it satisfies nothing", () => {
		const gone: SummaryConnection[] = [
			{
				...restated[0],
				models: [
					model({
						missingSince: "2026-10-01T00:00:00Z",
						satisfiableCapabilities: []
					})
				]
			}
		]
		expect(chat(gone)).toMatchObject({
			state: "warning",
			stateWord: "not listed"
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
		// 🚧 O6 (2026-10-21): `text->text+audio` (Spoken reply) writes two
		// kinds, so it files under "Other" at the end rather than under either.
		expect(groups.map((g) => g.kind)).toEqual([
			"text",
			"image",
			"audio",
			"embedding",
			"entities",
			"other"
		])
		const text = groups[0]
		expect(text.label).toBe("Text")
		expect(text.icon).toBe("Type")
		// + Hearing (`text+audio->text`, O4).
		expect(text.total).toBe(5)
		expect(text.setCount).toBe(1)
	})

	test("every transform lands in exactly one group", () => {
		expect(groups.reduce((n, g) => n + g.total, 0)).toBe(summary.total)
	})
})
