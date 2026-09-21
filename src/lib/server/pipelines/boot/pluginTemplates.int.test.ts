/**
 * A package's `templates` declarations, as rows (R19).
 *
 * An extension could already ship `pipelines`, and had no way at all to ship a
 * template row one of them references. So a plugin's pipeline started on
 * whatever core's pool heuristics resolved — core's own prompt, written for
 * core's own pipeline — or on nothing at all for a node core knows nothing
 * about. The prose an author wrote their pipeline around had nowhere to live.
 *
 * Three properties beyond "the row appears", and each is about who decides
 * what:
 *
 *  · it arrives **immutable**, because its content is determined entirely by
 *    the package: editing it in place would be edited away on the next enable,
 *    and duplicating is how somebody makes it theirs;
 *  · disabling the package **marks** the row rather than deleting it, because a
 *    pipeline's stored configuration holds the row's integer id and switching
 *    an extension off is a reversible, everyday act — the same argument
 *    `session_presets` makes, one step removed (a preset is named by a session,
 *    a template by a configuration);
 *  · the declaration is **validated here**, not trusted from the manifest.
 *    `defineExtension` refuses a malformed one while the author is writing it
 *    and install stores the manifest verbatim, so the rule has to be applied
 *    again where the row is written.
 *
 * ⚠ Unlike a preset, a projected template is NOT disabled on arrival. `enabled`
 * on a preset is the instance owner's decision about what non-admins are
 * offered; a template row sits in an administrator's picker beside every other
 * row and is selected by nothing until one of them selects it.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { syncPluginTemplates } from "$lib/server/pipelines/boot/registrySync"
import * as schema from "$lib/server/db/schema"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const PLUGIN = "acme.dice"
const PROMPT_ID = `${PLUGIN}:template/table-narration@1`
const CONTEXT_ID = `${PLUGIN}:template/table-context@1`
const LAYOUT_ID = `${PLUGIN}:template/dice-cast@1`
const HANDLEBARS = "core:template/handlebars@1"

let db: TestDb
let pluginRowId: number

const templates = () => [
	{
		id: PROMPT_ID,
		kind: "prompts",
		nodeDefinitionId: "core:task/build-template-context",
		slot: "prompts",
		label: "Table narration",
		body: { systemPrompt: "Narrate the roll." }
	},
	{
		id: CONTEXT_ID,
		kind: "template",
		nodeDefinitionId: "core:task/assemble",
		engine: HANDLEBARS,
		label: "Table context",
		body: "{{{instructions}}}"
	},
	{
		id: LAYOUT_ID,
		kind: "variables",
		variableId: "core:var/characters@1",
		engine: HANDLEBARS,
		label: "Dice cast",
		body: "{{{json characters 2}}}"
	}
]

const manifest = (over: Record<string, unknown> = {}) => ({
	slug: PLUGIN,
	templates: templates(),
	...over
})

const install = async (opts: {
	pluginId?: string
	enabled: boolean
	manifest: Record<string, unknown>
}) => {
	const [row] = await db
		.insert(schema.plugins)
		.values({
			pluginId: opts.pluginId ?? PLUGIN,
			name: "Dice Tray",
			bundleSource: "//",
			bundleHash: "sha256:test",
			backends: ["quickjs"],
			backend: "quickjs",
			enabled: opts.enabled,
			manifest: opts.manifest
		})
		.onConflictDoUpdate({
			target: schema.plugins.pluginId,
			set: { enabled: opts.enabled, manifest: opts.manifest }
		})
		.returning()
	return row
}

const promptRow = async (id = PROMPT_ID) =>
	(
		await db
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.templateId, id))
			.limit(1)
	)[0] as any

const contextRow = async () =>
	(
		await db
			.select()
			.from(schema.pipelineContextTemplates)
			.where(eq(schema.pipelineContextTemplates.templateId, CONTEXT_ID))
			.limit(1)
	)[0] as any

const layoutRow = async () =>
	(
		await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.templateId, LAYOUT_ID))
			.limit(1)
	)[0] as any

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const row = await install({ enabled: true, manifest: manifest() })
	pluginRowId = row.id
})

describe("a package ships template rows beside its pipelines", () => {
	it("projects one row per declaration, into the table its kind names", async () => {
		const report = await syncPluginTemplates(db)
		expect(report.projected.sort()).toEqual(
			[PROMPT_ID, CONTEXT_ID, LAYOUT_ID].sort()
		)
		expect(report.refused).toEqual([])

		const prompt = await promptRow()
		expect(prompt.nodeDefinitionId).toBe("core:task/build-template-context")
		expect(prompt.slot).toBe("prompts")
		expect(prompt.name).toBe("Table narration")
		expect(prompt.fields).toEqual({ systemPrompt: "Narrate the roll." })
		// Immutable: the content is the package's, and an edit here would be
		// edited away on the next enable. Duplicating is how somebody makes it
		// theirs.
		expect(prompt.isImmutable).toBe(true)
		expect(prompt.ownerPluginId).toBe(pluginRowId)
		expect(prompt.withdrawnAt).toBeNull()
		// NOT disabled on arrival — a template is not offered to non-admins the
		// way a preset is; it sits in a picker and is selected by nobody until
		// an administrator selects it.
		expect(prompt.seedKey).toBeNull()

		expect((await contextRow()).source).toBe("{{{instructions}}}")
		expect((await contextRow()).engine).toBe(HANDLEBARS)
		expect((await layoutRow()).variableId).toBe("core:var/characters@1")
	})

	it("is idempotent — a second pass rewrites, never duplicates", async () => {
		await syncPluginTemplates(db)
		const rows = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.templateId, PROMPT_ID))
		expect(rows.length).toBe(1)
	})

	it("carries an edit the package made through on the next enable", async () => {
		const edited = templates()
		;(edited[0] as any).body = { systemPrompt: "Narrate it well." }
		await install({ enabled: true, manifest: manifest({ templates: edited }) })
		await syncPluginTemplates(db)
		expect((await promptRow()).fields).toEqual({
			systemPrompt: "Narrate it well."
		})
	})

	it("marks withdrawn on disable, and never deletes", async () => {
		await install({ enabled: false, manifest: manifest() })
		const report = await syncPluginTemplates(db)
		expect(report.withdrawn.sort()).toEqual(
			[PROMPT_ID, CONTEXT_ID, LAYOUT_ID].sort()
		)

		const prompt = await promptRow()
		// The row a configuration may already point at is still there, and it
		// still says what it said.
		expect(prompt).toBeTruthy()
		expect(prompt.withdrawnAt).toBeInstanceOf(Date)
		expect(prompt.fields).toEqual({ systemPrompt: "Narrate it well." })
	})

	it("restores on re-enable, clearing the mark", async () => {
		await install({ enabled: true, manifest: manifest() })
		const report = await syncPluginTemplates(db)
		expect(report.restored.sort()).toEqual(
			[PROMPT_ID, CONTEXT_ID, LAYOUT_ID].sort()
		)
		expect((await promptRow()).withdrawnAt).toBeNull()
	})

	it("withdraws a template the package stopped declaring", async () => {
		await install({
			enabled: true,
			manifest: manifest({ templates: [templates()[0]] })
		})
		const report = await syncPluginTemplates(db)
		expect(report.withdrawn.sort()).toEqual([CONTEXT_ID, LAYOUT_ID].sort())
		expect((await promptRow()).withdrawnAt).toBeNull()
		expect((await contextRow()).withdrawnAt).toBeInstanceOf(Date)

		await install({ enabled: true, manifest: manifest() })
		await syncPluginTemplates(db)
	})
})

describe("the manifest is stored verbatim, so the rule runs again here", () => {
	it("refuses a template under somebody else's namespace", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const foreign = templates()
			;(foreign[0] as any).id = "acme.other:template/table-narration@1"
			await install({
				enabled: true,
				manifest: manifest({ templates: foreign })
			})
			const report = await syncPluginTemplates(db)
			expect(
				report.refused.some((r) =>
					r.includes("acme.other:template/table-narration@1")
				)
			).toBe(true)
			expect(await promptRow("acme.other:template/table-narration@1")).toBeUndefined()
		} finally {
			warn.mockRestore()
			await install({ enabled: true, manifest: manifest() })
			await syncPluginTemplates(db)
		}
	})

	it("refuses a declaration whose shape its kind does not admit", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const bad = templates()
			// A prompts row's body is field name → prose; a string would render
			// blanks in every field the slot declares.
			;(bad[0] as any).body = "Narrate the roll."
			await install({
				enabled: true,
				manifest: manifest({ templates: bad })
			})
			const report = await syncPluginTemplates(db)
			expect(report.refused.some((r) => r.includes(PROMPT_ID))).toBe(true)
		} finally {
			warn.mockRestore()
			await install({ enabled: true, manifest: manifest() })
			await syncPluginTemplates(db)
		}
	})

	it("will not take over a row another package owns", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			// A second package declaring the first's id. `template_id` is unique,
			// so this is the one way one package's row could quietly become
			// another's — and an id carries its owner, so it cannot be right.
			await install({
				pluginId: "acme.other",
				enabled: true,
				manifest: { slug: "acme.other", templates: templates() }
			})
			const report = await syncPluginTemplates(db)
			expect(report.refused.length).toBeGreaterThan(0)
			expect((await promptRow()).ownerPluginId).toBe(pluginRowId)
		} finally {
			warn.mockRestore()
			await db
				.delete(schema.plugins)
				.where(eq(schema.plugins.pluginId, "acme.other"))
			await syncPluginTemplates(db)
		}
	})

	it("leaves core's own rows alone — they have no owner to sweep", async () => {
		const [core] = await db
			.select()
			.from(schema.pipelineContextTemplates)
			.where(
				eq(
					schema.pipelineContextTemplates.seedKey,
					"pipeline-context-template:core:default"
				)
			)
		expect(core.ownerPluginId).toBeNull()
		expect(core.withdrawnAt).toBeNull()
		expect(core.templateId).toBe(
			"core:template/pipeline-context-template-core-default@1"
		)
	})
})
