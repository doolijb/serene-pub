/**
 * Plugin actions outside a session (M0, lane P4): a frame's
 * `ctx.invoke('world.save', draft)` reaches the package's handler, and every
 * refusal says which door was shut.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { declaredPermissions, reviewMarks } from "./permissions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
vi.mock("$lib/server/plugins", () => ({ getManager: () => ({}) }))

// The genres the pub offers: the real registry, but `getSessionGenre` / `listOfferedGenres` answer from here.
const APPLET_GENRE = "acme.x:genre/sim"
let offered: any[] = []
vi.mock("$lib/server/pipelines/entities/sessionGenres", async (importOriginal) => {
	const orig: any = await importOriginal()
	return {
		...orig,
		listOfferedGenres: async () => offered,
		getSessionGenre: async (d: any, id: string) => offered.find((g) => g.genreId === id) ?? orig.getSessionGenre(d, id)
	}
})

const ID = "acme.x"
const HANDLER = "acme.x:outlet/world-save@1"
const manifest = {
	permissions: ["storage"],
	surfaces: { "session-view": { entry: "ui/session.html" } },
	pluginActions: {
		"world.save": { params: { title: { type: "string", required: true } }, handler: HANDLER },
		"img.pick": { params: {}, handler: HANDLER },
		"ghost.act": { params: {}, handler: "acme.x:outlet/ghost@1" }
	},
	nodeDefinitions: [{ id: HANDLER, kind: "outlet" }],
	hooks: { nodeHandlers: { [HANDLER]: "saveWorld" } }
}

function fake(answer: any = { ok: true, value: { kind: "ok", value: { main: { saved: true } } }, logs: [], durationMs: 0, backend: "quickjs" }) {
	const calls: any[] = []
	return {
		calls,
		callHook: async (...args: any[]) => {
			calls.push(args)
			return answer
		}
	} as any
}

async function put(patch: Record<string, unknown> = {}) {
	await db.delete(schema.plugins).where(eq(schema.plugins.pluginId, ID))
	await db.insert(schema.plugins).values({
		pluginId: ID,
		name: "Acme",
		version: "1.0.0",
		bundleSource: "module.exports = {}",
		bundleHash: "h",
		enabled: true,
		manifest,
		adminDenied: reviewMarks(declaredPermissions(manifest as never)),
		...patch
	} as never)
}

let invokePluginAction: typeof import("./pluginActions").invokePluginAction
beforeAll(async () => {
	process.env.SP_PLUGINS_ENABLED = "1"
	// The db is passed to invokePluginAction explicitly; a vi.mock of
	// $lib/server/db would only run if something imported it.
	db = await createTestDb()
	;({ invokePluginAction } = await import("./pluginActions"))
}, 60_000)
beforeEach(async () => {
	process.env.SP_PLUGINS_ENABLED = "1"
	await put()
})

const run = (over: Record<string, unknown>, manager = fake()) =>
	invokePluginAction(db as never, {
		pluginId: ID,
		action: "world.save",
		input: { title: "World" },
		userId: 7,
		manager,
		...over
	} as never)

describe("invokePluginAction", () => {
	it("reaches the handler with the input, hook name, kind outlet and the user", async () => {
		const m = fake()
		await run({}, m)
		const [pluginId, hook, input, opts] = m.calls[0]
		expect(pluginId).toBe(ID)
		expect(hook).toBe("saveWorld")
		expect(input).toEqual({ title: "World" })
		expect(opts.kind).toBe("outlet")
		expect(opts.user).toBe("7")
		// No applet mount named: no frame-origin cause (C5).
		expect(opts.frameCause).toBeUndefined()
	})

	it("returns the handler's value", async () => {
		expect(await run({})).toEqual({ saved: true })
	})

	it("refuses when extensions are switched off", async () => {
		process.env.SP_PLUGINS_ENABLED = "0"
		await expect(run({})).rejects.toThrow("Extensions are switched off on this pub.")
	})

	it("refuses an extension that is not installed or is switched off", async () => {
		await expect(run({ pluginId: "acme.none" })).rejects.toThrow(
			"That extension is not installed, or it is switched off."
		)
		await db.update(schema.plugins).set({ enabled: false })
		await expect(run({})).rejects.toThrow("That extension is not installed, or it is switched off.")
	})

	it("refuses an action the package does not declare", async () => {
		await expect(run({ action: "nope" })).rejects.toThrow("'Acme' has no action called 'nope'.")
	})

	it("refuses a handler the package does not ship", async () => {
		await expect(run({ action: "ghost.act" })).rejects.toThrow(
			"'Acme' declares 'ghost.act' with a handler it does not ship."
		)
	})

	it("refuses input that fails the action's params", async () => {
		await expect(run({ input: {} })).rejects.toThrow(/^'world\.save' was refused: /)
	})

	it("refuses a file larger than the storage grant", async () => {
		const big = Buffer.alloc(65 * 1024 * 1024).toString("base64")
		await expect(run({ action: "img.pick", input: { name: "a", mime: "x/y", bytes: big } })).rejects.toThrow(
			"That file is 65 MB; 'Acme' can keep at most 64 MB."
		)
	})

	it("says the extension is not running when the hook is missing", async () => {
		const m = fake({ ok: false, reason: "no hook", outcome: "missing", logs: [], durationMs: 0, backend: "quickjs" })
		await expect(run({}, m)).rejects.toThrow(
			"'Acme' is not running. An administrator can switch it on under Admin › Plugins."
		)
	})
})

describe("the frame-origin cause at the invoke door", () => {
	let owner: number, other: number, ordinary: number, appletSession: number
	beforeAll(async () => {
		;[{ id: owner }, { id: other }] = await db
			.insert(schema.users)
			.values([{ username: "fc-owner" }, { username: "fc-other" }])
			.returning({ id: schema.users.id })
		const mk = async (genreId: string) =>
			(await db.insert(schema.sessions).values({ userId: owner, isGroup: false, genreId } as any).returning())[0].id
		ordinary = await mk("core:genre/story")
		appletSession = await mk(APPLET_GENRE)
	})
	beforeEach(() => {
		offered = [{ genreId: APPLET_GENRE, name: "Sim", shape: { applet: true, view: ID } }]
	})
	const cause = async (fromApplet: unknown, userId = owner) => {
		const m = fake()
		await run({ userId, fromApplet }, m)
		return m.calls[0][3].frameCause
	}

	it("a widget's invoke on an ordinary session gets none", async () => {
		expect(await cause({ pluginId: ID, sessionId: ordinary })).toBeUndefined()
	})
	it("the launcher's door gets the cause", async () => {
		expect(await cause({ pluginId: ID })).toEqual({ pluginId: ID })
	})
	it("the session view of the person's own applet session gets the cause", async () => {
		expect(await cause({ pluginId: ID, sessionId: appletSession })).toEqual({ pluginId: ID })
	})
	it("another user with no access gets none", async () => {
		expect(await cause({ pluginId: ID, sessionId: appletSession }, other)).toBeUndefined()
	})
	it("a mount naming another plugin gets none", async () => {
		expect(await cause({ pluginId: "acme.other" })).toBeUndefined()
		expect(await cause({ pluginId: "acme.other", sessionId: appletSession })).toBeUndefined()
	})
	it("the launcher of a plugin with no applet genre gets none", async () => {
		offered = []
		expect(await cause({ pluginId: ID })).toBeUndefined()
	})
})
