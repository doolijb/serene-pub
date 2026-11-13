import { describe, expect, it } from "vitest"
import {
	cantUseNoteOf,
	connectionChip,
	filterModels,
	flatModels,
	FOLD_THRESHOLD,
	groupModels,
	inScope,
	isCantUse,
	isOnDisk,
	livesInOf,
	loadoutModelKeys,
	MODEL_SCOPES,
	modelsSummaryLine,
	scopeCounts,
	sizeOnDiskOf
} from "./modelsList"
import type { CapabilityConnection } from "./jobPicker"
import type { ModelsGroupBy } from "./modelsGroupBy"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

function model(
	id: number,
	name: string,
	caps: string[],
	extra: Partial<CapabilityConnection["models"][number]> = {}
): CapabilityConnection["models"][number] {
	return {
		id,
		name,
		model: name.toLowerCase().replace(/\s+/g, "-"),
		enabled: true,
		missingSince: null,
		satisfiableCapabilities: caps,
		...extra
	}
}

function connection(
	id: number,
	name: string,
	type: string,
	models: CapabilityConnection["models"]
): CapabilityConnection {
	return {
		id,
		name,
		type,
		models,
		modelsSync: { at: null, error: null }
	}
}

const rows: CapabilityConnection[] = [
	connection(1, "Kobold", CONNECTION_TYPE.KOBOLDCPP_MANAGED, [
		model(11, "Zephyr", ["text->text"]),
		model(12, "Anima", ["text->text", "text->image"])
	]),
	connection(2, "Embeddings", CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS, [
		model(21, "bge small", ["text->embedding"], {
			local: { state: "on_disk" }
		})
	]),
	connection(3, "OpenRouter", "openai", [
		model(31, "Hidden one", ["text->text"], { enabled: false }),
		model(32, "Gone", ["text->text"], {
			missingSince: "2026-10-01T00:00:00Z"
		}),
		model(33, "Mistral", ["text->text"])
	])
]

describe("flatModels", () => {
	it("is one entry per model across every connection", () => {
		const flat = flatModels(rows)
		expect(flat).toHaveLength(6)
		const anima = flat.find((e) => e.model.id === 12)!
		expect(anima.connectionId).toBe(1)
		expect(anima.connectionName).toBe("Kobold")
		expect(anima.capabilities).toEqual(["text->text", "text->image"])
		expect(anima.isLocal).toBe(false)
	})

	it("sorts by display name, set-aside models last", () => {
		const names = flatModels(rows).map((e) => e.model.id)
		// Anima, Bge Small, Mistral, Zephyr — then Gone, Hidden one.
		expect(names.slice(0, 4)).toEqual([12, 21, 33, 11])
		expect(names.slice(4).sort()).toEqual([31, 32])
	})

	it("marks a local ONNX file as local", () => {
		const bge = flatModels(rows).find((e) => e.model.id === 21)!
		expect(bge.isLocal).toBe(true)
		expect(bge.local?.state).toBe("on_disk")
	})

	it("names an unnamed connection", () => {
		const flat = flatModels([
			connection(9, "", "openai", [model(1, "X", [])])
		])
		expect(flat[0].connectionName).toBe("Untitled connection")
	})
})

describe("filterModels", () => {
	const flat = flatModels(rows)

	it("keeps everything at All with no query", () => {
		expect(filterModels(flat, { query: "", scope: "all" })).toHaveLength(6)
	})

	it("narrows by the scope's job", () => {
		expect(
			filterModels(flat, { query: "", scope: "images" }).map(
				(e) => e.model.id
			)
		).toEqual([12])
		expect(
			filterModels(flat, { query: "", scope: "embeddings" }).map(
				(e) => e.model.id
			)
		).toEqual([21])
		expect(filterModels(flat, { query: "", scope: "entities" })).toEqual([])
	})

	it("matches the name, the identifier and the connection", () => {
		expect(
			filterModels(flat, { query: "mistral", scope: "all" }).map(
				(e) => e.model.id
			)
		).toEqual([33])
		expect(
			filterModels(flat, { query: "kobold", scope: "all" }).map(
				(e) => e.model.id
			)
		).toEqual([12, 11])
		expect(
			filterModels(flat, { query: "kobold zeph", scope: "chat" }).map(
				(e) => e.model.id
			)
		).toEqual([11])
	})
})

describe("counts and words", () => {
	it("counts each scope", () => {
		const counts = scopeCounts(flatModels(rows))
		expect(counts).toEqual({
			all: 6,
			chat: 5,
			images: 1,
			embeddings: 1,
			entities: 0,
			"in-loadout": 0,
			"on-disk": 3
		})
		expect(MODEL_SCOPES.map((s) => s.label)).toEqual([
			"All",
			"Chat",
			"Images",
			"Embeddings",
			"Entities",
			"In a loadout",
			"On disk"
		])
	})

	it("says the summary line", () => {
		expect(modelsSummaryLine(12, "all")).toBe("12 models")
		expect(modelsSummaryLine(1, "all")).toBe("1 model")
		expect(modelsSummaryLine(4, "chat")).toBe("4 can chat")
		expect(modelsSummaryLine(1, "images")).toBe("1 can draw")
		expect(modelsSummaryLine(2, "embeddings")).toBe("2 can embed")
		expect(modelsSummaryLine(0, "entities")).toBe("0 can find entities")
	})

	it("chips the connection, the service in the tooltip", () => {
		expect(
			connectionChip({
				connectionName: "Work key",
				serviceLabel: "OpenRouter"
			})
		).toEqual({ label: "Work key", title: "Work key · OpenRouter" })
		expect(
			connectionChip({
				connectionName: "OpenRouter",
				serviceLabel: "OpenRouter"
			})
		).toEqual({ label: "OpenRouter", title: "OpenRouter" })
	})
})

// ── Narrowings, notes and sizes ─────────────────────────────────────────────

const flat = flatModels(rows)
const byId = (id: number) => flat.find((e) => e.model.id === id)!

describe("loadoutModelKeys", () => {
	it("keeps filled, unmerged pairs and skips the rest", () => {
		const keys = loadoutModelKeys([
			{
				filled: true,
				connectionId: 1,
				connectionModelId: 11,
				mergedInto: null
			},
			{
				filled: true,
				connectionId: 1,
				connectionModelId: 12,
				mergedInto: 5
			},
			{
				filled: false,
				connectionId: 3,
				connectionModelId: 33,
				mergedInto: null
			},
			{
				filled: true,
				connectionId: null,
				connectionModelId: null,
				mergedInto: null
			}
		])
		expect([...keys]).toEqual(["1:11"])
	})
})

describe("the two narrowings", () => {
	it("in-loadout keeps the named pairs and none before loadouts answer", () => {
		const set = new Set(["1:11", "3:33"])
		expect(
			filterModels(flat, {
				query: "",
				scope: "in-loadout",
				inLoadout: set
			}).map((e) => e.model.id)
		).toEqual([33, 11])
		expect(inScope(byId(11), "in-loadout", null)).toBe(false)
		expect(inScope(byId(11), "in-loadout")).toBe(false)
		expect(scopeCounts(flat, set)["in-loadout"]).toBe(2)
	})
	it("on-disk keeps local rows that are listed, and ONNX files that are here", () => {
		expect(
			filterModels(flat, { query: "", scope: "on-disk" }).map(
				(e) => e.model.id
			)
		).toEqual([12, 21, 11])
		expect(isOnDisk(byId(33))).toBe(false)
	})
	it("an ONNX row not downloaded, or a local row no longer listed, is not on disk", () => {
		const onnx = flatModels([
			connection(2, "E", CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS, [
				model(1, "A", ["text->embedding"], {
					local: { state: "not_downloaded" }
				})
			]),
			connection(1, "K", CONNECTION_TYPE.KOBOLDCPP_MANAGED, [
				model(2, "B", ["text->text"], {
					missingSince: "2026-10-01T00:00:00Z"
				})
			])
		])
		expect(onnx.some(isOnDisk)).toBe(false)
	})
})

describe("sizeOnDiskOf", () => {
	const kb = flatModels([
		connection(1, "K", CONNECTION_TYPE.KOBOLDCPP_MANAGED, [
			model(1, "Facts", ["text->text"], {
				facts: { sizeBytes: 5e9, source: "file" }
			}),
			model(2, "None", ["text->text"]),
			model(3, "Zero", ["text->text"], {
				facts: { sizeBytes: 0, source: "file" }
			})
		]),
		connection(2, "E", CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS, [
			model(4, "Here", ["text->embedding"], {
				local: { state: "on_disk", sizeBytes: 7e7 }
			}),
			model(5, "Away", ["text->embedding"], {
				local: { state: "not_downloaded", sizeBytes: 9e7 }
			})
		])
	])
	const size = (id: number) =>
		sizeOnDiskOf(kb.find((e) => e.model.id === id)!)
	it("facts first, then the file, positive numbers only", () => {
		expect(size(1)).toBe(5e9)
		expect(size(2)).toBeNull()
		expect(size(3)).toBeNull()
		expect(size(4)).toBe(7e7)
		expect(size(5)).toBeNull()
	})
})

describe("livesInOf and the reason line", () => {
	it("names Ollama's own", () => {
		expect(
			livesInOf({ connectionType: "ollama", serviceLabel: "Ollama" })
		).toBe("lives in Ollama")
		expect(
			livesInOf({ connectionType: "openai", serviceLabel: "X" })
		).toBeNull()
	})
	it("says why, only where the row does not already", () => {
		expect(cantUseNoteOf(byId(31))).toBe("Switched off")
		expect(cantUseNoteOf(byId(32))).toBeNull()
		expect(cantUseNoteOf(byId(11))).toBeNull()
		const none = flatModels([
			connection(1, "K", "openai", [model(1, "Nothing", [])]),
			connection(2, "E", CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS, [
				model(2, "Away", [], { local: { state: "not_downloaded" } })
			])
		])
		expect(cantUseNoteOf(none.find((e) => e.model.id === 1)!)).toBe(
			"No default loadout can run this model"
		)
		expect(cantUseNoteOf(none.find((e) => e.model.id === 2)!)).toBeNull()
		expect(none.every(isCantUse)).toBe(true)
		expect(isCantUse(byId(31))).toBe(true)
		expect(isCantUse(byId(11))).toBe(false)
	})
})

// ── groupModels ─────────────────────────────────────────────────────────────

function manyModels(n: number, caps = ["text->text"]) {
	return Array.from({ length: n }, (_, i) =>
		model(1000 + i, `Router ${String(i).padStart(3, "0")}`, caps)
	)
}

function run(
	conns: CapabilityConnection[],
	groupBy: ModelsGroupBy,
	o: Partial<{
		inLoadout: Set<string> | null
		unfolded: Set<number>
		folding: boolean
		remover: boolean
	}> = {}
) {
	return groupModels(flatModels(conns), {
		groupBy,
		connections: conns,
		inLoadout: null,
		unfolded: new Set(),
		folding: true,
		remover: false,
		...o
	})
}

const ids = (g: { rows: { model: { id: number } }[] }) =>
	g.rows.map((r) => r.model.id)

describe("groupModels — where", () => {
	it("local, services, then the catch-all, with labels from the groups", () => {
		const g = run(rows, "where")
		expect(g.map((x) => [x.key, x.label])).toEqual([
			["local", "On this machine"],
			["service", "Services"],
			["cant-use", "Can't be used right now"]
		])
		expect(ids(g[0])).toEqual([12, 21, 11])
		expect(ids(g[1])).toEqual([33])
		expect(ids(g[2]).sort()).toEqual([31, 32])
		expect(g[2].sizeLabel).toBeNull()
	})
	it("sums the local side only; a not-downloaded file is not counted", () => {
		const conns = [
			connection(1, "K", CONNECTION_TYPE.KOBOLDCPP_MANAGED, [
				model(1, "A", ["text->text"], {
					facts: { sizeBytes: 2e9, source: "file" }
				}),
				model(2, "B", ["text->text"], {
					facts: { sizeBytes: 3e9, source: "file" }
				})
			]),
			connection(2, "E", CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS, [
				model(3, "C", ["text->embedding"], {
					local: { state: "not_downloaded", sizeBytes: 9e9 }
				})
			]),
			connection(3, "S", "openai", [
				model(4, "D", ["text->text"], {
					facts: { sizeBytes: 8e9, source: "file" }
				})
			])
		]
		const g = run(conns, "where")
		expect(g[0].sizeLabel).toBe("5 GB")
		expect(g.find((x) => x.key === "service")!.sizeLabel).toBeNull()
	})
	it("the remover sits in the local group, even when it is the only thing there", () => {
		const only = run(
			[connection(3, "S", "openai", [model(4, "D", ["text->text"])])],
			"where",
			{
				remover: true
			}
		)
		expect(only[0]).toMatchObject({ key: "local", rows: [], remover: true })
		expect(
			run(rows, "where", { remover: true }).map((x) => x.remover)
		).toEqual([true, false, false])
		expect(run(rows, "where").some((x) => x.remover)).toBe(false)
	})
	it("drops a group with nothing in it", () => {
		const g = run(
			[connection(3, "S", "openai", [model(4, "D", ["text->text"])])],
			"where"
		)
		expect(g.map((x) => x.key)).toEqual(["service"])
	})
})

describe("groupModels — folds", () => {
	const big = (n: number) => [
		connection(7, "OpenRouter", "openai", manyModels(n)),
		connection(1, "Kobold", CONNECTION_TYPE.KOBOLDCPP_MANAGED, [
			model(11, "Zephyr", ["text->text"])
		])
	]
	it("folds at 13 models and not at 12", () => {
		expect(FOLD_THRESHOLD).toBe(12)
		const at13 = run(big(13), "where")
		const svc = at13.find((x) => x.key === "service")!
		expect(svc.rows).toEqual([])
		expect(svc.folds).toEqual([
			{ connectionId: 7, title: "OpenRouter", text: "13 models" }
		])
		const at12 = run(big(12), "where")
		expect(at12.find((x) => x.key === "service")!.rows).toHaveLength(12)
		expect(at12.find((x) => x.key === "service")!.folds).toEqual([])
	})
	it("never folds a local connection", () => {
		const conns = [
			connection(
				1,
				"K",
				CONNECTION_TYPE.KOBOLDCPP_MANAGED,
				manyModels(20)
			)
		]
		expect(run(conns, "where")[0].rows).toHaveLength(20)
	})
	it("exempt models stay and are counted; loadouts unanswered omit the count", () => {
		const conns = big(13)
		const set = new Set(["7:1002"])
		const svc = run(conns, "where", { inLoadout: set }).find(
			(x) => x.key === "service"
		)!
		expect(ids(svc)).toEqual([1002])
		expect(svc.folds[0].text).toBe("13 models · 1 in a loadout")
		const zero = run(conns, "where", { inLoadout: new Set() }).find(
			(x) => x.key === "service"
		)!
		expect(zero.folds[0].text).toBe("13 models · 0 in a loadout")
		const none = run(conns, "where", { inLoadout: null }).find(
			(x) => x.key === "service"
		)!
		expect(none.folds[0].text).toBe("13 models")
	})
	it("Show (unfolded) and a typed filter (folding false) list every row", () => {
		const conns = big(13)
		for (const o of [{ unfolded: new Set([7]) }, { folding: false }]) {
			const svc = run(conns, "where", o).find((x) => x.key === "service")!
			expect(svc.rows).toHaveLength(13)
			expect(svc.folds).toEqual([])
		}
	})
	it("connection grouping: local first, untitled fold, size on the local side", () => {
		const conns = big(13)
		const g = run(conns, "connection", { remover: true })
		expect(g.map((x) => x.key)).toEqual(["conn:1", "conn:7", "built-in"])
		expect(g[1].folds).toEqual([
			{ connectionId: 7, title: null, text: "13 models" }
		])
		expect(g[2]).toMatchObject({
			label: "Built in",
			rows: [],
			remover: true
		})
		expect(run(conns, "connection").some((x) => x.key === "built-in")).toBe(
			false
		)
	})
	it("connection grouping: local size total", () => {
		const conns = [
			connection(1, "K", CONNECTION_TYPE.KOBOLDCPP_MANAGED, [
				model(1, "A", ["text->text"], {
					facts: { sizeBytes: 4e9, source: "file" }
				})
			])
		]
		expect(run(conns, "connection")[0].sizeLabel).toBe("4 GB")
	})
	it("the catch-all folds as '+ n on name'", () => {
		const conns = [
			connection(7, "OpenRouter", "openai", [
				...manyModels(13),
				model(2000, "Off", ["text->text"], { enabled: false })
			])
		]
		const g = run(conns, "where")
		const last = g[g.length - 1]
		expect(last.key).toBe("cant-use")
		expect(last.rows).toEqual([])
		expect(last.folds[0].text).toBe("+ 1 on OpenRouter")
		// Usable count excludes the switched-off model.
		expect(g[0].folds[0].text).toBe("13 models")
	})
})

describe("groupModels — can-do", () => {
	it("lists a row under every kind it has, in the finder's order", () => {
		const g = run(rows, "can-do")
		expect(g.map((x) => [x.key, x.label])).toEqual([
			["cap:text->text", "Chat"],
			["cap:text->image", "Images"],
			["cap:text->embedding", "Embeddings"],
			["cant-use", "Can't be used right now"]
		])
		expect(ids(g[0])).toEqual([12, 33, 11])
		expect(ids(g[1])).toEqual([12])
		expect(g.every((x) => x.sizeLabel === null)).toBe(true)
	})
	it("a row with none of the six is listed under each capability it has", () => {
		const conns = [
			connection(1, "S", "openai", [
				model(1, "Odd", ["text->text-extra-x", "text->other-y"]),
				model(2, "Odd two", ["text->other-y"])
			])
		]
		const g = run(conns, "can-do")
		expect(g.map((x) => x.key)).toEqual([
			"cap:text->text-extra-x",
			"cap:text->other-y"
		])
		expect(ids(g[1])).toEqual([1, 2])
	})
	it("folds as '+ n on name' per kind, exempt rows stay", () => {
		const conns = [
			connection(7, "OpenRouter", "openai", [
				...manyModels(13),
				...manyModels(1, ["text->image"]).map((m) => ({
					...m,
					id: 3000
				}))
			])
		]
		const g = run(conns, "can-do", {
			inLoadout: new Set(["7:1001"])
		})
		expect(ids(g[0])).toEqual([1001])
		expect(g[0].folds).toEqual([
			{ connectionId: 7, title: null, text: "+ 12 on OpenRouter" }
		])
		expect(g[1].folds[0].text).toBe("+ 1 on OpenRouter")
	})
	it("the cut-outs remover sits after the kinds, before the catch-all", () => {
		const g = run(rows, "can-do", { remover: true })
		expect(g.map((x) => x.key)).toEqual([
			"cap:text->text",
			"cap:text->image",
			"cap:text->embedding",
			"cut-outs",
			"cant-use"
		])
		expect(g[3]).toMatchObject({
			label: "Cut-outs",
			remover: true,
			rows: []
		})
	})
})
