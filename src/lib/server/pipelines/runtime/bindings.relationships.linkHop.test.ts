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
	const bind: any = relationshipSearchBindings()["core:query/relationship-search@1"]
	const ctx = {
		countTokens: (t: string) => t.length,
		async read(table: string) {
			if (table === "lorebook_entries") return entries
			if (table === "session_messages")
				return [{ id: 1, role: "user", content: "we open the umber room" }]
			if (table === "graph_entry_links") return links
			return null
		}
	}
	const run = typeof bind === "function" ? bind : bind.run
	const out = await run({ scope: { sessionId: 1, currentCharacterId: 7 }, params: {} }, ctx)
	const main = (out?.value ?? out)?.main ?? []
	return main.filter((c: any) => c?.payload?.via === "link").map((c: any) => c.payload.name)
}

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
