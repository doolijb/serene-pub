/**
 * The authored-component socket verbs (C6, P4), against a real (in-memory)
 * database and this server's real compiler: the two gates on every verb,
 * clone (never `messages`), save with its limits and its concurrency token,
 * preview behind a capability URL bound to its minter, the `component@1`
 * share file both ways — recompiled where there is a compiler, the carried
 * module only when its hash verifies where there is not — and
 * `components:changed` reaching only the sockets that declared it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { CORE_COMPONENTS, CORE_VIEW_ONLY_COMPONENTS } from "@serene-pub/core-catalog"
import { COMPONENT_IMPORTS } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { COMPONENT_ADMIN_EVENTS } from "$lib/shared/sockets/interest"

const { authenticateRequestMock } = vi.hoisted(() => ({ authenticateRequestMock: vi.fn() }))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})
vi.mock("$lib/server/auth/authenticateRequest", () => ({ authenticateRequest: authenticateRequestMock }))

let db: TestDb
let priorFlag: string | undefined
let h: typeof import("./components")
let compile: typeof import("$lib/server/components/compile")
let preview: typeof import("$lib/server/components/preview")
let cache: typeof import("$lib/server/components/cache")

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	priorFlag = process.env.SP_PLUGINS_ENABLED
	process.env.SP_PLUGINS_ENABLED = "1"
	h = await import("./components")
	compile = await import("$lib/server/components/compile")
	preview = await import("$lib/server/components/preview")
	cache = await import("$lib/server/components/cache")
}, 60_000)

afterAll(() => {
	if (priorFlag === undefined) delete process.env.SP_PLUGINS_ENABLED
	else process.env.SP_PLUGINS_ENABLED = priorFlag
})

afterEach(() => {
	process.env.SP_PLUGINS_ENABLED = "1"
	compile.__setComponentCompilerForTests(undefined)
	preview.__setPreviewClockForTests(undefined)
	authenticateRequestMock.mockReset()
})

const LIST = COMPONENT_IMPORTS.map((p) => `'${p}'`).join(", ")
const NO_COMPILER = { available: false as const, reason: "components are not compiled on Android" }

/** A fake Socket.IO server: sockets with interest sets, and what each was sent. */
function fakeIo(interests: Record<string, string[]>) {
	const sent: Record<string, { event: string; data: any }[]> = {}
	const sockets = new Map<string, any>()
	for (const [id, keys] of Object.entries(interests)) {
		sent[id] = []
		sockets.set(id, { id, interest: new Set(keys), user: { id: 9, isAdmin: false } })
	}
	return {
		sent,
		io: {
			to: (id: string) => ({ emit: (event: string, data: any) => sent[id]?.push({ event, data }) }),
			sockets: { sockets, adapter: { rooms: new Map() } }
		}
	}
}

function caller(opts: { admin?: boolean; id?: number; io?: any } = {}) {
	const events: { event: string; data: any }[] = []
	return {
		socket: { user: { id: opts.id ?? 1, isAdmin: opts.admin ?? true }, ...(opts.io ? { io: opts.io } : {}) } as any,
		emit: (event: string, data: any) => void events.push({ event, data }),
		events
	}
}

/** Run a verb as the admin (or `as`), and answer its reply — or its refusal. */
async function call<T = any>(handler: { handler: (...a: any[]) => any }, params: any, as = caller()): Promise<T> {
	return (await handler.handler(as.socket, params, as.emit)) as T
}

const rowCount = async () => (await db.select().from(schema.authoredComponents)).length

describe("the gates", () => {
	test("every verb is registered, and every verb is an admin event in the interest rules", () => {
		expect(h.COMPONENT_HANDLERS.map((x) => x.event).sort()).toEqual([...COMPONENT_ADMIN_EVENTS].sort())
	})

	test.each(COMPONENT_ADMIN_EVENTS.map((e) => [e]))("%s refuses a non-admin, before reading or writing anything", async (event) => {
		const handler = h.COMPONENT_HANDLERS.find((x) => x.event === event)!
		const before = await rowCount()
		const who = caller({ admin: false, id: 2 })
		const res = await call<any>(
			handler,
			{ id: "aaaaaaaaaa", slug: "stats", framework: "svelte", files: { "a.ts": "export default 1" }, entry: "a.ts", text: "{}", filename: "x.json", expectedUpdatedAt: new Date().toISOString(), enabled: true, denied: [] },
			who
		)
		expect(res).toEqual({ error: h.COMPONENTS_ADMIN_ONLY })
		expect(who.events).toEqual([{ event: `${event}:error`, data: { error: h.COMPONENTS_ADMIN_ONLY } }])
		expect(await rowCount()).toBe(before)
	})

	test.each(COMPONENT_ADMIN_EVENTS.map((e) => [e]))("%s refuses with the extension subsystem off", async (event) => {
		process.env.SP_PLUGINS_ENABLED = "0"
		const handler = h.COMPONENT_HANDLERS.find((x) => x.event === event)!
		const who = caller()
		const res = await call<any>(handler, { slug: "stats", framework: "svelte" }, who)
		expect(res).toEqual({ error: h.COMPONENTS_SUBSYSTEM_OFF })
		expect(who.events.map((e) => e.event)).toEqual([`${event}:error`])
	})
})

describe("core's components", () => {
	test("listed with their source hashes; messages is readable but not cloneable", async () => {
		const { CORE_SOURCE_SLUGS } = await import("$lib/server/components/core")
		expect([...CORE_SOURCE_SLUGS].sort()).toEqual(CORE_COMPONENTS.map((c) => c.slug).sort())
		const list = await call<Sockets.Components.CoreList.Response>(h.componentsCoreList, {})
		expect(list.components).toHaveLength(CORE_COMPONENTS.length)
		for (const c of list.components) {
			expect(c.sourceHash).toMatch(/^[a-f0-9]{64}$/)
			expect(c.cloneable).toBe(!CORE_VIEW_ONLY_COMPONENTS.includes(c.slug))
		}
		const msgs = await call<Sockets.Components.CoreSource.Response>(h.componentsCoreSource, { slug: "messages" })
		expect(msgs.cloneable).toBe(false)
		expect(Object.keys(msgs.files).length).toBeGreaterThan(5)
		expect(msgs.files[msgs.entry]).toBeTypeOf("string")
		expect(await call(h.componentsCoreSource, { slug: "nope" })).toEqual({ error: expect.stringMatching(/no component called "nope"/) })
	})

	test("cloning messages is refused, and nothing is stored", async () => {
		const before = await rowCount()
		const res = await call<any>(h.componentsClone, { slug: "messages" })
		expect(res.error).toMatch(/'messages' can be read but not cloned/)
		expect(await rowCount()).toBe(before)
	})

	test("a clone is a NEW widget: its own owner, basedOn the core source, core's declaration copied, compiled, off and unreviewed", async () => {
		const src = await call<Sockets.Components.CoreSource.Response>(h.componentsCoreSource, { slug: "stats" })
		const a = await call<Sockets.Components.Clone.Response>(h.componentsClone, { slug: "stats" })
		expect(a.compile.errors).toEqual([])
		const c = a.component
		expect(c.widgetId).toBe(`authored.${c.id}:${c.slug}`)
		expect(c.ownerId).toBe(`authored.${c.id}`)
		expect(c.basedOn).toEqual({ component: "stats", version: src.catalogVersion, sourceHash: src.sourceHash })
		expect(c.files).toEqual(src.files)
		expect(c.widget).toMatchObject({ title: "Stats", scopes: ["session:state"], reads: ["settings"] })
		expect(c.artifactHash).toBe(a.compile.artifactHash)
		expect(c.enabled).toBe(false)
		expect(c.needsReview).toBe(true)
		expect(c.src).toBeNull()
		// A second clone takes the next free slug.
		const b = await call<Sockets.Components.Clone.Response>(h.componentsClone, { slug: "stats" })
		expect(b.component.slug).not.toBe(c.slug)
		expect(b.component.slug).toMatch(/^stats-\d+$/)
	}, 60_000)
})

describe("save", () => {
	async function blank() {
		const r = await call<Sockets.Components.Create.Response>(h.componentsCreate, { framework: "svelte" })
		expect(r.compile.errors).toEqual([])
		return r.component
	}

	test("a blank component of each framework compiles as created", async () => {
		const v = await call<Sockets.Components.Create.Response>(h.componentsCreate, { framework: "vanilla", slug: "plain" })
		expect(v.compile.errors).toEqual([])
		expect(v.component.framework).toBe("vanilla")
		expect((await call<any>(h.componentsCreate, { framework: "react" })).error).toMatch(/framework must be/)
	}, 60_000)

	test("a disallowed import comes back as a compile error at its file and line, naming the list — kept as the component draft", async () => {
		const c = await blank()
		const res = await call<Sockets.Components.Save.Response>(h.componentsSave, {
			id: c.id,
			expectedUpdatedAt: c.updatedAt,
			files: { ...c.files, "widget.ts": `\nimport env from 'esm-env'\nexport default env\n` }
		})
		expect(res.compile.artifactHash).toBeNull()
		expect(res.compile.errors[0]).toMatchObject({ file: "widget.ts", line: 2 })
		expect(res.compile.errors.map((e) => e.text).join("\n")).toContain(LIST)
		expect(res.stored).toBe("component-draft")
		expect(res.component.componentDraft?.errors[0]).toMatchObject({ file: "widget.ts", line: 2 })
		expect(res.component.lastError).toBeNull()
		expect(res.component.artifactHash).toBe(c.artifactHash)
	}, 60_000)

	test.each([
		["a traversal path", { "../evil.ts": "export default 1" }, /not a component path/],
		["an absolute path", { "/etc/x.ts": "export default 1" }, /not a component path/],
		["a file over 256 KiB", { "widget.ts": "x".repeat(256 * 1024 + 1) }, /over 262144/],
		["more than 64 files", Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`f${i}.ts`, "export {}"])), /65 files is more than 64/]
	])("the limits refuse %s, and the stored source is untouched", async (_name, files, says) => {
		const c = await blank()
		const res = await call<any>(h.componentsSave, { id: c.id, expectedUpdatedAt: c.updatedAt, files })
		expect(res.error).toMatch(says)
		const now = await call<Sockets.Components.Get.Response>(h.componentsGet, { id: c.id })
		expect(now.component.files).toEqual(c.files)
		expect(now.component.updatedAt).toBe(c.updatedAt)
	}, 60_000)

	test("two saves naming the same updatedAt: the second loses", async () => {
		const c = await blank()
		const first = await call<Sockets.Components.Save.Response>(h.componentsSave, { id: c.id, expectedUpdatedAt: c.updatedAt, label: "One" })
		expect(first.component.label).toBe("One")
		const second = await call<any>(h.componentsSave, { id: c.id, expectedUpdatedAt: c.updatedAt, label: "Two" })
		expect(second.error).toMatch(/changed since it was read/)
		expect((await call<Sockets.Components.Get.Response>(h.componentsGet, { id: c.id })).component.label).toBe("One")
		// And a stale delete loses the same way.
		expect((await call<any>(h.componentsDelete, { id: c.id, expectedUpdatedAt: c.updatedAt })).error).toMatch(/changed since it was read/)
	}, 60_000)

	test("with no compiler, authoring refuses in words, before anything is stored", async () => {
		const c = await blank()
		compile.__setComponentCompilerForTests(NO_COMPILER)
		const before = await rowCount()
		for (const [handler, params] of [
			[h.componentsCreate, { framework: "svelte" }],
			[h.componentsClone, { slug: "stats" }],
			[h.componentsSave, { id: c.id, expectedUpdatedAt: c.updatedAt, label: "X" }],
			[h.componentsPreview, { files: c.files, entry: c.entry, framework: "svelte" }]
		] as const) {
			const res = await call<any>(handler, params)
			expect(res.error).toBe("This pub has no component compiler: components are not compiled on Android.")
		}
		expect(await rowCount()).toBe(before)
		expect((await call<Sockets.Components.Get.Response>(h.componentsGet, { id: c.id })).component.label).toBe(c.label)
		expect((await call<Sockets.Components.List.Response>(h.componentsList, {})).compiler).toEqual({ available: false, reason: NO_COMPILER.reason })
	}, 60_000)
})

describe("the component draft (a save that does not compile)", () => {
	const BROKEN = "<p>{</p>"

	/** Created, compiled, reviewed and switched on — offered, as a session would see it. */
	async function offered(io?: any) {
		const made = await call<Sockets.Components.Create.Response>(h.componentsCreate, { framework: "svelte" })
		expect(made.compile.errors).toEqual([])
		await call(h.componentsReviewScopes, { id: made.component.id, denied: [] }, caller({ io }))
		const on = await call<Sockets.Components.SetEnabled.Response>(h.componentsSetEnabled, { id: made.component.id, enabled: true }, caller({ io }))
		expect(on.component.src).toMatch(/^\/authored-ui\//)
		return on.component
	}
	const get = async (id: string) => (await call<Sockets.Components.Get.Response>(h.componentsGet, { id })).component

	test("a broken save leaves the saved source, its compiled module and its offer untouched, and stores the draft with located errors", async () => {
		const { offeredAuthoredWidgets } = await import("$lib/server/components/offer")
		const { io, sent } = fakeIo({ session: ["components:changed"] })
		const c = await offered(io)
		const before = sent.session!.length
		const code = await cache.readArtifact(c.id, c.artifactHash!)
		const res = await call<Sockets.Components.Save.Response>(
			h.componentsSave,
			{ id: c.id, expectedUpdatedAt: c.updatedAt, files: { ...c.files, "Widget.svelte": BROKEN }, label: "Renamed" },
			caller({ io })
		)
		expect(res.stored).toBe("component-draft")
		expect(res.compile.errors.length).toBeGreaterThan(0)
		const now = await get(c.id)
		// The saved version: exactly as it was.
		expect(now.files).toEqual(c.files)
		expect(now.sourceHash).toBe(c.sourceHash)
		expect(now.artifactHash).toBe(c.artifactHash)
		expect(now.lastError).toBeNull()
		expect(now.src).toBe(c.src)
		expect(await cache.readArtifact(c.id, c.artifactHash!)).toBe(code)
		expect((await offeredAuthoredWidgets(db as never)).find((w) => w.id === c.widgetId)?.src).toBe(c.src)
		// The draft beside it, with where it broke; the declaration landed.
		expect(now.hasComponentDraft).toBe(true)
		expect(now.componentDraft).toMatchObject({ files: { ...c.files, "Widget.svelte": BROKEN }, entry: c.entry, framework: "svelte" })
		expect(now.componentDraft!.errors[0]).toMatchObject({ file: "Widget.svelte", line: expect.any(Number) })
		expect(now.label).toBe("Renamed")
		expect(now.updatedAt).not.toBe(c.updatedAt)
		// A session hears the same src — it keeps the module it runs.
		expect(sent.session!.slice(before).map((e) => e.data.src)).toEqual([c.src])
	}, 60_000)

	test("a save that compiles becomes the saved version and clears the draft", async () => {
		const c = await offered()
		const broken = await call<Sockets.Components.Save.Response>(h.componentsSave, { id: c.id, expectedUpdatedAt: c.updatedAt, files: { ...c.files, "Widget.svelte": BROKEN } })
		const fixed = { ...c.files, "Widget.svelte": "<p>fixed</p>" }
		const res = await call<Sockets.Components.Save.Response>(h.componentsSave, { id: c.id, expectedUpdatedAt: broken.component.updatedAt, files: fixed })
		expect(res.stored).toBe("saved-version")
		expect(res.compile.errors).toEqual([])
		const now = await get(c.id)
		expect(now.componentDraft).toBeNull()
		expect(now.hasComponentDraft).toBe(false)
		expect(now.files).toEqual(fixed)
		expect(now.artifactHash).toBe(res.compile.artifactHash)
		expect(now.artifactHash).not.toBe(c.artifactHash)
		expect(now.src).toBe(`/authored-ui/${c.ownerId}/${now.artifactHash}.js`)
		expect(await cache.readArtifact(c.id, now.artifactHash!)).toContain("fixed")
	}, 60_000)

	test("saving the saved source again clears the draft without a compile error", async () => {
		const c = await offered()
		const broken = await call<Sockets.Components.Save.Response>(h.componentsSave, { id: c.id, expectedUpdatedAt: c.updatedAt, files: { ...c.files, "Widget.svelte": BROKEN } })
		const res = await call<Sockets.Components.Save.Response>(h.componentsSave, { id: c.id, expectedUpdatedAt: broken.component.updatedAt, files: c.files })
		expect(res.stored).toBe("saved-version")
		expect((await get(c.id)).componentDraft).toBeNull()
		expect((await get(c.id)).artifactHash).toBe(c.artifactHash)
	}, 60_000)

	test("revert discards the draft and leaves the saved version; a stale token is refused", async () => {
		const c = await offered()
		const broken = await call<Sockets.Components.Save.Response>(h.componentsSave, { id: c.id, expectedUpdatedAt: c.updatedAt, files: { ...c.files, "Widget.svelte": BROKEN } })
		const stale = await call<any>(h.componentsRevertDraft, { id: c.id, expectedUpdatedAt: c.updatedAt })
		expect(stale.error).toMatch(/changed since it was read/)
		expect((await get(c.id)).hasComponentDraft).toBe(true)
		const res = await call<Sockets.Components.RevertDraft.Response>(h.componentsRevertDraft, { id: c.id, expectedUpdatedAt: broken.component.updatedAt })
		expect(res.component.componentDraft).toBeNull()
		expect(res.component.files).toEqual(c.files)
		expect(res.component.artifactHash).toBe(c.artifactHash)
		expect(res.component.src).toBe(c.src)
		expect((await call<any>(h.componentsRevertDraft, { id: c.id, expectedUpdatedAt: res.component.updatedAt })).error).toMatch(/no draft to revert/)
	}, 60_000)

	test("a stale broken save is refused and stores no draft", async () => {
		const c = await offered()
		const moved = await call<Sockets.Components.Save.Response>(h.componentsSave, { id: c.id, expectedUpdatedAt: c.updatedAt, label: "Moved" })
		const res = await call<any>(h.componentsSave, { id: c.id, expectedUpdatedAt: c.updatedAt, files: { ...c.files, "Widget.svelte": BROKEN } })
		expect(res.error).toMatch(/changed since it was read/)
		const now = await get(c.id)
		expect(now.componentDraft).toBeNull()
		expect(now.updatedAt).toBe(moved.component.updatedAt)
	}, 60_000)

	test("export ships the saved version and says a draft was left out", async () => {
		const c = await offered()
		const plain = await call<Sockets.Components.Export.Response>(h.componentsExport, { id: c.id })
		expect(plain.componentDraftLeftOut).toBe(false)
		await call(h.componentsSave, { id: c.id, expectedUpdatedAt: c.updatedAt, files: { ...c.files, "Widget.svelte": BROKEN } })
		const ex = await call<Sockets.Components.Export.Response>(h.componentsExport, { id: c.id })
		expect(ex.componentDraftLeftOut).toBe(true)
		expect(ex.envelope.files).toEqual(c.files)
		expect(ex.envelope.artifact?.hash).toBe(c.artifactHash)
		expect(JSON.stringify(ex.envelope)).not.toContain(BROKEN)
	}, 60_000)

	test("a component that has NEVER compiled stores its broken source as the source, has no draft, and is not offered", async () => {
		const res = await call<Sockets.Components.Import.Response>(h.componentsImport, { text: BROKEN, filename: "Never.svelte" })
		expect(res.compile?.errors.length).toBeGreaterThan(0)
		const c = res.component
		expect(c.artifactHash).toBeNull()
		expect(c.componentDraft).toBeNull()
		await call(h.componentsReviewScopes, { id: c.id, denied: [] })
		await call(h.componentsSetEnabled, { id: c.id, enabled: true })
		const again = await call<Sockets.Components.Save.Response>(h.componentsSave, { id: c.id, expectedUpdatedAt: (await get(c.id)).updatedAt, files: { "Never.svelte": "<p>{{</p>" } })
		expect(again.stored).toBe("saved-version")
		expect(again.component.files).toEqual({ "Never.svelte": "<p>{{</p>" })
		expect(again.component.componentDraft).toBeNull()
		expect(again.component.lastError).toBeTruthy()
		expect(again.component.src).toBeNull()
	}, 60_000)
})

describe("preview", () => {
	const files = { "A.svelte": "<p>preview me</p>" }
	const route = () => import("../../../routes/component-preview/[token]/+server")
	const get = async (token: string) => (await route()).GET({ params: { token } } as never) as Promise<Response>

	test("mints a capability URL served only to its minter while it lives", async () => {
		const res = await call<Sockets.Components.Preview.Response>(h.componentsPreview, { files, entry: "A.svelte", framework: "svelte" }, caller({ id: 1 }))
		expect(res.compile.errors).toEqual([])
		expect(res.url).toMatch(/^\/component-preview\/[a-f0-9]{32}$/)
		const token = res.url!.split("/").pop()!

		authenticateRequestMock.mockResolvedValue({ id: 1, username: "admin", isAdmin: true })
		const ok = await get(token)
		expect(ok.status).toBe(200)
		expect(ok.headers.get("content-type")).toMatch(/text\/javascript/)
		expect(ok.headers.get("x-content-type-options")).toBe("nosniff")
		expect(ok.headers.get("cache-control")).toMatch(/private.*immutable/)
		expect(await ok.text()).toContain("preview me")

		// Another admin, a non-admin, no session, an unknown token: the same 404.
		authenticateRequestMock.mockResolvedValue({ id: 3, username: "other", isAdmin: true })
		expect((await get(token)).status).toBe(404)
		authenticateRequestMock.mockResolvedValue(null)
		expect((await get(token)).status).toBe(404)
		authenticateRequestMock.mockResolvedValue({ id: 1, username: "admin", isAdmin: true })
		expect((await get("0".repeat(32))).status).toBe(404)
		expect((await get("../../etc")).status).toBe(404)

		// Expired: ten minutes on, the owner too gets a 404.
		const now = Date.now()
		preview.__setPreviewClockForTests(() => now + preview.PREVIEW_TTL_MS + 1)
		expect((await get(token)).status).toBe(404)
	}, 60_000)

	test("a preview that does not compile mints nothing; a bad path is refused before compiling", async () => {
		const bad = await call<Sockets.Components.Preview.Response>(h.componentsPreview, { files: { "A.svelte": "<p>{</p>" }, entry: "A.svelte", framework: "svelte" })
		expect(bad.compile.errors.length).toBeGreaterThan(0)
		expect(bad.url).toBeUndefined()
		const runs = compile.componentCompileRuns()
		const trav = await call<any>(h.componentsPreview, { files: { "../A.svelte": "<p/>" }, entry: "../A.svelte", framework: "svelte" })
		expect(trav.error).toMatch(/not a component path/)
		expect(compile.componentCompileRuns()).toBe(runs)
	}, 60_000)
})

describe("sharing: the component@1 file", () => {
	async function sharedClone() {
		const a = await call<Sockets.Components.Clone.Response>(h.componentsClone, { slug: "stats" })
		const ex = await call<Sockets.Components.Export.Response>(h.componentsExport, { id: a.component.id })
		return { original: a.component, ...ex }
	}

	test("export carries source, declaration, basedOn and the compiled module with its hash and fingerprint", async () => {
		const { original, envelope, filename } = await sharedClone()
		expect(filename).toBe(`${original.slug}.component.json`)
		expect(envelope.serenePub).toBe("component@1")
		expect(envelope.component).toEqual({ slug: original.slug, label: original.label, framework: "svelte", entry: original.entry, basedOn: original.basedOn })
		expect(envelope.files).toEqual(original.files)
		expect(envelope.widget).toEqual(original.widget)
		expect(envelope.artifact?.hash).toBe(original.artifactHash)
		expect(envelope.artifact?.fingerprint).toBe(original.fingerprint)
	}, 60_000)

	test("with a compiler, import RECOMPILES — a tampered carried module is ignored — as a copy, off, scopes unreviewed", async () => {
		const { original, envelope } = await sharedClone()
		const tampered = { ...envelope, artifact: { ...envelope.artifact!, code: "export default 'evil'" } }
		const pre = await call<Sockets.Components.ImportPreview.Response>(h.componentsImportPreview, { envelope: tampered })
		expect(pre.summary).toMatchObject({ runs: "recompiled", requestedScopes: ["session:state"], artifact: { carried: true, verifies: false } })
		expect(pre.summary.importAs).not.toBe(original.slug)
		expect(pre.summary.compile?.errors).toEqual([])
		const before = await rowCount()
		const res = await call<Sockets.Components.Import.Response>(h.componentsImport, { envelope: tampered })
		expect(await rowCount()).toBe(before + 1)
		expect(res.renamedFrom).toBe(original.slug)
		expect(res.component.slug).toBe(pre.summary.importAs)
		expect(res.component.id).not.toBe(original.id)
		expect(res.compile?.errors).toEqual([])
		// The same source compiles to the same module — never the carried bytes.
		expect(res.component.artifactHash).toBe(original.artifactHash)
		expect(await cache.readArtifact(res.component.id, res.component.artifactHash!)).not.toContain("evil")
		expect(res.component.enabled).toBe(false)
		expect(res.component.needsReview).toBe(true)
		expect(res.component.scopes.every((s) => s.pending && !s.granted)).toBe(true)
		expect(res.component.basedOn).toEqual(original.basedOn)
	}, 60_000)

	test("with NO compiler, import runs the carried module only when its hash verifies", async () => {
		const { envelope } = await sharedClone()
		compile.__setComponentCompilerForTests(NO_COMPILER)

		const tampered = { ...envelope, artifact: { ...envelope.artifact!, code: envelope.artifact!.code + "\n;globalThis.x=1" } }
		const before = await rowCount()
		const t = await call<any>(h.componentsImport, { envelope: tampered })
		expect(t.error).toMatch(/does not match the hash it names/)
		const bare = { ...envelope, artifact: undefined }
		const b = await call<any>(h.componentsImport, { envelope: bare })
		expect(b.error).toMatch(/^This pub has no component compiler: .*carries no compiled module/)
		expect(await rowCount()).toBe(before)

		const pre = await call<Sockets.Components.ImportPreview.Response>(h.componentsImportPreview, { envelope })
		expect(pre.summary).toMatchObject({ runs: "carried-artifact", compile: null, artifact: { carried: true, verifies: true } })

		const ok = await call<Sockets.Components.Import.Response>(h.componentsImport, { text: JSON.stringify(envelope), filename: "stats.component.json" })
		expect(ok.compile).toBeNull()
		expect(ok.component.artifactHash).toBe(envelope.artifact!.hash)
		expect(ok.component.fingerprint).toBe(envelope.artifact!.fingerprint)
		expect(ok.component.lastError).toBeNull()
		expect(ok.component.needsReview).toBe(true)
		expect(await cache.readArtifact(ok.component.id, envelope.artifact!.hash)).toBe(envelope.artifact!.code)
	}, 60_000)

	test.each([
		["the wrong format tag", { envelope: { serenePub: "scripts@1", scripts: [] } }, /expected a component share file/],
		["not JSON and not a source file", { text: "{ nope", filename: "x.json" }, /neither JSON nor a single/],
		["a traversal path", { envelope: { serenePub: "component@1", component: { slug: "t", label: "T", framework: "svelte", entry: "../a.ts" }, widget: { title: "T" }, files: { "../a.ts": "export default 1" } } }, /not a component path/],
		["an absolute path", { envelope: { serenePub: "component@1", component: { slug: "t", label: "T", framework: "svelte", entry: "/a.ts" }, widget: { title: "T" }, files: { "/a.ts": "export default 1" } } }, /not a component path/],
		["an oversized file", { text: JSON.stringify({ serenePub: "component@1", pad: "x".repeat(4 * 1024 * 1024) }), filename: "x.json" }, /over the 4194304-byte limit/],
		["an oversized envelope", { envelope: { serenePub: "component@1", pad: "x".repeat(4 * 1024 * 1024) } }, /over the 4194304-byte limit/],
		["a malformed artifact", { envelope: { serenePub: "component@1", component: { slug: "t", label: "T", framework: "svelte", entry: "a.ts" }, widget: { title: "T" }, files: { "a.ts": "export default 1" }, artifact: { code: "x", hash: "../../x", fingerprint: "f" } } }, /artifact\.hash must be a SHA-256/],
		["a missing component", { envelope: { serenePub: "component@1", widget: { title: "T" }, files: {} } }, /component must be/],
		["nothing at all", {}, /nothing arrived/]
	])("import refuses %s, in words, storing nothing", async (_name, params, says) => {
		const before = await rowCount()
		for (const handler of [h.componentsImportPreview, h.componentsImport]) {
			const res = await call<any>(handler, params)
			expect(res.error).toMatch(/^That share file was refused: /)
			expect(res.error).toMatch(says)
		}
		expect(await rowCount()).toBe(before)
	})

	test("a single bare .svelte file imports as a one-file component named after it", async () => {
		const res = await call<Sockets.Components.Import.Response>(h.componentsImport, { text: "<p>just me</p>", filename: "Just_Me.svelte" })
		expect(res.compile?.errors).toEqual([])
		expect(res.component).toMatchObject({ slug: "just_me", label: "Just_Me", framework: "svelte", entry: "Just_Me.svelte" })
	}, 60_000)
})

describe("components:changed", () => {
	test("reaches every socket that declared it (any user's) with id, owner and src — never the source", async () => {
		const made = await call<Sockets.Components.Create.Response>(h.componentsCreate, { framework: "svelte", slug: "announced" })
		const c = made.component
		const { io, sent } = fakeIo({
			bare: ["components:changed"],
			scoped: [`components:changed#${c.ownerId}`],
			otherScope: ["components:changed#authored.zzzzzzzzzz"],
			none: [],
			unrelated: ["sessions:get"]
		})
		const admin = caller({ io })
		await call(h.componentsReviewScopes, { id: c.id, denied: [] }, admin)
		await call(h.componentsSetEnabled, { id: c.id, enabled: true }, admin)
		const enabledSrc = `/authored-ui/${c.ownerId}/${c.artifactHash}.js`
		expect(sent.bare!.map((e) => e.data)).toEqual([
			{ id: c.id, ownerId: c.ownerId, src: null },
			{ id: c.id, ownerId: c.ownerId, src: enabledSrc }
		])
		expect(sent.scoped).toEqual(sent.bare)
		expect(sent.otherScope).toEqual([])
		expect(sent.none).toEqual([])
		expect(sent.unrelated).toEqual([])

		const now = (await call<Sockets.Components.Get.Response>(h.componentsGet, { id: c.id })).component
		await call(h.componentsSave, { id: c.id, expectedUpdatedAt: now.updatedAt, files: { ...now.files, "Widget.svelte": "<p>SECRET-SOURCE-MARK</p>" } }, admin)
		const after = (await call<Sockets.Components.Get.Response>(h.componentsGet, { id: c.id })).component
		await call(h.componentsDelete, { id: c.id, expectedUpdatedAt: after.updatedAt }, admin)
		const all = sent.bare!.map((e) => e.data)
		expect(all.slice(2)).toEqual([
			{ id: c.id, ownerId: c.ownerId, src: `/authored-ui/${c.ownerId}/${after.artifactHash}.js` },
			{ id: c.id, ownerId: c.ownerId, src: null }
		])
		for (const e of sent.bare!) {
			expect(e.event).toBe("components:changed")
			expect(Object.keys(e.data).sort()).toEqual(["id", "ownerId", "src"])
		}
		expect(JSON.stringify(sent)).not.toContain("SECRET-SOURCE-MARK")
		// Deleted: gone from the store and from the component cache.
		expect((await call<any>(h.componentsGet, { id: c.id })).error).toMatch(/no authored component/)
		expect(existsSync(join(cache.componentCacheDir(), c.ownerId))).toBe(false)
	}, 60_000)

	test("emitToInterested refuses an ungated event rather than sending it to nobody", async () => {
		const { emitToInterested } = await import("./utils/broadcastHelpers")
		const { io } = fakeIo({ a: ["plugins:whatever"] })
		expect(() => emitToInterested(io as never, "plugins:whatever", {})).toThrow(/not gated/)
	})
})
