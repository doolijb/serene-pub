/**
 * `core:query/lorebook-entries@1` with `withLinks` (places plan B2, §6.3 and
 * §12, 2026-09-29).
 *
 * A listed room carries its **lore links** — the entry↔entry relationships it
 * stands in — each said from the room, which is what `{{locationEntry}}`'s
 * "From here:" block is written from (B6). The rules are the relationship
 * hop's reading (`readGraphEntryLinks`), so a prompt and the hop never disagree
 * about which ways out a room has:
 *
 *  · **said from the listed entry** — a row drawn from here reads by its
 *    relationship type; one drawn TO here reads by its reverse type, and has
 *    no sentence from here when it has none (one way, inbound: left out);
 *  · **standing** — `status` active and not `secret`, both ends live;
 *  · **entry↔entry only** — a tie to a cast member is not a way out of a room;
 *  · **no way round the privacy gate** — character lore the speaker may not
 *    see is not named as a link's far end either; and with no `speaker`
 *    wired (a listing every voice in a turn may share — the Lair's rooms),
 *    gated lore is named only when every voice may see it.
 *
 * Off unless asked: a row read without `withLinks` carries no `links` at all,
 * so every spec written before the param reads exactly what it did.
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "with-links-secret" }
})

let db: TestDb
let sessionId: number
let lorebookId: number
let characterId: number
const id: Record<string, number> = {}

const node = {
	key: "rooms",
	definitionId: "core:query/lorebook-entries@1",
	definitionVersion: 1,
	kind: "query"
}

const read = (query: Record<string, unknown>): Promise<any[]> => {
	const host = createHost(db as any, { sessionId })
	return host.read!("lorebook_entries", query, node as any) as Promise<any[]>
}

/** The listing's own posture, rooms only, narrator-shaped. */
const rooms = (query: Record<string, unknown> = {}) =>
	read({
		sessionId,
		currentCharacterId: null,
		enabled: true,
		archived: false,
		entryTypes: [LOCATION_TYPE_ID],
		...query
	})

const byName = (rows: any[], name: string) => rows.find((r) => r.name === name)

/** A link as a reader states it: its words, its far end, its name. */
const said = (row: any) =>
	(row?.links ?? [])
		.map(
			(l: any) =>
				`${l.name ? `${l.name}: ` : ""}${l.linkType} → ${l.to.name}` +
				(l.reverseLinkType ? ` (back: ${l.reverseLinkType})` : "")
		)
		.sort()

let position = 0
const entry = async (
	name: string,
	typeId: string = LOCATION_TYPE_ID,
	over: Record<string, unknown> = {}
) => {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			...entryInsert({
				typeId,
				lorebookId,
				name,
				content: `About ${name}.`,
				position: position++
			} as any),
			...over
		} as any)
		.returning({ id: schema.lorebookEntries.id })
	id[name] = row!.id
	return row!.id
}

const relate = (values: Record<string, unknown>) =>
	db.insert(schema.narrativeRelationships).values({
		lorebookId,
		fromNodeId: null,
		toNodeId: null,
		...values
	} as any)

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-with-links-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "with-links", isAdmin: false })
		.returning()
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ name: "The Keep", userId: user!.id })
		.returning()
	lorebookId = book!.id
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user!.id, isGroup: false, lorebookId })
		.returning()
	sessionId = session!.id
	const [character] = await db
		.insert(schema.characters)
		.values({
			userId: user!.id,
			name: "Aria",
			description: "Keeps the keys."
		} as any)
		.returning()
	characterId = character!.id

	await entry("The Guardroom")
	await entry("The Drowned Hall")
	await entry("The Crypt")
	await entry("The Well")
	await entry("The Vault")
	await entry("The Old Stair", LOCATION_TYPE_ID, { archived: true })
	await entry("The Rusty Flagon", WORLD_LORE_TYPE_ID)
	// An NPC binding: the narrator's alone, so hidden from a speaking character.
	const [binding] = await db
		.insert(schema.lorebookBindings)
		.values({ lorebookId, binding: "{{char:1}}", name: "The Warden" })
		.returning()
	await entry("The Warden's Cache", CHARACTER_LORE_TYPE_ID, {
		anchorBindingId: binding!.id
	})
	// Aria's own private lore: hers alone.
	const [ariaBinding] = await db
		.insert(schema.lorebookBindings)
		.values({
			lorebookId,
			binding: "{{char:2}}",
			name: "Aria",
			characterId
		} as any)
		.returning()
	await entry("Aria's Letters", CHARACTER_LORE_TYPE_ID, {
		anchorBindingId: ariaBinding!.id
	})

	// Both ways, named: said from each end in its own words.
	await relate({
		fromEntryId: id["The Guardroom"],
		toEntryId: id["The Drowned Hall"],
		relationshipType: "leads north to",
		reverseRelationshipType: "leads south to",
		title: "the rusted iron door",
		description: "Hinges scream."
	})
	// One way INTO the Guardroom: said from the Crypt, silent from the Guardroom.
	await relate({
		fromEntryId: id["The Crypt"],
		toEntryId: id["The Guardroom"],
		relationshipType: "leads to"
	})
	// Containment is words: a room inside world lore.
	await relate({
		fromEntryId: id["The Guardroom"],
		toEntryId: id["The Rusty Flagon"],
		relationshipType: "is inside",
		reverseRelationshipType: "holds"
	})
	// Secret, and no longer standing: neither is a way out.
	await relate({
		fromEntryId: id["The Guardroom"],
		toEntryId: id["The Well"],
		relationshipType: "leads down to",
		visibility: "secret"
	})
	await relate({
		fromEntryId: id["The Guardroom"],
		toEntryId: id["The Vault"],
		relationshipType: "leads to",
		status: "ended"
	})
	// A dead end: the far room is shelved.
	await relate({
		fromEntryId: id["The Guardroom"],
		toEntryId: id["The Old Stair"],
		relationshipType: "leads up to"
	})
	// Private lore as the far end.
	await relate({
		fromEntryId: id["The Guardroom"],
		toEntryId: id["The Warden's Cache"],
		relationshipType: "hides"
	})
	await relate({
		fromEntryId: id["The Guardroom"],
		toEntryId: id["Aria's Letters"],
		relationshipType: "hides"
	})
	// A tie to a cast member is not a way out of a room.
	await relate({
		fromNodeId: binding!.id,
		toEntryId: id["The Guardroom"],
		relationshipType: "guards"
	})
}, 60_000)

describe("withLinks — each row's lore links, said from the row", () => {
	it("carries no links unless asked", async () => {
		const rows = await rooms()
		expect(rows.length).toBeGreaterThan(0)
		for (const row of rows) expect(row).not.toHaveProperty("links")
	}, 60_000)

	it("says each link from the listed room, both ends, in its own words", async () => {
		const rows = await rooms({ withLinks: true })
		// No private lore: no speaker is wired (below).
		expect(said(byName(rows, "The Guardroom"))).toEqual([
			"is inside → The Rusty Flagon (back: holds)",
			"the rusted iron door: leads north to → The Drowned Hall (back: leads south to)"
		])
		// The same row, read from the far end, by its reverse.
		expect(said(byName(rows, "The Drowned Hall"))).toEqual([
			"the rusted iron door: leads south to → The Guardroom (back: leads north to)"
		])
		// Drawn from the Crypt, so said from the Crypt.
		expect(said(byName(rows, "The Crypt"))).toEqual([
			"leads to → The Guardroom"
		])
	}, 60_000)

	it("carries the relationship's id, the far end's id, and its description", async () => {
		const rows = await rooms({ withLinks: true })
		const door = byName(rows, "The Guardroom").links.find(
			(l: any) => l.to.entryId === id["The Drowned Hall"]
		)
		expect(door).toMatchObject({
			linkType: "leads north to",
			reverseLinkType: "leads south to",
			name: "the rusted iron door",
			description: "Hinges scream.",
			to: { entryId: id["The Drowned Hall"], name: "The Drowned Hall" }
		})
		expect(typeof door.id).toBe("number")
		// A one-way row says nothing back, rather than an empty string.
		const down = byName(rows, "The Crypt").links[0]
		expect(down).not.toHaveProperty("reverseLinkType")
		expect(down).not.toHaveProperty("name")
	}, 60_000)

	it("leaves out a one-way inbound row, a secret one, an ended one and a dead end", async () => {
		const rows = await rooms({ withLinks: true })
		const guardroom = said(byName(rows, "The Guardroom")).join("\n")
		expect(guardroom).not.toMatch(/Crypt/) // one way, into here
		expect(guardroom).not.toMatch(/Well/) // secret
		expect(guardroom).not.toMatch(/Vault/) // ended
		expect(guardroom).not.toMatch(/Old Stair/) // archived far end
		expect(guardroom).not.toMatch(/guards/) // a cast tie
		// A room nothing standing joins lists an empty list, not nothing.
		expect(byName(rows, "The Well").links).toEqual([])
	}, 60_000)

	it("names no far end the speaker may not see", async () => {
		const rows = await rooms({
			withLinks: true,
			currentCharacterId: characterId
		})
		expect(said(byName(rows, "The Guardroom"))).not.toContain(
			"hides → The Warden's Cache"
		)
	}, 60_000)
})

/**
 * B6 review round. A listing with no `speaker` wired is read once a turn and
 * shared by every voice (the Lair's rooms feed the narration, the planner and
 * each delver), so the run's scope is not who reads it: the envoy's turn has
 * no subject at all (`null`, which the rule reads as the omniscient
 * narrator), a delver's turn has that delver.
 */
describe("withLinks — private far ends in a listing every voice shares", () => {
	it("an envoy's turn (no speaker, no subject) names no background character's private lore", async () => {
		const rows = await rooms({ withLinks: true, currentCharacterId: null })
		const guardroom = said(byName(rows, "The Guardroom"))
		expect(guardroom.join("\n")).not.toMatch(/Warden|Letters/)
		// Lore nobody's privacy guards is still named.
		expect(guardroom).toContain("is inside → The Rusty Flagon (back: holds)")
	}, 60_000)

	it("a delver's turn with no speaker wired names not even that delver's own lore", async () => {
		const rows = await rooms({ withLinks: true, currentCharacterId: characterId })
		expect(said(byName(rows, "The Guardroom")).join("\n")).not.toMatch(
			/Letters|Warden/
		)
	}, 60_000)

	it("a wired speaker is named what they may see, and only that", async () => {
		const rows = await rooms({
			withLinks: true,
			speaker: `character:${characterId}`
		})
		const guardroom = said(byName(rows, "The Guardroom"))
		expect(guardroom).toContain("hides → Aria's Letters")
		expect(guardroom.join("\n")).not.toMatch(/Warden/)
	}, 60_000)
})

/**
 * B6 (places plan §6.3): what the listing carries is what `{{locationEntry}}`
 * says under the room as "From here:" — through the host's real reading, so
 * the rule the prompt obeys is the one tested above, from either end.
 */
describe("{{locationEntry}}'s From here: block, from the real listing (B6)", () => {
	const standingIn = async (
		name: string,
		query: Record<string, unknown> = {}
	) => {
		const { locationVariables } = await import(
			"$lib/server/pipelines/prompt/adventureContext"
		)
		await import("@serene-pub/core-catalog")
		const rows = await rooms({ withLinks: true, ...query })
		return locationVariables(rows, {
			world: { location: name },
			slots: [{ id: "core:slot/location@1", appliesTo: ["world"] }]
		} as never).locationEntry
	}

	it("says the room's ways out from the room it stands under", async () => {
		expect(await standingIn("The Guardroom")).toBe(
			[
				"The Guardroom",
				"About The Guardroom.",
				"From here:",
				"- The rusted iron door leads north to The Drowned Hall.",
				"- Is inside The Rusty Flagon."
			].join("\n")
		)
	}, 60_000)

	it("says the same door from the far end, and a one-way door from where it starts", async () => {
		expect(await standingIn("The Drowned Hall")).toBe(
			[
				"The Drowned Hall",
				"About The Drowned Hall.",
				"From here:",
				"- The rusted iron door leads south to The Guardroom."
			].join("\n")
		)
		expect(await standingIn("The Crypt")).toBe(
			["The Crypt", "About The Crypt.", "From here:", "- Leads to The Guardroom."].join(
				"\n"
			)
		)
	}, 60_000)

	it("a room with nothing standing from it says no block", async () => {
		// The Well's one link is secret (and one way in), so nothing is said.
		expect(await standingIn("The Well")).toBe("The Well\nAbout The Well.")
	}, 60_000)

	it("never names a far end the speaker may not see", async () => {
		const said = await standingIn("The Guardroom", {
			currentCharacterId: characterId
		})
		expect(said).toContain("- The rusted iron door leads north to The Drowned Hall.")
		expect(said).not.toContain("Warden")
	}, 60_000)
})

describe("core:query/lorebook-entries@1's binding", () => {
	it("passes withLinks through, and asks for nothing when it is off", async () => {
		const asked: Record<string, unknown>[] = []
		const list = async (params: Record<string, unknown>) =>
			(
				(await coreBindings()["core:query/lorebook-entries@1"]!(
					{ scope: { sessionId, currentCharacterId: null }, params },
					{
						read: async (
							_: string,
							query: Record<string, unknown>
						) => {
							asked.push(query)
							return read(query)
						}
					} as any
				)) as any
			).value
		const on = await list({
			entryTypes: [LOCATION_TYPE_ID],
			withLinks: true
		})
		expect(asked.at(-1)).toMatchObject({ withLinks: true })
		// The door and the Flagon; no private far end with no speaker wired.
		expect(byName(on.main, "The Guardroom").links.length).toBe(2)
		await list({ entryTypes: [LOCATION_TYPE_ID] })
		expect(asked.at(-1)).toMatchObject({ withLinks: false })
	}, 60_000)
})

/**
 * The line and the moment (review round): `withLinks` reads the session's
 * reading, not the book's rows — a fork reads main's links and its own, never
 * a sibling fork's, and a session at a moment reads no link dated after it.
 */
describe("withLinks reads the session's line and moment", () => {
	let onFork: number
	let atYear5: number
	const roomsFor = (sid: number) => {
		const host = createHost(db as any, { sessionId: sid })
		return host.read!(
			"lorebook_entries",
			{
				sessionId: sid,
				currentCharacterId: null,
				enabled: true,
				archived: false,
				entryTypes: [LOCATION_TYPE_ID],
				withLinks: true
			},
			node as any
		) as Promise<any[]>
	}

	beforeAll(async () => {
		const [{ userId }] = await db
			.select({ userId: schema.lorebooks.userId })
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, lorebookId))
		const branch = async (name: string) =>
			(
				await db
					.insert(schema.lorebookBranches)
					.values({ lorebookId, name })
					.returning()
			)[0]!.id
		const session = async (over: Record<string, unknown>) =>
			(
				await db
					.insert(schema.sessions)
					.values({ userId, isGroup: false, lorebookId, ...over } as any)
					.returning()
			)[0]!.id
		for (const name of ["The Chapel", "The Belfry", "The Ossuary", "The Cloister", "The Yard", "The Mine"])
			await entry(name)
		const y3 = await entry("Year 3", HISTORY_TYPE_ID, { fields: { year: 3 } })
		const y9 = await entry("Year 9", HISTORY_TYPE_ID, { fields: { year: 9 } })
		const mine = await branch("The Flooded Line")
		const sibling = await branch("The Burnt Line")
		const from = { fromEntryId: id["The Chapel"] }
		await relate({ ...from, toEntryId: id["The Belfry"], relationshipType: "climbs to" })
		await relate({ ...from, toEntryId: id["The Ossuary"], relationshipType: "descends to", branchId: mine })
		await relate({ ...from, toEntryId: id["The Cloister"], relationshipType: "opens onto", branchId: sibling })
		await relate({ ...from, toEntryId: id["The Yard"], relationshipType: "leads out to", historyEntryId: y3 })
		await relate({ ...from, toEntryId: id["The Mine"], relationshipType: "tunnels to", historyEntryId: y9 })
		onFork = await session({ lorebookBranchId: mine })
		atYear5 = await session({ storyClockYear: 5 })
	}, 60_000)

	it("reads main's links and the fork's own on a fork, never a sibling fork's", async () => {
		expect(said(byName(await roomsFor(onFork), "The Chapel"))).toEqual([
			"climbs to → The Belfry",
			"descends to → The Ossuary",
			"leads out to → The Yard",
			"tunnels to → The Mine"
		])
	}, 60_000)

	it("reads no link dated after the session's moment", async () => {
		expect(said(byName(await roomsFor(atYear5), "The Chapel"))).toEqual([
			"climbs to → The Belfry",
			"leads out to → The Yard"
		])
	}, 60_000)
})
