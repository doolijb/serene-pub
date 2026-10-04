/**
 * The dev install, end to end (D-6): a built package on disk becomes a genre in
 * the picker, pipelines that run under their owner, configs, a preset, a prompt
 * and a frame that serves — and, since D-6b, a node definition whose handler
 * actually runs.
 *
 * Six things are pinned here, and each was a way the projection could be
 * half-done without anything saying so:
 *
 *  1. **A genre is its create spec's published row.** There is no genre table,
 *     so "the picker sees it" is a query against `listSessionGenres`, not a row
 *     count — and the fixture's create spec carries no `meta.genre`, so this
 *     also pins that the install supplies the declaration from the manifest.
 *  2. **A run carries its owner from the ROW.** `pipeline_specs.source_plugin_id`
 *     existed and no caller had ever written it; `specOwnerPluginId` is the
 *     exact function `runSpec` calls, and ownership — not the id's namespace —
 *     is what refuses a built-in write.
 *  3. **Surfaces serve.** A manifest declaring a panel and a `plugin_files`
 *     table with nothing in it renders a blank frame, which looks like a
 *     plugin bug.
 *  4. **Re-install is an upsert.** Nothing is duplicated: documents by id, rows
 *     by their natural keys.
 *  5. **Uninstall removes what install projected, and nothing else.** Core's
 *     specs and configs are counted before and after.
 *  6. **The two refusals.** A non-admin, and the subsystem flag off.
 *
 * And the three D-6b seams, which are one claim: **a package's CODE runs.** Its
 * node definition is a registry row under its ownership, the manifest names the
 * exported function that implements it, the bundle exports that function — and
 * a turn through the package's own spec reaches it in the sandbox and comes
 * back with what it computed. Each of the three was separately fine while the
 * whole was dead.
 *
 * Against the real migrations and a real bootstrap, because every one of those
 * is a claim about rows.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { and, eq, like } from "drizzle-orm"
import { resolve } from "node:path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

let db: TestDb
let adminId: number
let strangerId: number
let priorFlag: string | undefined

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "install-local-test-secret" }
})

const FIXTURE = resolve(
	process.cwd(),
	"src/lib/server/plugins/fixtures/unified-plugin"
)
const SLUG = "demo.unified"
const GENRE = "demo.unified:genre/tally"
const CREATE = "demo.unified:spec/create-session"
const RESPOND = "demo.unified:spec/respond"
/** The package's own node definition, and the function that implements it. */
const TALLY = "demo.unified:task/tally"
const TALLY_HOOK = "tallyHandler"

beforeAll(async () => {
	priorFlag = process.env.SP_PLUGINS_ENABLED
	process.env.SP_PLUGINS_ENABLED = "1"
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)
	const [admin] = await db
		.insert(schema.users)
		.values({ username: "install-local-admin", isAdmin: true })
		.returning()
	adminId = admin.id
	const [stranger] = await db
		.insert(schema.users)
		.values({ username: "install-local-stranger", isAdmin: false })
		.returning()
	strangerId = stranger.id
}, 120_000)

afterAll(async () => {
	// The sandbox holds a worker; vitest waits on it otherwise.
	const { shutdownPlugins } = await import("$lib/server/plugins")
	await shutdownPlugins()
	if (priorFlag === undefined) delete process.env.SP_PLUGINS_ENABLED
	else process.env.SP_PLUGINS_ENABLED = priorFlag
})

/** The package's definition as the registry holds it, if it holds it. */
const definitionRow = async () =>
	(
		await db
			.select()
			.from(schema.pipelineDefinitionRegistry)
			.where(eq(schema.pipelineDefinitionRegistry.definitionId, TALLY))
			.limit(1)
	)[0]

const socketFor = (userId: number, isAdmin: boolean) =>
	({ user: { id: userId, isAdmin }, io: { to: () => ({ emit: () => {} }) } }) as any

/** An `emitToUser` that resolves the lazy payloads `emitList` pushes. */
function collector() {
	const events: { event: string; data: any }[] = []
	const emit = (event: string, data: any) => {
		if (typeof data === "function")
			return Promise.resolve(data()).then((d) => {
				events.push({ event, data: d })
			})
		events.push({ event, data })
	}
	return { emit: emit as any, events }
}

const install = async (dir = FIXTURE) => {
	const h = await import("./plugins")
	return h.pluginsInstallLocal.handler(
		socketFor(adminId, true),
		{ dir },
		collector().emit
	)
}

const specRow = async (slug: string) =>
	(
		await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, slug))
			.limit(1)
	)[0]

const counts = async () => ({
	specs: (await db.select().from(schema.pipelineSpecs)).length,
	configs: (await db.select().from(schema.pipelineConfigs)).length,
	prompts: (await db.select().from(schema.pipelinePrompts)).length,
	presets: (await db.select().from(schema.sessionPresets)).length,
	files: (await db.select().from(schema.pluginFiles)).length
})

describe("plugins:installLocal — the refusals", () => {
	it("refuses a non-admin", async () => {
		const h = await import("./plugins")
		const c = collector()
		await expect(
			h.pluginsInstallLocal.handler(
				socketFor(strangerId, false),
				{ dir: FIXTURE },
				c.emit
			)
		).rejects.toThrow(/Only admin users/)
		expect(await specRow(CREATE)).toBeUndefined()
	})

	it("refuses when the plugin subsystem is off", async () => {
		const h = await import("./plugins")
		const c = collector()
		delete process.env.SP_PLUGINS_ENABLED
		try {
			await expect(
				h.pluginsInstallLocal.handler(
					socketFor(adminId, true),
					{ dir: FIXTURE },
					c.emit
				)
			).rejects.toThrow(/SP_PLUGINS_ENABLED/)
		} finally {
			process.env.SP_PLUGINS_ENABLED = "1"
		}
		expect(await specRow(CREATE)).toBeUndefined()
	})

	it("refuses a URL — a dev install reads a folder on this machine", async () => {
		const h = await import("./plugins")
		const c = collector()
		await expect(
			h.pluginsInstallLocal.handler(
				socketFor(adminId, true),
				{ dir: "https://example.com/plugin.zip" },
				c.emit
			)
		).rejects.toThrow(/not a URL/)
	})
})

describe("plugins:installLocal — the projection", () => {
	it("installs the package and projects what it declares", async () => {
		const before = await counts()
		const res = await install()

		expect(res.pluginId).toBe(SLUG)
		expect(res.specs.sort()).toEqual([CREATE, RESPOND])
		// The fixture's create spec carries no `meta.genre`, so the install
		// supplied the declaration from the manifest.
		expect(res.genres).toEqual([GENRE])
		expect(res.files).toBe(4)

		// The plugin row, disabled on arrival like any fresh install.
		const [plugin] = await db
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, SLUG))
		expect(plugin).toMatchObject({ pluginId: SLUG, enabled: false })
		// Stored verbatim — every reader the app has reads the manifest.
		expect((plugin.manifest as any).widgets[0].component).toBe("tally")
		// The code half: the package ships a sandbox bundle, so nothing warns
		// that its handlers cannot dispatch (D-6b).
		expect(plugin.bundleSource.length).toBeGreaterThan(0)
		expect(res.warnings ?? []).toEqual([])
		// …and the manifest names the exported function that implements the
		// definition, which is the whole binding: core never guesses one.
		expect((plugin.manifest as any).hooks.nodeHandlers).toEqual({
			[`${TALLY}@1`]: TALLY_HOOK
		})

		// (2b) The node definition is a registry row, owned by the package and
		// out of process — `transport` is written from ownership, never from
		// what the manifest claims about itself.
		const definition = await definitionRow()
		expect(definition).toMatchObject({
			definitionId: TALLY,
			version: 1,
			kind: "task",
			transport: "process",
			ownerPluginId: plugin.id,
			status: "live"
		})
		// The declaration, not a summary of it: a row carrying port NAMES
		// would declare ports no edge could be checked against.
		expect(definition.ports).toEqual({
			in: { text: "core:shape/text@1" },
			out: { main: "core:shape/json@1" }
		})

		// (1) The genre is in the picker's list, named.
		const { listSessionGenres } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const genre = (await listSessionGenres(db as any)).find(
			(g) => g.genreId === GENRE
		)
		expect(genre).toBeDefined()
		expect(genre!.name).toBe("Tally")
		expect(genre!.family).toBe("game")
		expect(genre!.description).toBe("Somebody is counting.")

		// (2) Both specs carry their owner, on the row.
		for (const slug of [CREATE, RESPOND]) {
			const row = await specRow(slug)
			expect(row.sourcePluginId).toBe(plugin.id)
			expect(row.activeVersionId).not.toBeNull()
		}
		// Core's are untouched.
		expect((await specRow("core:spec/respond")).sourcePluginId).toBeNull()

		// The configs: one over the package's own spec, one over core's — the
		// second is the case a `source_plugin_id` on the spec cannot express.
		const configs = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(like(schema.pipelineConfigs.seedKey, `plugin:${SLUG}:%`))
		// Keyed per spec (`plugin:<id>:<spec>#<slug>`): a config slug is scoped
		// to its spec, so two specs may ship the same slug without colliding.
		expect(configs.map((c) => c.seedKey).sort()).toEqual([
			`plugin:${SLUG}:core:spec/respond#tally-flavoured`,
			`plugin:${SLUG}:${RESPOND}#tally-default`
		])
		const own = configs.find((c) => c.seedKey!.endsWith("tally-default"))!
		expect(own.specId).toBe((await specRow(RESPOND)).id)
		expect(own.name).toBe("Tally")
		expect(own.isImmutable).toBe(true)
		const values = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, own.id))
		expect(values).toEqual([
			expect.objectContaining({
				nodeKey: "tally",
				slot: "params",
				path: "",
				value: { trim: true }
			})
		])
		const foreign = configs.find((c) =>
			c.seedKey!.endsWith("tally-flavoured")
		)!
		expect(foreign.specId).toBe((await specRow("core:spec/respond")).id)

		// (3) The frame is servable: the declared entry AND what it loads.
		const { frameSrc, readPluginFile } = await import(
			"$lib/server/plugins/frameHost"
		)
		expect(frameSrc(SLUG, "ui/tally.html")).toContain(SLUG)
		for (const path of ["ui/tally.html", "ui/tally.js", "ui/tally.css"]) {
			const file = await readPluginFile(db as any, SLUG, path)
			expect(file, path).toBeDefined()
			expect(file!.bytes).toBeGreaterThan(0)
		}

		const after = await counts()
		expect(after.specs).toBe(before.specs + 2)
		expect(after.files).toBe(before.files + 4)
	})

	it("projects the preset and the prompt once the plugin is enabled", async () => {
		const h = await import("./plugins")
		const c = collector()
		await h.pluginsSetEnabled.handler(
			socketFor(adminId, true),
			{ pluginId: SLUG, enabled: true },
			c.emit
		)

		const [plugin] = await db
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, SLUG))

		const [preset] = await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, `plugin:${SLUG}:tally`))
		expect(preset).toBeDefined()
		expect(preset.genreId).toBe(GENRE)
		expect(preset.ownerPluginId).toBe(plugin.id)
		expect(preset.withdrawnAt).toBeNull()
		// Both of the genre's events bound, by event id.
		expect(Object.keys(preset.bindings as Record<string, unknown>).sort()).toEqual([
			"core:event/message-respond@1",
			"core:event/session-created@1"
		])

		// The prompt, declared in D-1's `prompts` vocabulary and projected
		// through the template-seed one.
		const [prompt] = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(
				eq(schema.pipelinePrompts.templateId, `${SLUG}:template/tally-referee@1`)
			)
		expect(prompt).toBeDefined()
		expect(prompt.ownerPluginId).toBe(plugin.id)
		expect(prompt.nodeDefinitionId).toBe("core:task/build-template-context")
		expect(prompt.slot).toBe("prompts")
		expect(prompt.name).toBe("Tally referee")
		expect(prompt.fields).toEqual({ systemPrompt: "Count, and say the number." })
		expect(prompt.withdrawnAt).toBeNull()
	})

	it("runs the package's own node: a turn reaches the handler in the sandbox", async () => {
		// The claim D-6b exists for. The three seams it closed are only worth
		// anything together, so they are asserted together — through a real
		// turn, not by calling the binding directly.
		//
		// No model is involved: the package's respond spec is an inlet and its
		// own task, so the run needs no connection and the assertion is about
		// the handler's arithmetic rather than about anything generated.
		const { bootstrapPlugins, getManager } = await import(
			"$lib/server/plugins"
		)
		await bootstrapPlugins(db as any)

		const [user] = await db
			.insert(schema.users)
			.values({ username: "tally-player" })
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false, genreId: GENRE })
			.returning()

		const callHook = vi.spyOn(getManager(), "callHook")
		const { runTurn } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)
		const receipt = await runTurn({
			db: db as any,
			sessionId: session.id,
			userId: user.id,
			currentCharacterId: null,
			specId: RESPOND,
			text: "one two three"
		})

		// Dispatched into the sandbox, by the name the manifest gave it.
		expect(callHook).toHaveBeenCalledWith(
			SLUG,
			TALLY_HOOK,
			expect.anything(),
			expect.objectContaining({ kind: "task" })
		)
		// And the node's own result is what the plugin's code computed, on the
		// port its declaration names.
		const node = receipt.nodes.find((n: any) => n.nodeKey === "tally")
		expect(node, JSON.stringify(receipt.nodes)).toBeDefined()
		expect(node!.result).toBe("ok")
		expect(node!.output).toMatchObject({ main: { words: 3 } })
		callHook.mockRestore()
	})

	it("gives a run of the plugin's spec its owner, from the row", async () => {
		const { specOwnerPluginId } = await import(
			"$lib/server/pipelines/boot/store"
		)
		expect(await specOwnerPluginId(db as any, RESPOND)).toBe(SLUG)
		expect(await specOwnerPluginId(db as any, CREATE)).toBe(SLUG)
		// Core's specs are owned by nobody — the same absence a host with no
		// owner has, not a lookup that failed.
		expect(await specOwnerPluginId(db as any, "core:spec/respond")).toBeUndefined()

		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		// The host exposes it read-only…
		const owned = createHost(db as any, {
			specId: RESPOND,
			ownerPluginId: SLUG
		})
		expect(owned.ownerPluginId).toBe(SLUG)
		expect(createHost(db as any, { specId: "core:spec/respond" }).ownerPluginId)
			.toBeUndefined()

		// …and a built-in write is refused by OWNERSHIP, not by the id: this
		// scope names a built-in's own spec id and is still refused, because
		// the row says a package owns the document.
		const node = {
			key: "write",
			definitionId: "core:outlet/delete-message",
			definitionVersion: 1,
			kind: "outlet"
		}
		await expect(
			createHost(db as any, {
				specId: "core:spec/builtin-delete",
				ownerPluginId: SLUG
			}).commit!({}, node)
		).rejects.toThrow(/owned by the plugin 'demo.unified'/)
		// And core's own built-in, unowned, gets past the same gate — it fails
		// later, on the target it was not given.
		await expect(
			createHost(db as any, { specId: "core:spec/builtin-delete" }).commit!(
				{},
				node
			)
		).rejects.toThrow(/no message id to delete/)
	})

	it("re-installs as an upsert: nothing is duplicated", async () => {
		const before = await counts()
		const specIds = {
			create: (await specRow(CREATE)).id,
			respond: (await specRow(RESPOND)).id
		}
		const res = await install()
		expect(res.specs.sort()).toEqual([CREATE, RESPOND])

		const after = await counts()
		expect(after).toEqual(before)
		// The same rows, not replacements: a new spec row would strand every
		// config and receipt naming the old one.
		expect((await specRow(CREATE)).id).toBe(specIds.create)
		expect((await specRow(RESPOND)).id).toBe(specIds.respond)
		// And the admin's enable survived it, because the bytes did not change.
		const [plugin] = await db
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, SLUG))
		expect(plugin.enabled).toBe(true)
	})

	it("uninstalls what it projected, and nothing else", async () => {
		const coreSpecs = (
			await db
				.select()
				.from(schema.pipelineSpecs)
				.where(like(schema.pipelineSpecs.slug, "core:%"))
		).length
		const coreConfigs = (
			await db
				.select()
				.from(schema.pipelineConfigs)
				.where(like(schema.pipelineConfigs.seedKey, "pipeline-default:%"))
		).length

		const h = await import("./plugins")
		const c = collector()
		await h.pluginsUninstall.handler(
			socketFor(adminId, true),
			{ pluginId: SLUG },
			c.emit
		)

		// Gone: the plugin, its specs (and everything under them by cascade),
		// its configs, its files.
		expect(
			await db.select().from(schema.plugins).where(eq(schema.plugins.pluginId, SLUG))
		).toHaveLength(0)
		expect(await specRow(CREATE)).toBeUndefined()
		expect(await specRow(RESPOND)).toBeUndefined()
		expect(
			await db
				.select()
				.from(schema.pipelineConfigs)
				.where(like(schema.pipelineConfigs.seedKey, `plugin:${SLUG}:%`))
		).toHaveLength(0)
		expect(
			await db
				.select()
				.from(schema.pluginFiles)
				.where(eq(schema.pluginFiles.pluginId, SLUG))
		).toHaveLength(0)
		// The definition goes too, and is deleted rather than marked removed:
		// ownership is `plugins.id`, and a kept row would name an owner that
		// no longer exists — then the WRONG one, since a re-install is a new
		// identity value. Core's own rows are withdrawn instead, for the
		// opposite reason: nothing else holds their declaration.
		expect(await definitionRow()).toBeUndefined()
		// The genre goes with its create spec.
		const { listSessionGenres } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		expect(
			(await listSessionGenres(db as any)).some((g) => g.genreId === GENRE)
		).toBe(false)

		// Withdrawn, not deleted: a session names its preset and a
		// configuration names a prompt row.
		const [preset] = await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, `plugin:${SLUG}:tally`))
		expect(preset.withdrawnAt).not.toBeNull()
		const [prompt] = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(
				eq(schema.pipelinePrompts.templateId, `${SLUG}:template/tally-referee@1`)
			)
		expect(prompt.withdrawnAt).not.toBeNull()

		// …and nothing else. Core's rows are exactly where they were.
		expect(
			(
				await db
					.select()
					.from(schema.pipelineSpecs)
					.where(like(schema.pipelineSpecs.slug, "core:%"))
			).length
		).toBe(coreSpecs)
		expect(
			(
				await db
					.select()
					.from(schema.pipelineConfigs)
					.where(like(schema.pipelineConfigs.seedKey, "pipeline-default:%"))
			).length
		).toBe(coreConfigs)
	})

	it("re-installs cleanly after an uninstall", async () => {
		const res = await install()
		expect(res.specs.sort()).toEqual([CREATE, RESPOND])
		expect((await specRow(RESPOND)).sourcePluginId).not.toBeNull()
		// The definition comes back owned by the NEW plugin row — a
		// re-install is a new `plugins.id`, and a row still naming the old one
		// would read as "belongs to an extension that is no longer installed"
		// on every run of the package's own node.
		const [reinstalled] = await db
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, SLUG))
		expect(await definitionRow()).toMatchObject({
			ownerPluginId: reinstalled.id,
			transport: "process",
			status: "live"
		})
		const { listSessionGenres } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		expect(
			(await listSessionGenres(db as any)).some((g) => g.genreId === GENRE)
		).toBe(true)
		// The withdrawal marks lift when the plugin is enabled again.
		const h = await import("./plugins")
		await h.pluginsSetEnabled.handler(
			socketFor(adminId, true),
			{ pluginId: SLUG, enabled: true },
			collector().emit
		)
		// The withdrawn rows a previous install left are the SAME rows, adopted
		// by the new plugin row — a session that named this preset while it was
		// away still names it. They are keyed by the slug, and the slug did not
		// change; only `plugins.id` did.
		const [preset] = await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, `plugin:${SLUG}:tally`))
		expect(preset.withdrawnAt).toBeNull()
		const [plugin] = await db
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, SLUG))
		expect(preset.ownerPluginId).toBe(plugin.id)
		const [prompt] = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(
				eq(schema.pipelinePrompts.templateId, `${SLUG}:template/tally-referee@1`)
			)
		expect(prompt.withdrawnAt).toBeNull()
		expect(prompt.ownerPluginId).toBe(plugin.id)
		// One row each, never a second under the same key.
		expect(
			await db
				.select()
				.from(schema.sessionPresets)
				.where(like(schema.sessionPresets.seedKey, `plugin:${SLUG}:%`))
		).toHaveLength(1)
	})
})
