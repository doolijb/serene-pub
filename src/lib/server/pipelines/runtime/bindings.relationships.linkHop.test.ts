/**
 * The link hop's far end is only offered when the speaker's own lore read
 * returned it (finding #151): another character's private lore, a switched-off
 * room and a shelved one are ends nobody may be told of, even one edge from an
 * entry the turn chose. Driven through a stand-in `ctx.read` — the edges'
 * line, status and secrecy are the host's (`loreReading.int.test.ts`); this is
 * the binding's own half.
 */
import { describe, expect, it } from "vitest"
import { relationshipSearchBindings } from "./bindings.relationships"

const entry = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
	id,
	source: "worldLore",
	name,
	content: `${name}.`,
	keys: [name.toLowerCase()],
	enabled: true,
	archived: false,
	...extra
})

const link = (id: number, toId: number, toName: string) => ({
	id,
	relationshipType: "leads to",
	description: "",
	visibility: "acknowledged",
	status: "active",
	updatedAt: id,
	from: { kind: "entry", id: 1, name: "Umber Room" },
	to: { kind: "entry", id: toId, name: toName }
})

async function hopNames(entries: any[], links: any[]) {
	return (await hops(entries, links)).map((c: any) => c.payload.name)
}

/**
 * Run the mechanism against a stand-in `ctx.read`. `params` defaults to a
 * band with a share (the hop only runs then — plan A2); `tables` records every
 * read it made.
 */
async function search(
	entries: any[],
	links: any[],
	params: Record<string, unknown> = { share: 0.1 }
) {
	const bind: any = relationshipSearchBindings()["core:query/relationship-search@1"]
	const tables: string[] = []
	const ctx = {
		countTokens: (t: string) => t.length,
		async read(table: string) {
			tables.push(table)
			if (table === "lorebook_entries") return entries
			if (table === "session_messages")
				return [{ id: 1, role: "user", content: "we open the umber room" }]
			if (table === "graph_entry_links") return links
			return null
		}
	}
	const run = typeof bind === "function" ? bind : bind.run
	const out = await run({ scope: { sessionId: 1, currentCharacterId: 7 }, params }, ctx)
	const value = out?.value ?? out
	return { value, tables }
}

async function hops(entries: any[], links: any[]) {
	const { value } = await search(entries, links)
	return (value?.main ?? []).filter((c: any) => c?.payload?.via === "link")
}

/**
 * Plan A2: at a share of 0 (Chat's shipped default) the ranker leaves every
 * relationship out, so a hop found then is paid for and thrown away. The hop
 * is not walked at all: no link read, no second lore scan.
 */
describe("the link hop runs only when the band can spend", () => {
	const room = entry(1, "Umber Room")
	const tunnel = entry(2, "Salt Tunnel")
	const HOP_READS = [
		"graph_entry_links",
		"lorebook_entries",
		"session_messages",
		"session_cast"
	]

	it("reads no link and scans nothing at the shipped share of 0", async () => {
		const { value, tables } = await search(
			[room, tunnel],
			[link(10, 2, "Salt Tunnel")],
			{}
		)
		for (const table of HOP_READS) expect(tables).not.toContain(table)
		expect(value.diagnostics.linked).toBe(0)
	})

	it("reads no link at a ceiling of 0", async () => {
		const { tables } = await search([room, tunnel], [link(10, 2, "Salt Tunnel")], {
			share: 0.1,
			maxEntries: 0
		})
		for (const table of HOP_READS) expect(tables).not.toContain(table)
	})

	it("hops once the band has a share", async () => {
		const { value, tables } = await search(
			[room, tunnel],
			[link(10, 2, "Salt Tunnel")],
			{ share: 0.1 }
		)
		expect(tables).toContain("graph_entry_links")
		expect(value.diagnostics.linkedEntries).toEqual(["Salt Tunnel"])
	})
})

describe("the link hop offers only ends the speaker may see", () => {
	it("keeps a visible end and drops one the lore read withheld, switched off or shelved", async () => {
		const visible = [
			entry(1, "Umber Room"),
			entry(2, "Salt Tunnel"),
			entry(4, "Old Mill", { enabled: false }),
			entry(5, "Drowned Quarter", { archived: true })
		]
		// Entry 3 (somebody else's secret) is NOT in the read: the host withheld it.
		const names = await hopNames(visible, [
			link(10, 2, "Salt Tunnel"),
			link(11, 3, "Someone's secret cache"),
			link(12, 4, "Old Mill"),
			link(13, 5, "Drowned Quarter")
		])
		expect(names).toEqual(["Salt Tunnel"])
	})
})

/**
 * The hop reads a relationship the right way round (plan places-graph §6.3,
 * B3). The turn names the Umber Room; the relationship is written from the
 * Salt Tunnel's end, so the hop walks it from its `to` end.
 */
describe("the link hop says a relationship from the end it walked from", () => {
	const room = entry(1, "Umber Room")
	const tunnel = entry(2, "Salt Tunnel")
	const inbound = (over: Record<string, unknown> = {}) => ({
		id: 20,
		relationshipType: "leads to",
		reverseRelationshipType: null,
		name: "",
		description: "",
		visibility: "acknowledged",
		status: "active",
		updatedAt: 20,
		from: { kind: "entry", id: 2, name: "Salt Tunnel" },
		to: { kind: "entry", id: 1, name: "Umber Room" },
		...over
	})

	it("keeps the relationship type when it walks out from the `from` end", async () => {
		const [hop] = await hops([room, tunnel], [link(10, 2, "Salt Tunnel")])
		expect(hop.payload.entry.type).toBe("leads to")
		expect(hop.payload.linkedFrom).toBe("Umber Room")
	})

	it("reads the reverse relationship type when it walks back from the `to` end", async () => {
		const [hop] = await hops(
			[room, tunnel],
			[inbound({ reverseRelationshipType: "leads up to" })]
		)
		expect(hop.payload.name).toBe("Salt Tunnel")
		expect(hop.payload.entry.type).toBe("leads up to")
	})

	it("never reads a one-way relationship backwards: it is said from the far end", async () => {
		const [hop] = await hops([room, tunnel], [inbound()])
		expect(hop.payload.name).toBe("Salt Tunnel")
		// "Umber Room leads to Salt Tunnel" would be the backwards reading.
		expect(hop.payload.entry.type).toBeUndefined()
		expect(hop.payload.entry.says).toBe("Leads to Umber Room.")
		expect(JSON.parse(hop.payload.content).says).toBe("Leads to Umber Room.")
	})
})
