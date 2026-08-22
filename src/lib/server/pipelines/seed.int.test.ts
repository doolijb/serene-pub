/**
 * What startup seeds, and the three different rules it seeds under.
 *
 * The interesting claims are not "rows appear" — they are the *differences*
 * between the three kinds, because each difference is a decision somebody could
 * reasonably undo:
 *
 *  1. **The event set is derived, not maintained.** 11 §2 puts the cause of an
 *     event on the Consumer that causes it. A hand-kept list would drift the
 *     first time a Consumer changed, and drift silently.
 *  2. **Events update where types refuse.** Nothing pins an event, so a
 *     corrected description ships; a type version is a pin, so it never does.
 *  3. **A published spec is left alone.** Re-seeding one would clobber the
 *     version a run in flight resolved against (F3).
 *
 * And the property all three share: running twice changes nothing, which is what
 * lets this run unconditionally at boot rather than behind a "have we migrated
 * yet" flag — a flag that eventually lies.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { coreEvents, syncEventRegistry, seedCoreSpecs } from "./seed"
import { CORE_SPECS } from "./specs"
import { bootstrapPipelines } from "./bootstrap"

let db: TestDb

// The db module is mocked so `defaults.sync()` runs against the test DB —
// pipeline prompt seeding copies its prose from the legacy rows that sync
// seeds, which is exactly the boot order `db/index.ts` guarantees (defaults
// first, then bootstrapPipelines). A seed test without the legacy rows would
// be testing an instance that cannot exist.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "seed-test-secret" }
})

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-seed-test-")
	)
	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db as any)
}, 120_000)

describe("the core event set", () => {
	it("derives its data events from the Consumers that cause them", () => {
		// Not a list in this file. `createMessage` declares
		// `causesEvent: 'core:event/message-created@1'`, so the event exists
		// because the Consumer does — which is what keeps the two from drifting.
		const events = coreEvents()
		const slugs = events.map((e) => e.slug)
		expect(slugs).toContain("core:event/message-created")
		expect(slugs).toContain("core:event/message-updated")

		const created = events.find(
			(e) => e.slug === "core:event/message-created"
		)!
		expect(created.family).toBe("data")
	})

	it("carries the action events nothing can cause", () => {
		// An ACTION event has no causing Consumer by construction — a person
		// clicked, or a clock ticked — so these cannot be derived and are the
		// only ones written by hand.
		const bySlug = new Map(coreEvents().map((e) => [e.slug, e]))
		expect(bySlug.get("core:event/ui-action")?.family).toBe("action")
		expect(bySlug.get("core:event/schedule-tick")?.family).toBe("action")
	})

	it("marks an event that touches someone's content as affecting them", async () => {
		// 11 §4: declared once, on the event, so consent is enforceable without
		// classifying every subscription by hand.
		const [row] = await db
			.select()
			.from(schema.pipelineEventRegistry)
			.where(
				eq(
					schema.pipelineEventRegistry.slug,
					"core:event/message-created"
				)
			)
		expect(row.affectsUser).toBe(true)

		const [tick] = await db
			.select()
			.from(schema.pipelineEventRegistry)
			.where(
				eq(
					schema.pipelineEventRegistry.slug,
					"core:event/schedule-tick"
				)
			)
		expect(tick.affectsUser).toBe(false)
	})

	it("leaves payload_shape null rather than inventing one", async () => {
		// A subscription's shape-compatibility check reads this column. Writing a
		// speculative value would make that check pass against a shape nobody
		// declared, which is worse than it having nothing to check yet.
		const rows = await db.select().from(schema.pipelineEventRegistry)
		expect(rows.length).toBeGreaterThan(0)
		for (const r of rows) expect(r.payloadShape).toBeNull()
	})

	it("re-syncs to no writes at all", async () => {
		const again = await syncEventRegistry(db as any)
		expect(again.inserted).toEqual([])
		expect(again.updated).toEqual([])
		expect(again.unchanged.length).toBeGreaterThan(0)
	})

	it("updates a changed description instead of refusing it", async () => {
		// The difference from `syncTypeRegistry`, which raises on exactly this.
		// Nothing pins an event's description, so a correction has to be able to
		// ship — otherwise it needs a version bump that means nothing to anyone.
		await db
			.update(schema.pipelineEventRegistry)
			.set({ descriptionI18n: { en: "stale text from an older build" } })
			.where(
				eq(
					schema.pipelineEventRegistry.slug,
					"core:event/message-created"
				)
			)

		const res = await syncEventRegistry(db as any)
		expect(res.updated).toContain("core:event/message-created@1")

		const [row] = await db
			.select()
			.from(schema.pipelineEventRegistry)
			.where(
				eq(
					schema.pipelineEventRegistry.slug,
					"core:event/message-created"
				)
			)
		expect((row.descriptionI18n as any).en).toBe(
			"A message was written into a chat."
		)
	})
})

describe("core's specs", () => {
	it("publishes every pipeline in the registry, named for a person", async () => {
		// The registry is one row per pipeline precisely so this cannot pass with
		// a spec whose display name is its slug.
		for (const entry of CORE_SPECS) {
			const [spec] = await db
				.select()
				.from(schema.pipelineSpecs)
				.where(eq(schema.pipelineSpecs.slug, entry.slug))
			expect(spec, `${entry.slug} was not published`).toBeTruthy()
			expect(spec.name).toBe(entry.name)
			expect(spec.name).not.toBe(spec.slug)
			expect(spec.activeVersionId).toBeTruthy()
		}
	})

	it("leaves an already-published version alone on the next boot", async () => {
		// F3: a published version is what a run resolved against. Re-publishing
		// would either clobber a run in flight or need an exception here.
		const before = await db.select().from(schema.pipelineSpecVersions)

		const report = await seedCoreSpecs(db as any)
		expect(report.every((r) => r.action === "present")).toBe(true)

		const after = await db.select().from(schema.pipelineSpecVersions)
		expect(after.map((v: any) => v.id).sort()).toEqual(
			before.map((v: any) => v.id).sort()
		)
	})

	it("ships every pipeline with a declared, immutable default config", async () => {
		// The ruling: every pipeline has at least one shipped, immutable
		// default config. Not an empty shell — its prompts-slot declarations
		// point at the namespace's shipped prompt, so the pipeline runs with
		// instructions the first time anyone presses the button. Connection
		// and sampling are deliberately unset here: they fall back to the
		// instance default (sampling is owned by sampling configs, system
		// default with per-config override).
		const { declarations } = await import("./config")
		for (const entry of CORE_SPECS) {
			const [spec] = await db
				.select()
				.from(schema.pipelineSpecs)
				.where(eq(schema.pipelineSpecs.slug, entry.slug))

			const configs = await db
				.select()
				.from(schema.pipelineConfigs)
				.where(eq(schema.pipelineConfigs.specId, spec.id))
			const shipped = configs.find(
				(c: any) => c.isImmutable && c.isDefault
			)
			expect(
				shipped,
				`${entry.slug} has no shipped immutable default config`
			).toBeTruthy()

			// Every prompts-ref declaration carries a value in the shipped
			// config — a namespace whose steps run without instructions reads
			// as the model failing, not as a missing selection.
			expect(spec.activeVersionId).toBeTruthy()
			const decls = await declarations(db as any, spec.activeVersionId!)
			const promptDecls = decls.filter(
				(d: any) => d.control === "prompts-ref"
			)
			const values = await db
				.select()
				.from(schema.pipelineConfigValues)
				.where(eq(schema.pipelineConfigValues.configId, shipped!.id))
			for (const d of promptDecls) {
				const v = (values as any[]).find(
					(row) =>
						row.nodeKey === d.nodeKey &&
						row.slot === d.slot &&
						(row.path ?? "") === d.path
				)
				expect(
					v?.value,
					`${entry.slug} shipped config has no prompt for ${d.nodeKey}.${d.slot}`
				).toBeTruthy()
			}

			// And the prompt it points at is a real, shipped, immutable row.
			const prompts = await db
				.select()
				.from(schema.pipelinePrompts)
				.where(eq(schema.pipelinePrompts.specId, spec.id))
			expect(
				prompts.some((p: any) => p.isImmutable),
				`${entry.slug} has no shipped prompt row`
			).toBe(true)
		}
	})

	it("subscribes each spec to the event it declared", async () => {
		const subs = await db.select().from(schema.pipelineEventSubscriptions)
		expect(subs.length).toBeGreaterThan(0)
		// Every subscription names an event core actually registered — the check
		// that would fail the day a spec subscribes to something invented.
		const registered = new Set(
			(await db.select().from(schema.pipelineEventRegistry)).map(
				(e: any) => `${e.slug}@${e.version}`
			)
		)
		for (const s of subs) expect(registered.has(s.eventRef)).toBe(true)
	})
})

describe("bootstrap as a whole", () => {
	it("reports what it did, and does nothing the second time", async () => {
		const report = await bootstrapPipelines(db as any)
		expect(report.conflict).toBeUndefined()
		expect(report.events.inserted).toBe(0)
		expect(report.events.updated).toBe(0)
		expect(report.events.unchanged).toBeGreaterThan(0)
		expect(report.specs.every((s) => s.action === "present")).toBe(true)
	})
})
