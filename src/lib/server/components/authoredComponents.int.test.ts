/**
 * Authored components (C6, P2): the instance's own components, each its own
 * owner (`authored.<id>`), stored with optimistic concurrency and offered to
 * sessions beside core's and plugins' widgets — only while enabled, compiled,
 * clean and behind `SP_PLUGINS_ENABLED`, with only reviewed scopes granted.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import { HOST_ELEMENTS_VERSION, WIDGET_PROTOCOL } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let priorFlag: string | undefined

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	priorFlag = process.env.SP_PLUGINS_ENABLED
	process.env.SP_PLUGINS_ENABLED = "1"
}, 60_000)

afterAll(() => {
	if (priorFlag === undefined) delete process.env.SP_PLUGINS_ENABLED
	else process.env.SP_PLUGINS_ENABLED = priorFlag
})

let n = 0
const HASH = "ab".repeat(32)

function content(over: Record<string, unknown> = {}) {
	const k = n++
	return {
		slug: `dice-${k}`,
		label: "Dice",
		framework: "svelte" as const,
		entry: "Dice.svelte",
		files: { "Dice.svelte": `<p>roll ${k}</p>` },
		widget: { title: { en: "Dice", fr: "Dés" }, icon: "dice", scopes: ["characters"], reads: ["settings"], defaultActive: false },
		...over
	}
}

/** Created, enabled and compiled — the state that is offered. */
async function offerable(over: Record<string, unknown> = {}) {
	const store = await import("./store")
	const row = await store.createAuthoredComponent(testDb as never, content(over) as never)
	await store.setAuthoredComponentEnabled(testDb as never, row.id, true)
	await store.recordAuthoredCompile(testDb as never, row.id, {
		sourceHash: row.sourceHash,
		fingerprint: "fp",
		artifactHash: HASH
	})
	return (await store.getAuthoredComponent(testDb as never, row.id))!
}

async function viewFor() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `ac-${n++}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, genreId: "core:genre/chat" })
		.returning()
	const { sessionsViewHandler } = await import("$lib/server/sockets/sessions")
	return sessionsViewHandler.handler(
		{ user: { id: user.id }, io: { to: () => ({ emit: () => {} }) } } as never,
		{ sessionId: session.id } as never,
		() => {}
	)
}

describe("the authored owner id", () => {
	test("is `authored.<ten of [a-z0-9]>`, never 'core', and parses back", async () => {
		const o = await import("$lib/shared/widgets/authoredOwner")
		const id = o.newAuthoredId()
		expect(id).toMatch(/^[a-z0-9]{10}$/)
		const owner = o.authoredOwnerId(id)
		expect(owner).toBe(`authored.${id}`)
		expect(owner).not.toBe("core")
		expect(o.parseAuthoredOwnerId(owner)).toBe(id)
		for (const bad of ["core", "authored", "authored.", "authored.CORE12345x", "authored.abc", "acme.dice", "authored.k3x9q2m7p1x"])
			expect(o.parseAuthoredOwnerId(bad)).toBeNull()
		expect(() => o.authoredOwnerId("core")).toThrow()
		// The artifact URL is versioned by the hash and parses back.
		const src = o.authoredArtifactSrc(id, HASH)
		expect(src).toBe(`/authored-ui/authored.${id}/${HASH}.js`)
		expect(o.parseAuthoredArtifactSrc(src.slice("/authored-ui/".length))).toEqual({ id, artifactHash: HASH })
		for (const bad of [`authored.${id}/../x.js`, `authored.${id}/${HASH}.svelte`, `core/${HASH}.js`, `acme/${HASH}.js`])
			expect(o.parseAuthoredArtifactSrc(bad)).toBeUndefined()
	})

	test("a plugin install cannot take the authored namespace", async () => {
		const { pluginIdFindings, upsertPlugin } = await import("$lib/server/plugins/store")
		for (const id of ["authored", "authored.k3x9q2m7p1", "authored.anything-else"]) {
			expect(pluginIdFindings(id).join(" ")).toMatch(/authored/)
			await expect(
				upsertPlugin(testDb as never, {
					pluginId: id,
					name: "Squatter",
					bundleSource: "// x",
					bundleHash: "h",
					backends: ["quickjs"]
				} as never)
			).rejects.toThrow(/authored/)
		}
		// A plugin merely NAMED like it is still a plugin.
		expect(pluginIdFindings("authoredby.tools")).toEqual([])
		expect(pluginIdFindings("acme.authored")).toEqual([])
	})

	test("a plugins row stored under the namespace before the refusal offers nothing", async () => {
		const id = `authored.zz${String(n++).padStart(8, "0")}`
		await testDb.insert(schema.plugins).values({
			pluginId: id,
			name: "Legacy squatter",
			bundleSource: "// x",
			bundleHash: "h",
			enabled: true,
			manifest: {
				components: [{ slug: "w", entry: "components/w.js" }],
				widgets: [{ id: "w", title: "W", component: "w" }]
			}
		})
		const res = await viewFor()
		expect(res.modePanels.some((p) => p.id.startsWith(`${id}:`))).toBe(false)
	})
}, 60_000)

describe("the store", () => {
	test("create → get → list → update → delete, with the owner's own id", async () => {
		const store = await import("./store")
		const row = await store.createAuthoredComponent(testDb as never, content() as never, { createdBy: null })
		expect(row.id).toMatch(/^[a-z0-9]{10}$/)
		expect(row.enabled).toBe(false)
		expect(row.artifactHash).toBeNull()
		expect(row.sourceHash).toMatch(/^[a-f0-9]{64}$/)
		expect((await store.getAuthoredComponent(testDb as never, row.id))?.slug).toBe(row.slug)
		expect((await store.listAuthoredComponents(testDb as never)).some((r) => r.id === row.id)).toBe(true)

		const updated = await store.updateAuthoredComponent(testDb as never, row.id, row.updatedAt, { label: "Dice, renamed" })
		expect(updated.label).toBe("Dice, renamed")
		expect(updated.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime())

		await store.deleteAuthoredComponent(testDb as never, row.id, updated.updatedAt)
		expect(await store.getAuthoredComponent(testDb as never, row.id)).toBeUndefined()
		await expect(
			store.updateAuthoredComponent(testDb as never, row.id, updated.updatedAt, { label: "x" })
		).rejects.toBeInstanceOf(store.AuthoredComponentMissing)
	}, 60_000)

	test("a stale updatedAt loses: the second of two saves from one read is refused, the first kept", async () => {
		const store = await import("./store")
		const row = await store.createAuthoredComponent(testDb as never, content() as never)
		const first = await store.updateAuthoredComponent(testDb as never, row.id, row.updatedAt, { label: "First" })
		await expect(
			store.updateAuthoredComponent(testDb as never, row.id, row.updatedAt, { label: "Second" })
		).rejects.toBeInstanceOf(store.AuthoredComponentConflict)
		await expect(store.deleteAuthoredComponent(testDb as never, row.id, row.updatedAt)).rejects.toBeInstanceOf(
			store.AuthoredComponentConflict
		)
		const now = await store.getAuthoredComponent(testDb as never, row.id)
		expect(now?.label).toBe("First")
		expect(now?.updatedAt.getTime()).toBe(first.updatedAt.getTime())
	}, 60_000)

	test("a widget's retired `cells` hint is neither judged nor stored — nothing reads it since WidgetDecl.cells went (layout brief 1)", async () => {
		const store = await import("./store")
		const withCells = content({
			widget: { title: "Dice", cells: { minW: 2, maxH: "tall" } }
		})
		expect(store.authoredComponentFindings(withCells as never)).toEqual([])
		const row = await store.createAuthoredComponent(testDb as never, withCells as never)
		expect(row.widget).toEqual({ title: "Dice" })
	}, 60_000)

	test("content is refused with a sentence per fault", async () => {
		const store = await import("./store")
		const bad = content({
			slug: "Has Spaces",
			framework: "react",
			entry: "Missing.svelte",
			files: { "../escape.svelte": "x", "ok.svelte": 5 },
			widget: { title: "", scopes: ["everything"], reads: ["made-up"] }
		})
		const err = await store.createAuthoredComponent(testDb as never, bad as never).catch((e) => e)
		expect(err).toBeInstanceOf(store.AuthoredComponentInvalid)
		const text = (err as InstanceType<typeof store.AuthoredComponentInvalid>).findings.join("\n")
		for (const fault of ["slug", "framework", "entry", "../escape.svelte", "is not text", "widget.title", "everything", "made-up"])
			expect(text).toContain(fault)
	}, 60_000)

	test("new source clears the compile, and a compile of the old source never lands", async () => {
		const store = await import("./store")
		const row = await offerable()
		expect(row.artifactHash).toBe(HASH)
		const edited = await store.updateAuthoredComponent(testDb as never, row.id, row.updatedAt, {
			files: { "Dice.svelte": "<p>new</p>" }
		})
		expect(edited.sourceHash).not.toBe(row.sourceHash)
		expect(edited.artifactHash).toBeNull()
		expect(edited.fingerprint).toBeNull()
		// The compile of what it used to hold finishes late: dropped.
		expect(
			await store.recordAuthoredCompile(testDb as never, row.id, { sourceHash: row.sourceHash, fingerprint: "fp", artifactHash: HASH })
		).toBe(false)
		expect((await store.getAuthoredComponent(testDb as never, row.id))?.artifactHash).toBeNull()
		// A label edit is not a rebuild.
		const again = await offerable()
		const relabelled = await store.updateAuthoredComponent(testDb as never, again.id, again.updatedAt, { label: "L" })
		expect(relabelled.artifactHash).toBe(HASH)
	}, 60_000)
}, 60_000)

describe("the component draft", () => {
	const DRAFT = (k: string) => ({
		files: { "Dice.svelte": `<p>{${k}</p>` },
		entry: "Dice.svelte",
		framework: "svelte" as const,
		errors: [{ file: "Dice.svelte", line: 1, column: 4, text: "Unexpected token" }]
	})

	test("kept beside the saved version, which — source, compile, offer — is untouched", async () => {
		const store = await import("./store")
		const { offeredAuthoredWidgetIds } = await import("./offer")
		const row = await offerable()
		const after = await store.saveComponentDraft(testDb as never, row.id, row.updatedAt, DRAFT("a"))
		expect(after.files).toEqual(row.files)
		expect(after.sourceHash).toBe(row.sourceHash)
		expect(after.artifactHash).toBe(HASH)
		expect(after.lastError).toBeNull()
		expect(after.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime())
		expect(store.componentDraftOf(after)).toMatchObject({ files: DRAFT("a").files, entry: "Dice.svelte", framework: "svelte", errors: DRAFT("a").errors })
		const { authoredWidgetId } = await import("./offer")
		expect((await offeredAuthoredWidgetIds(testDb as never)).has(authoredWidgetId(row.id, row.slug))).toBe(true)
	}, 60_000)

	test("refused for a component that has never compiled, and for a stale token", async () => {
		const store = await import("./store")
		const fresh = await store.createAuthoredComponent(testDb as never, content() as never)
		await expect(store.saveComponentDraft(testDb as never, fresh.id, fresh.updatedAt, DRAFT("b"))).rejects.toThrow(/never compiled/)
		const row = await offerable()
		const once = await store.saveComponentDraft(testDb as never, row.id, row.updatedAt, DRAFT("c"))
		await expect(store.saveComponentDraft(testDb as never, row.id, row.updatedAt, DRAFT("d"))).rejects.toBeInstanceOf(store.AuthoredComponentConflict)
		await expect(store.revertComponentDraft(testDb as never, row.id, row.updatedAt)).rejects.toBeInstanceOf(store.AuthoredComponentConflict)
		expect(store.componentDraftOf((await store.getAuthoredComponent(testDb as never, row.id))!)?.files).toEqual(DRAFT("c").files)
		const reverted = await store.revertComponentDraft(testDb as never, row.id, once.updatedAt)
		expect(store.componentDraftOf(reverted)).toBeNull()
		expect(reverted.files).toEqual(row.files)
		expect(reverted.artifactHash).toBe(HASH)
	}, 60_000)

	test("a source write clears the draft; a declaration-only write keeps it", async () => {
		const store = await import("./store")
		const row = await offerable()
		const d = await store.saveComponentDraft(testDb as never, row.id, row.updatedAt, DRAFT("e"))
		const relabelled = await store.updateAuthoredComponent(testDb as never, row.id, d.updatedAt, { label: "Renamed" })
		expect(store.componentDraftOf(relabelled)).not.toBeNull()
		const saved = await store.updateAuthoredComponent(testDb as never, row.id, relabelled.updatedAt, { files: { "Dice.svelte": "<p>ok</p>" } })
		expect(store.componentDraftOf(saved)).toBeNull()
		expect(saved.draftUpdatedAt).toBeNull()
	}, 60_000)
})

describe("the offer", () => {
	test("an offered component round-trips through sessions:view under its own owner", async () => {
		const store = await import("./store")
		const row = await offerable()
		await store.reviewAuthoredScopes(testDb as never, row.id, { denied: [] })
		const res = await viewFor()
		const owner = `authored.${row.id}`
		const panel = res.modePanels.find((p) => p.id === `${owner}:${row.slug}`)
		expect(panel).toEqual({
			id: `${owner}:${row.slug}`,
			title: "Dice",
			icon: "dice",
			role: "secondary",
			surface: { kind: "remote", owner, component: row.slug },
			src: `/authored-ui/${owner}/${HASH}.js`,
			reads: ["settings"],
			grants: ["characters"],
			defaultActive: false
		})
		expect(panel!.surface.kind === "remote" && panel!.surface.owner).not.toBe("core")
		// Seatable: a layout / settings write keyed on its id is accepted.
		const { seatableWidgetIds } = await import("$lib/server/plugins/frameHost")
		expect((await seatableWidgetIds(testDb as never, "core:genre/chat")).has(panel!.id)).toBe(true)
	}, 60_000)

	test("disabled, uncompiled or failed components are not offered", async () => {
		const store = await import("./store")
		const disabled = await offerable()
		await store.setAuthoredComponentEnabled(testDb as never, disabled.id, false)
		const uncompiled = await store.createAuthoredComponent(testDb as never, content() as never)
		await store.setAuthoredComponentEnabled(testDb as never, uncompiled.id, true)
		const failed = await offerable()
		await store.recordAuthoredCompile(testDb as never, failed.id, {
			sourceHash: failed.sourceHash,
			fingerprint: "fp",
			error: "Dice.svelte:1:1 boom"
		})
		const res = await viewFor()
		for (const r of [disabled, uncompiled, failed])
			expect(res.modePanels.some((p) => p.id.startsWith(`authored.${r.id}:`))).toBe(false)
		const { seatableWidgetIds } = await import("$lib/server/plugins/frameHost")
		const seatable = await seatableWidgetIds(testDb as never, "core:genre/chat")
		for (const r of [disabled, uncompiled, failed]) expect(seatable.has(`authored.${r.id}:${r.slug}`)).toBe(false)
	}, 60_000)

	test("F1: an artifact built for a widget protocol this host does not speak is not offered, and says why", async () => {
		const store = await import("./store")
		const { offeredAuthoredSrc, offeredAuthoredWidgets, offeredAuthoredWidgetIds } = await import("./offer")
		const { authoredComponentRefusal } = await import("./compat")
		const row = await offerable()
		// As a no-compiler instance keeps an imported artifact: the fingerprint of the toolchain that built it.
		const future = `compiler@9 widget-protocol@${WIDGET_PROTOCOL + 1} host-elements@${HOST_ELEMENTS_VERSION} sdk@9.0.0 component-client@9.0.0`
		await store.recordAuthoredCompile(testDb as never, row.id, { sourceHash: row.sourceHash, fingerprint: future, artifactHash: HASH })
		const stored = (await store.getAuthoredComponent(testDb as never, row.id))!
		expect(authoredComponentRefusal(stored.fingerprint)).toBe(
			`built for widget protocol ${WIDGET_PROTOCOL + 1}; this host speaks ${WIDGET_PROTOCOL}`
		)
		expect(offeredAuthoredSrc(stored)).toBeNull()
		expect((await offeredAuthoredWidgets(testDb as never)).some((p) => p.id.startsWith(`authored.${row.id}:`))).toBe(false)
		expect((await offeredAuthoredWidgetIds(testDb as never)).has(`authored.${row.id}:${row.slug}`)).toBe(false)
		expect((await viewFor()).modePanels.some((p) => p.id.startsWith(`authored.${row.id}:`))).toBe(false)
		// Today's toolchain's own fingerprint, and one from before the record ("fp"), are offered.
		const today = `compiler@1 widget-protocol@${WIDGET_PROTOCOL} host-elements@${HOST_ELEMENTS_VERSION} sdk@0.6.0`
		await store.recordAuthoredCompile(testDb as never, row.id, { sourceHash: row.sourceHash, fingerprint: today, artifactHash: HASH })
		expect(offeredAuthoredSrc((await store.getAuthoredComponent(testDb as never, row.id))!)).not.toBeNull()
	}, 60_000)

	test("unreviewed scopes grant nothing; a denied one stays out; a scope asked for later waits for review", async () => {
		const store = await import("./store")
		const { authoredGrants } = await import("./offer")
		const row = await offerable({
			widget: { title: "Two", scopes: ["characters", "lore"] }
		})
		let panel = (await viewFor()).modePanels.find((p) => p.id.startsWith(`authored.${row.id}:`))!
		expect(panel.grants).toBeUndefined()
		expect(store.authoredScopeStates(row).every((s) => s.pending && !s.granted)).toBe(true)

		await store.reviewAuthoredScopes(testDb as never, row.id, { denied: ["lore"] })
		panel = (await viewFor()).modePanels.find((p) => p.id.startsWith(`authored.${row.id}:`))!
		expect(panel.grants).toEqual(["characters"])

		// The widget now also asks for `persona`: unreviewed, so refused.
		const now = (await store.getAuthoredComponent(testDb as never, row.id))!
		const asked = await store.updateAuthoredComponent(testDb as never, row.id, now.updatedAt, {
			widget: { title: "Two", scopes: ["characters", "lore", "persona"] }
		})
		expect(authoredGrants(asked.widget, asked.adminDenied)).toEqual(["characters"])
	}, 60_000)

	test("with SP_PLUGINS_ENABLED off nothing authored is offered or seatable", async () => {
		const row = await offerable()
		const { offeredAuthoredWidgets, offeredAuthoredWidgetIds } = await import("./offer")
		expect((await offeredAuthoredWidgets(testDb as never)).some((p) => p.id.startsWith(`authored.${row.id}:`))).toBe(true)
		delete process.env.SP_PLUGINS_ENABLED
		try {
			expect(await offeredAuthoredWidgets(testDb as never)).toEqual([])
			expect((await offeredAuthoredWidgetIds(testDb as never)).size).toBe(0)
			const res = await viewFor()
			expect(res.modePanels.some((p) => p.id.startsWith("authored."))).toBe(false)
		} finally {
			process.env.SP_PLUGINS_ENABLED = "1"
		}
	}, 60_000)
}, 60_000)
