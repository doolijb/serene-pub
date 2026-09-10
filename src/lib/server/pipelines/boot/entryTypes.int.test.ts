/**
 * Entry types through the one registry (Part 1, step 1).
 *
 * The claim being checked is deliberately small: core's three lorebook shapes
 * are *declarations* that reach the database through the machinery node types
 * already use — one `snapshotRegistry`, one table, one content hash, one boot
 * sync — and come back out of it unchanged.
 *
 * Nothing reads these yet. No table moved, no retrieval path changed, and the
 * three lore tables are untouched; what this file proves is that the vocabulary
 * survives a round trip and that the freeze rule has hold of the right half of
 * it.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import {
	syncTypeRegistry,
	readTypeRegistry,
	typeContentHash
} from "$lib/server/pipelines/boot/registrySync"
import { allEntryTypes, snapshotRegistry } from "@serene-pub/sdk"
import type { RegistryEntry } from "@serene-pub/sdk"
// Declaring an entry type registers it, so importing the catalog is what puts
// core's three in `allEntryTypes()` — the same fact-about-the-code route the
// contracts take for node types, and the one boot follows through
// `specs/respond`.
import "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"

let db: TestDb

beforeAll(async () => {
	// Skipped: this file is about the sync publishing them, so it needs a
	// registry that has not been published to yet.
	db = await createTestDb({ skipEntryTypes: true })
}, 60_000)

const PINS = [
	"core:entry/world-lore@1",
	"core:entry/character-lore@1",
	"core:entry/history@1"
]

const rowFor = async (typeId: string) => {
	const [row] = await db
		.select()
		.from(schema.pipelineTypeRegistry)
		.where(eq(schema.pipelineTypeRegistry.typeId, typeId))
	return row as any
}

describe("core's entry types reach the registry", () => {
	it("projects all three as rows of kind 'entry'", async () => {
		const r = await syncTypeRegistry(db, allEntryTypes(), {
			release: "0.6.0"
		})
		expect(r.inserted.sort()).toEqual([...PINS].sort())

		const rows = await db.select().from(schema.pipelineTypeRegistry)
		expect(rows.length).toBe(3)
		for (const row of rows as any[]) expect(row.kind).toBe("entry")
	})

	it("is idempotent, so it rides the same unconditional boot step", async () => {
		const again = await syncTypeRegistry(db, allEntryTypes(), {
			release: "0.6.0"
		})
		expect(again.inserted).toEqual([])
		expect(again.updated).toEqual([])
		expect(again.unchanged.sort()).toEqual([...PINS].sort())
	})

	it("stores the contract in entry_shape and the declared fields in config_schema", async () => {
		const history = await rowFor("core:entry/history")
		expect(history.entryShape.sourceKind).toBe("history")
		expect(history.entryShape.exportKey).toBe("history")
		expect(history.entryShape.render).toBe("core:var/history@1")
		// Structured order keys, not a string the engine would have to parse.
		expect(history.entryShape.roles.order).toEqual([
			{ field: "year", dir: "desc", nulls: "last" },
			{ field: "month", dir: "desc", nulls: "last" },
			{ field: "day", dir: "desc", nulls: "last" }
		])
		// The schema half lives in the column that already exists for a schema
		// — the one the constraint and index projection will read by name.
		expect(Object.keys(history.configSchema)).toEqual([
			"year",
			"month",
			"day",
			"isCompleted",
			"graphed"
		])
		expect(history.configSchema.year.required).toBe(true)
		expect(history.entryShape.fields).toBeUndefined()

		const characterLore = await rowFor("core:entry/character-lore")
		expect(characterLore.entryShape.roles.anchor).toEqual({
			column: "anchorBindingId",
			policy: "core:policy/binding-visibility@1"
		})
		expect(characterLore.entryShape.render).toEqual({
			into: "character-card"
		})
	})

	it("round-trips through the reader with the hash it was written with", async () => {
		// ⚠ `readTypeRegistry` rebuilds a `RegistryEntry` field by field, so a
		// projected field the reader forgets disappears silently — and for a
		// *hashed* field that means the same row hashes differently depending
		// on which direction it was travelling.
		const readBack = new Map(
			(await readTypeRegistry(db)).map((e) => [
				`${e.id}@${e.version}`,
				e
			])
		)

		for (const t of allEntryTypes()) {
			const [projected] = snapshotRegistry([t], { release: "0.6.0" })
			const pin = `${projected!.id}@${projected!.version}`
			const back = readBack.get(pin)
			expect(back, `${pin} did not come back`).toBeTruthy()
			expect(back!.entryShape).toEqual(projected!.entryShape)
			expect(back!.configSchema).toEqual(projected!.configSchema)
			expect(typeContentHash(back!), pin).toBe(
				typeContentHash(projected!)
			)
		}
	})

	it("refreshes a relabelled field in place — display text is not a version", async () => {
		// The promise the strip makes, kept: a form renders from the row, so a
		// field reworded after shipping has to reach installs whose rows
		// predate the rewording. Built as a plain object rather than a second
		// `describeEntryType` call, because an id may only be declared once per
		// process — what this simulates is core's *next build*.
		const base = allEntryTypes().find(
			(t) => t.id === "core:entry/world-lore@1"
		)!
		const reworded = {
			...base,
			entryShape: {
				...base.entryShape,
				fields: {
					...base.entryShape.fields,
					priority: {
						...base.entryShape.fields!.priority!,
						i18n: { en: "Importance" }
					}
				}
			}
		} as any

		const r = await syncTypeRegistry(db, [reworded], {
			release: "0.6.0"
		})
		expect(r.updated).toEqual(["core:entry/world-lore@1"])
		const row = await rowFor("core:entry/world-lore")
		expect(row.configSchema.priority.i18n.en).toBe("Importance")

		// Put the build's own wording back, so nothing after this reads a
		// doctored row.
		const restored = await syncTypeRegistry(db, [base], {
			release: "0.6.0"
		})
		expect(restored.updated).toEqual(["core:entry/world-lore@1"])
	})
})

describe("which half of a declaration is frozen", () => {
	const projected = (): RegistryEntry =>
		snapshotRegistry(
			allEntryTypes().filter((t) => t.id === "core:entry/world-lore@1"),
			{ release: "0.6.0" }
		)[0]!

	it("copyediting display text does not move the hash", () => {
		const base = projected()
		const reworded: RegistryEntry = {
			...base,
			i18n: { name: { en: "Something else entirely" } },
			description: "and a different explanation"
		} as any
		expect(typeContentHash(reworded)).toBe(typeContentHash(base))
	})

	it("relabelling a declared field does not move it either", () => {
		// The promise that makes the schema renderable: a field's label and
		// help text are display, and the sync refreshes them on the row rather
		// than treating a rewording as a new version.
		const base = projected()
		const reworded: RegistryEntry = {
			...base,
			configSchema: {
				...base.configSchema,
				priority: {
					...base.configSchema!.priority!,
					i18n: { en: "Importance" },
					description: { en: "Reworded after shipping." }
				}
			}
		}
		expect(typeContentHash(reworded)).toBe(typeContentHash(base))
	})

	it("changing a field role does move it — a field role is contract", () => {
		// The consequence, and it is the correct one: the ranker asks the type
		// which field is priority, so answering differently changes what an
		// untouched install does. That is `@2`, not an edit in place.
		const base = projected()
		const moved: RegistryEntry = {
			...base,
			entryShape: {
				...base.entryShape!,
				roles: { ...base.entryShape!.roles, priority: "weight" }
			}
		}
		expect(typeContentHash(moved)).not.toBe(typeContentHash(base))
	})

	it("changing the declared fields schema moves it — a schema is a constraint", () => {
		const base = projected()
		const widened: RegistryEntry = {
			...base,
			configSchema: {
				...base.configSchema,
				priority: { ...base.configSchema!.priority!, max: 5 }
			}
		}
		expect(typeContentHash(widened)).not.toBe(typeContentHash(base))
	})

	it("a node type hashes exactly as it did before entry types existed", () => {
		// Both new fields are `undefined` on every node type and
		// `JSON.stringify` drops undefined keys, which is the whole reason no
		// re-projection migration comes with this.
		const node: RegistryEntry = {
			id: "core:task/example",
			version: 1,
			kind: "task",
			ports: { in: {}, out: {} },
			slots: {}
		}
		expect(typeContentHash(node)).toBe(
			typeContentHash({
				...node,
				entryShape: undefined,
				configSchema: undefined
			})
		)
	})
})
