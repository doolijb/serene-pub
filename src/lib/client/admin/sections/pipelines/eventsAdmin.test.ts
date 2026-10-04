import { describe, expect, it } from "vitest"
import {
	defaultScope,
	eventHref,
	mapNeighbours,
	nodeHref,
	presetsBinding,
	scopeFromQuery,
	scopeQuery
} from "./eventsAdmin"

const EV = "core:event/session-created@1"

describe("eventHref", () => {
	it("encodes the id, which carries : and /", () => {
		expect(eventHref(EV)).toBe("/admin/pipelines/events/core%3Aevent%2Fsession-created%401")
	})
	it("carries a map scope", () => {
		expect(eventHref(EV, { genreId: "core:genre/chat" })).toBe(
			"/admin/pipelines/events/core%3Aevent%2Fsession-created%401?genre=core%3Agenre%2Fchat"
		)
	})
})

describe("map scope in the address", () => {
	it("is null when the address names none", () => {
		expect(scopeFromQuery("?q=x")).toBeNull()
	})
	it("reads genre, preset and session; genre=all is every genre", () => {
		expect(scopeFromQuery("?genre=all&session=7")).toEqual({ genreId: "", presetId: "", sessionId: 7 })
		expect(scopeFromQuery("?genre=g&preset=3")).toEqual({ genreId: "g", presetId: "3", sessionId: null })
	})
	it("writes a cleared genre with nothing else as genre=all, so a reload keeps it", () => {
		expect(scopeQuery({ genreId: "", presetId: "", sessionId: null }).toString()).toBe("genre=all")
		expect(scopeQuery({ genreId: "", presetId: "4", sessionId: null }).toString()).toBe("preset=4")
	})
	it("round-trips", () => {
		const s = { genreId: "g", presetId: "2", sessionId: 9 }
		expect(scopeFromQuery(scopeQuery(s))).toEqual(s)
	})
})

describe("defaultScope", () => {
	it("opens on the event's first genre, else the fallback", () => {
		expect(defaultScope({ genres: [{ genreId: "lair", required: true }] }, "chat").genreId).toBe("lair")
		expect(defaultScope({ genres: [] }, "chat").genreId).toBe("chat")
		expect(defaultScope(null, "chat")).toEqual({ genreId: "chat", presetId: "", sessionId: null })
	})
})

describe("presetsBinding", () => {
	it("lists the presets whose bindings name the event, by name, with the config when chosen", () => {
		const rows = presetsBinding(
			[
				{ id: 1, name: "Zed", genreId: "chat", bindings: { [EV]: { spec: "core:a" } } },
				{ id: 2, name: "alpha", genreId: "lair", bindings: { [EV]: { spec: "core:b", config: 5 } } },
				{ id: 3, name: "Other", genreId: "chat", bindings: { "core:event/x@1": { spec: "core:c" } } }
			],
			EV
		)
		expect(rows).toEqual([
			{ presetId: 2, presetName: "alpha", genreId: "lair", spec: "core:b", config: 5 },
			{ presetId: 1, presetName: "Zed", genreId: "chat", spec: "core:a" }
		])
	})
})

describe("the event map's neighbours and links", () => {
	const map = {
		nodes: [
			{ id: EV, kind: "event" as const, label: "Session created", root: true },
			{ id: "core:spec/greet", kind: "spec" as const, label: "Greeting", root: false },
			{ id: "core:spec/create", kind: "spec" as const, label: "Create", root: false },
			{ id: "core:listener/auto-advance", kind: "listener" as const, label: "Auto-advance", root: false },
			{ id: "acme:listener/onEvent", kind: "listener" as const, label: "Acme", root: false }
		],
		edges: [
			{ from: EV, to: "core:spec/greet", kind: "binds" as const },
			{ from: "core:spec/create", to: EV, kind: "causes" as const },
			{ from: EV, to: "acme:listener/onEvent", kind: "listens" as const },
			{ from: EV, to: "missing", kind: "binds" as const }
		]
	}
	it("answers, causes and hears, dropping nodes not drawn", () => {
		const n = mapNeighbours(map, EV)
		expect(n.answeredBy.map((x) => x.id)).toEqual(["core:spec/greet"])
		expect(n.causedBy.map((x) => x.id)).toEqual(["core:spec/create"])
		expect(n.heardBy.map((x) => x.id)).toEqual(["acme:listener/onEvent"])
		expect(mapNeighbours(null, EV).answeredBy).toEqual([])
	})
	it("opens a pipeline's workspace, a plugin listener's plugins page, an event's change view", () => {
		expect(nodeHref(map.nodes[1])).toBe("/admin/pipelines/core%3Aspec%2Fgreet")
		expect(nodeHref(map.nodes[3])).toBeNull()
		expect(nodeHref(map.nodes[4])).toBe("/admin/plugins")
		expect(nodeHref(map.nodes[0], { genreId: "g" })).toBe(`${eventHref(EV)}?genre=g`)
	})
})
