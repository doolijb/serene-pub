/**
 * Folded sections (B4; owner decision D5, 2026-09-27): a reply can carry named
 * sections beside its body — a Plan, a step's notes — written through the
 * message outlets' `sections` in-port, stored per swipe, projected as
 * `core:section` parts, carried to widgets by the safe row projection, and
 * never read into the prompt transcript.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { projectMessageRow } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

let db: TestDb
let dataDir: string
let userId: number
let sessionId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-folded-sections-int-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "folded-sections-user")).id
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	sessionId = session.id
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const create = { key: "placeholder", definitionId: "core:outlet/create-message" }
const save = { key: "save", definitionId: "core:outlet/update-message" }

const plan = {
	kind: "plan",
	label: "Plan",
	items: ["Wren — draws her blade", "The goblin — flees"]
}

async function host() {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(db as any, { sessionId, userId })
}

async function partsOf(id: number) {
	const { getMessage } = await import("./store")
	const msg = (await getMessage(db as any, id))!
	const active = msg.activeRevisions["0"] ?? 0
	return msg.parts
		.filter((p) => p.step === 0 && p.revision === active)
		.sort((a, b) => a.ordinal - b.ordinal)
}

async function legacy(id: number) {
	const [row] = await db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, id))
	return row!
}

/** A placeholder, finished by a save carrying `sections`. */
async function reply(sections: unknown, text = "The goblin bolts.") {
	const h = await host()
	const made = (await h.commit!({ generating: true }, create as any)) as {
		id: number
	}
	await h.commit!(
		{ target: made.id, text, thinking: "It is cornered.", sections },
		save as any
	)
	return made.id
}

describe("an outlet write with sections stores them", () => {
	it("update-message finishing a reply: Plan, thinking, then the body", async () => {
		const id = await reply([plan])
		const parts = await partsOf(id)
		expect(parts.map((p) => p.type)).toEqual([
			"core:section",
			"core:thinking",
			"core:markdown"
		])
		expect(parts[0]!.data).toEqual({
			title: "Plan",
			kind: "plan",
			items: ["Wren — draws her blade", "The goblin — flees"]
		})
		expect(parts[0]!.content).toBe(
			"- Wren — draws her blade\n- The goblin — flees"
		)
		// The body is the reply alone.
		expect(parts[2]!.content).toBe("The goblin bolts.")
		expect((await legacy(id)).content).toBe("The goblin bolts.")
	})

	it("create-message writing a whole reply stores them too", async () => {
		const h = await host()
		const made = (await h.commit!(
			{
				text: "A door creaks.",
				sections: [{ kind: "notes", label: "Step notes", content: "Low light." }]
			},
			create as any
		)) as { id: number }
		const parts = await partsOf(made.id)
		expect(parts.map((p) => [p.type, p.content])).toEqual([
			["core:section", "Low light."],
			["core:markdown", "A door creaks."]
		])
		expect(parts[0]!.data).toEqual({ title: "Step notes", kind: "notes" })
	})

	it("a malformed section is refused by name, and nothing is half-written", async () => {
		const h = await host()
		const made = (await h.commit!({ generating: true }, create as any)) as {
			id: number
		}
		await expect(
			h.commit!(
				{ target: made.id, text: "x", sections: [{ kind: "plan", label: "" }] },
				save as any
			) as Promise<unknown>
		).rejects.toThrow(/save.*section 1.*label/)
		expect((await legacy(made.id)).isGenerating).toBe(true)
	})

	it("a regenerate replaces the slot's sections; a save with none clears them", async () => {
		const id = await reply([plan])
		const { updateLegacy } = await import("./store")
		const h = await host()
		const redo = async (sections: unknown) => {
			await updateLegacy(db as any, id, { isGenerating: true })
			await h.commit!(
				{ target: id, text: "Again.", ...(sections ? { sections } : {}) },
				save as any
			)
		}
		await redo([{ kind: "plan", label: "Plan", items: ["Only Wren"] }])
		expect(
			(await partsOf(id))
				.filter((p) => p.type === "core:section")
				.map((p) => p.content)
		).toEqual(["- Only Wren"])
		await redo(undefined)
		expect(
			(await partsOf(id)).filter((p) => p.type === "core:section")
		).toEqual([])
	})

	it("each swipe keeps its own sections", async () => {
		const id = await reply([plan], "First.")
		const { updateLegacy, getMessage } = await import("./store")
		const row = await legacy(id)
		// A fresh alternative, as the swipe write leaves it: a second slot,
		// selected, generating.
		await updateLegacy(db as any, id, {
			isGenerating: true,
			metadata: {
				...(row.metadata as object),
				swipes: { currentIdx: 1, history: ["First.", ""] }
			}
		})
		const h = await host()
		await h.commit!(
			{
				target: id,
				text: "Second.",
				sections: [{ kind: "plan", label: "Plan", items: ["Nobody moves"] }]
			},
			save as any
		)
		const msg = (await getMessage(db as any, id))!
		const byRevision = (r: number) =>
			msg.parts
				.filter((p) => p.revision === r && p.type === "core:section")
				.map((p) => p.content)
		expect(byRevision(0)).toEqual([
			"- Wren — draws her blade\n- The goblin — flees"
		])
		expect(byRevision(1)).toEqual(["- Nobody moves"])
	})
})

describe("the row projection carries them to widgets", () => {
	it("attachParts → projectMessageRow keeps the section parts", async () => {
		const id = await reply([plan])
		const { attachParts } = await import("./store")
		const [withParts] = await attachParts(db as any, [await legacy(id)])
		const posted = projectMessageRow(withParts as Record<string, unknown>)
		const sections = (posted.parts as any[]).filter(
			(p) => p.type === "core:section"
		)
		expect(sections).toHaveLength(1)
		expect(sections[0].data).toEqual({
			title: "Plan",
			kind: "plan",
			items: ["Wren — draws her blade", "The goblin — flees"]
		})
		// Host bookkeeping still never crosses.
		expect(posted).not.toHaveProperty("userId")
	})
})

describe("the prompt transcript excludes them", () => {
	it("process-messages reads the body only — no plan, no thinking", async () => {
		const id = await reply([plan])
		const { processMessages } = await import(
			"$lib/server/pipelines/prompt/messages"
		)
		const out = processMessages({
			cast: {},
			charName: "Wren",
			personaName: "You",
			messages: [(await legacy(id)) as any]
		})
		const text = JSON.stringify(out.messages)
		expect(text).toContain("The goblin bolts.")
		expect(text).not.toContain("draws her blade")
		expect(text).not.toContain("It is cornered.")
	})
})
