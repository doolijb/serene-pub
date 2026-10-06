/**
 * Every published pipeline has a shipped default config — core's or not.
 *
 * The invariant is stated in `config/named.ts`: *"Not a convention — an
 * invariant, established at publish. A pipeline with no config has no answer to
 * what does this do before anyone tunes it, and every surface that asks would
 * have to invent one independently."* It was reached from exactly one place,
 * `reconcileConfigs`, which was called only from `seedCoreSpecs` over
 * `CORE_SPECS` — so a plugin's pipeline or an imported document had **no
 * configuration at all**: no shipped default, no cull notice when a republish
 * dropped an option, no back-fill when one arrived.
 *
 * Migration 0115 names it while explaining why its own sweep found nothing to
 * sweep — "*a non-core spec has no configuration at all today and therefore
 * nothing materialized*" — and calls it a finding rather than a gap. This is the
 * finding, closed and pinned.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { saveDocument } from "$lib/server/pipelines/boot/store"
import { reconcilePublishedConfigs } from "$lib/server/pipelines/boot/seed"
import { spec, compile } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"

let db: TestDb

const SLUG = "acme.dice:spec/roll"

const rollSpec = () =>
	compile(
		spec(SLUG, { version: "1.0.0" })
			.inlet("input", C.userMessage.v1())
			.query("history", ($) =>
				C.sessionHistory.v1({ scope: $.input.sessionScope })
			)
			.build()
	)

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
}, 60_000)

describe("configs for a spec core did not ship", () => {
	it("gives an imported pipeline the shipped default every surface assumes", async () => {
		await saveDocument(db, rollSpec(), {
			publish: true,
			name: "Roll the dice"
		})

		await reconcilePublishedConfigs(db)

		const [config] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(
				eq(schema.pipelineConfigs.seedKey, `pipeline-default:${SLUG}`)
			)
			.limit(1)
		expect(
			config,
			"a pipeline with no config has no answer to what it does untouched"
		).toBeTruthy()
		expect(config.isImmutable).toBe(true)
		expect(config.isDefault).toBe(true)
	}, 60_000)

	it("still reconciles core's own, so the pass replaces rather than adds one", async () => {
		const [respond] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(
				eq(
					schema.pipelineConfigs.seedKey,
					"pipeline-default:core:spec/chat-respond"
				)
			)
			.limit(1)
		expect(respond).toBeTruthy()
	})

	it("reports per slug, which is how the seed pass picks out its own", async () => {
		const reports = await reconcilePublishedConfigs(db)
		expect(reports.has(SLUG)).toBe(true)
		expect(reports.has("core:spec/chat-respond")).toBe(true)
	}, 60_000)
})
