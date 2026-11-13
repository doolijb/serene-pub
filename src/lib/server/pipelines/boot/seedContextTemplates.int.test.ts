/**
 * 🚧 The Default context template reaches an install that already has it.
 *
 * The seed re-projects core's row by `seedKey` when its source drifts from
 * the code; a person's own template has `seedKey` NULL and is never touched.
 * An install booted before the *Earlier in the story* block was added holds
 * the previous template — this proves the next boot brings the block, leaves
 * a person's copy of the previous template exactly as written, and that a
 * boot after that changes nothing.
 */
import { describe, it, expect, beforeAll, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { seedContextTemplates } from "$lib/server/pipelines/boot/seedContextTemplates"
import {
	CONTEXT_TEMPLATE_NODE_TYPE,
	CONTEXT_TEMPLATE_SEED_KEY,
	SHIPPED_CONTEXT_TEMPLATE,
	poolKeyFor
} from "$lib/server/pipelines/entities/contextTemplateDefaults"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const EARLIER_BLOCK = `{{#if earlierScenes}}
{{{earlierScenes}}}
{{/if}}
`

let db: TestDb

const defaultRow = async () =>
	(
		await db
			.select()
			.from(schema.pipelineContextTemplates)
			.where(
				eq(
					schema.pipelineContextTemplates.seedKey,
					CONTEXT_TEMPLATE_SEED_KEY
				)
			)
	)[0]

beforeAll(async () => {
	db = await createTestDb()
})

describe("the Default context template and the earlier-scenes block", () => {
	it("refreshes core's row, leaves a person's copy alone, and a second boot changes nothing", async () => {
		const previous = SHIPPED_CONTEXT_TEMPLATE.replace(EARLIER_BLOCK, "")
		expect(previous).not.toBe(SHIPPED_CONTEXT_TEMPLATE)

		const first = await seedContextTemplates(db)
		expect(first.created).toContain(CONTEXT_TEMPLATE_SEED_KEY)

		await db
			.update(schema.pipelineContextTemplates)
			.set({ source: previous })
			.where(
				eq(
					schema.pipelineContextTemplates.seedKey,
					CONTEXT_TEMPLATE_SEED_KEY
				)
			)
		const [own] = await db
			.insert(schema.pipelineContextTemplates)
			.values({
				nodeDefinitionId: poolKeyFor(CONTEXT_TEMPLATE_NODE_TYPE),
				name: "My own story string",
				source: previous,
				seedKey: null
			})
			.returning()

		const second = await seedContextTemplates(db)
		expect(second.refreshed).toContain(CONTEXT_TEMPLATE_SEED_KEY)
		expect((await defaultRow()).source).toBe(SHIPPED_CONTEXT_TEMPLATE)
		const [ownAfter] = await db
			.select()
			.from(schema.pipelineContextTemplates)
			.where(and(eq(schema.pipelineContextTemplates.id, own.id)))
		expect(ownAfter).toEqual(own)

		const before = await defaultRow()
		const third = await seedContextTemplates(db)
		expect(third.refreshed).toEqual([])
		expect(third.present).toContain(CONTEXT_TEMPLATE_SEED_KEY)
		const after = await defaultRow()
		expect(after.updatedAt).toEqual(before.updatedAt)
		expect(after).toEqual(before)
	})
})
