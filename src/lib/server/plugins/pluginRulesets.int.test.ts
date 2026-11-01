/**
 * Rulesets a package ships: install publishes rows owned by the slug with
 * `created_by` NULL; an upgrade rewrites and retires what it dropped; a pub's
 * own row is never overwritten; uninstall retires only package rows.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import { rulesetDocumentOf } from "@serene-pub/sdk"
import { freeformRuleset } from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import { publishPluginRulesets, retirePluginRulesets } from "./pluginRulesets"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb

const SLUG = "acme.lab"
const docOf = (owner: string, name: string, version = "1.0.0") => ({
	...rulesetDocumentOf(freeformRuleset, version),
	id: `${owner}:ruleset/${name}@1`
})
const rowOf = async (id: string) =>
	(await db.select().from(schema.rulesets).where(eq(schema.rulesets.rulesetId, id)))[0]

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

describe("publishPluginRulesets", () => {
	test("publishes a row owned by the slug with created_by null and the version", async () => {
		const r = await publishPluginRulesets(db as never, SLUG, { rulesets: [docOf(SLUG, "one", "1.2.0")] })
		expect(r.refused).toEqual([])
		expect(r.published).toEqual([`${SLUG}:ruleset/one@1`])
		const row = await rowOf(`${SLUG}:ruleset/one@1`)
		expect(row.ownerSlug).toBe(SLUG)
		expect(row.createdBy).toBeNull()
		expect(row.publishedVersion).toBe("1.2.0")
		expect(row.retiredAt).toBeNull()
	})

	test("an upgrade rewrites the row and retires a ruleset the new version dropped", async () => {
		const slug = "acme.up"
		await publishPluginRulesets(db as never, slug, { rulesets: [docOf(slug, "a"), docOf(slug, "b")] })
		const r = await publishPluginRulesets(db as never, slug, { rulesets: [docOf(slug, "a", "1.1.0")] })
		expect(r.retired).toEqual([`${slug}:ruleset/b@1`])
		expect((await rowOf(`${slug}:ruleset/a@1`)).publishedVersion).toBe("1.1.0")
		expect((await rowOf(`${slug}:ruleset/b@1`)).retiredAt).not.toBeNull()
	})

	test("refuses a document under another owner", async () => {
		const r = await publishPluginRulesets(db as never, "acme.mine", { rulesets: [docOf("other.owner", "x")] })
		expect(r.published).toEqual([])
		expect(r.refused[0]).toBe("ruleset 'other.owner:ruleset/x@1' sits under 'other.owner', not 'acme.mine'.")
	})

	test("refuses to overwrite a pub-made row", async () => {
		const slug = "acme.clash"
		const userId = (await createTestUser(db)).id
		const id = `${slug}:ruleset/mine@1`
		await db.insert(schema.rulesets).values({ rulesetId: id, ownerSlug: slug, label: "mine", draft: {}, createdBy: userId })
		const r = await publishPluginRulesets(db as never, slug, { rulesets: [docOf(slug, "mine")] })
		expect(r.refused).toEqual([`'${id}' is a ruleset made on this pub; the package's copy was not installed over it.`])
		expect((await rowOf(id)).createdBy).toBe(userId)
	})
})

describe("retirePluginRulesets", () => {
	test("retires only package rows", async () => {
		const slug = "acme.gone"
		const userId = (await createTestUser(db)).id
		await publishPluginRulesets(db as never, slug, { rulesets: [docOf(slug, "pkg")] })
		await db.insert(schema.rulesets).values({ rulesetId: `${slug}:ruleset/pub@1`, ownerSlug: slug, label: "pub", draft: {}, createdBy: userId })
		const ids = await retirePluginRulesets(db as never, slug)
		expect(ids).toEqual([`${slug}:ruleset/pkg@1`])
		expect((await rowOf(`${slug}:ruleset/pub@1`)).retiredAt).toBeNull()
	})
})
