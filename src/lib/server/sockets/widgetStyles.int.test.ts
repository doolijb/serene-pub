/**
 * `widgetStyles:*` — who may see, use and manage a widget skin (PLAN 25, the
 * ownership matrix ruled 2026-08-30).
 *
 * The reconciler's half of this table is already pinned by
 * `db/widgetStyles.int.test.ts` (seed by slug, never touch a user row). This
 * file pins the OTHER half — the socket surface — and every test here is a
 * permission question rather than a CRUD one:
 *
 *   · a list is the caller's USABLE set (system + own + shared), which is
 *     exactly what `shared/widgets/resolve.ts` is documented to be handed —
 *     someone else's private skin is not in it, so a pin to one degrades to the
 *     default instead of rendering a stranger's CSS;
 *   · a system row is not editable or deletable through this surface at all,
 *     because the reconciler owns it and a reseed would silently undo the edit;
 *   · another person's private row is answered with the same sentence a missing
 *     row gets, so an id probe cannot tell "yours to see" from "exists";
 *   · a shared row is the owner's OR an admin's to manage — admin being a
 *     management superset, never a visibility one;
 *   · a clone SNAPSHOTS, so the copy stops tracking the original the moment it
 *     is made. That is the whole point of "clone" rather than "reference".
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { systemStyleSlug } from "$lib/shared/widgets/types"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-widgetstyles-sockets-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	// The system half of the table, seeded exactly as boot seeds it.
	const { CORE_WIDGETS } = await import("$lib/shared/widgets/types")
	const { syncWidgetStyles } = await import("$lib/server/db/widgetStyles")
	await syncWidgetStyles(CORE_WIDGETS, "test")
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const handlers = () => import("./widgetStyles")

/** `widgetStyles:create` called straight, for the refusals. */
const createRaw = async (
	socket: any,
	params: any,
	emit: (event: string, data: any) => void | Promise<void>
) => (await handlers()).widgetStylesCreate.handler(socket, params, emit)

const WIDGET = "messages"

function fakeSocket(userId: number, isAdmin = false) {
	return { user: { id: userId, isAdmin } } as any
}

/** Collects what a handler emitted, so a refusal's sentence can be read back. */
function capture() {
	const events: { event: string; data: any }[] = []
	/**
	 * Mirrors `sockets/index.ts`'s `emitToUser`, lazy form included: a function
	 * payload is a THUNK the real helper evaluates once, and the promise it
	 * returns is what a handler awaits when its cascade has to land before the
	 * reply behind it (`relist`). Recording the evaluated value keeps every
	 * assertion below reading the payload rather than the closure.
	 */
	const emit = (event: string, data: any): void | Promise<void> => {
		if (typeof data !== "function") {
			events.push({ event, data })
			return
		}
		return Promise.resolve(data()).then((value: any) => {
			events.push({ event, data: value })
		})
	}
	return {
		events,
		emit,
		errorFor: (event: string) =>
			events.find((e) => e.event === `${event}:error`)?.data?.error as
				| string
				| undefined,
		listedAfter: () =>
			events.find((e) => e.event === "widgetStyles:list")?.data
				?.styles as Sockets.WidgetStyles.WidgetStyleRow[] | undefined
	}
}

let n = 0
async function makeUser(isAdmin = false) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `ws-user-${n++}`)
	if (isAdmin)
		await testDb
			.update(schema.users)
			.set({ isAdmin: true })
			.where(eq(schema.users.id, user.id))
	return user
}

/** Create through the handler — the only way a user row is ever made. */
async function create(
	userId: number,
	params: Partial<Sockets.WidgetStyles.Create.Params> = {},
	isAdmin = false
) {
	const { widgetStylesCreate } = await handlers()
	const res = await widgetStylesCreate.handler(
		fakeSocket(userId, isAdmin),
		{
			widgetSlug: WIDGET,
			title: "Mine",
			...params
		} as Sockets.WidgetStyles.Create.Params,
		() => {}
	)
	return res.style
}

const rowById = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.widgetStyles)
			.where(eq(schema.widgetStyles.id, id))
	)[0]

describe("widgetStyles:list — the usable set", () => {
	test("is system + own private + others' shared, and never another's private", async () => {
		const alice = await makeUser()
		const bob = await makeUser()

		const mine = await create(alice.id, { title: "Alice private" })
		const bobShared = await create(bob.id, {
			title: "Bob shared",
			visibility: "shared"
		})
		const bobPrivate = await create(bob.id, { title: "Bob private" })

		const { widgetStylesList } = await handlers()
		const res = await widgetStylesList.handler(
			fakeSocket(alice.id),
			{ widgetSlug: WIDGET },
			() => {}
		)
		const ids = res.styles.map((s) => s.id)

		const [systemDefault] = await testDb
			.select()
			.from(schema.widgetStyles)
			.where(
				eq(schema.widgetStyles.slug, systemStyleSlug(WIDGET, "default"))
			)
		expect(ids).toContain(systemDefault.id)
		expect(ids).toContain(mine.id)
		expect(ids).toContain(bobShared.id)
		expect(ids).not.toContain(bobPrivate.id)

		// The filter is a filter, not the scope: another widget's rows are out.
		expect(res.styles.every((s) => s.widgetSlug === WIDGET)).toBe(true)

		// Unfiltered, the same scoping holds across every widget.
		const all = await widgetStylesList.handler(
			fakeSocket(alice.id),
			{},
			() => {}
		)
		expect(all.styles.map((s) => s.id)).not.toContain(bobPrivate.id)
		expect(all.styles.some((s) => s.widgetSlug === "scene-portraits")).toBe(
			true
		)
	})
})

describe("widgetStyles:create", () => {
	test("makes a private user row with a regenerated slug, and re-lists", async () => {
		const alice = await makeUser()
		const { widgetStylesCreate } = await handlers()
		const cap = capture()
		const res = await widgetStylesCreate.handler(
			fakeSocket(alice.id),
			{
				widgetSlug: WIDGET,
				title: "  Cozy  ",
				css: ".m { gap: 0 }",
				vars: { "--gap": "0" }
			},
			cap.emit
		)

		expect(res.style.source).toBe("user")
		expect(res.style.visibility).toBe("private")
		expect(res.style.ownerUserId).toBe(alice.id)
		expect(res.style.title).toBe("Cozy")
		expect(res.style.vars).toEqual({ "--gap": "0" })
		// `user:<id>:<widget>:<random>` — four segments, so it can never
		// collide with a system slug's `<widget>:<preset>`.
		expect(res.style.slug).toMatch(
			new RegExp(`^user:${alice.id}:${WIDGET}:[0-9a-f]{12}$`)
		)

		// The actor gets a fresh list, the way personas:create does.
		expect(cap.listedAfter()?.map((s) => s.id)).toContain(res.style.id)
		expect(cap.events.some((e) => e.event === "widgetStyles:create")).toBe(
			true
		)
	})

	test("a plain, non-admin account may create a SHARED style", async () => {
		// There is no guest ROLE on this instance — `users` carries `isAdmin`
		// and nothing else, and "guest" here means a guest ON A SESSION
		// (`session_guests`), which widget styles are not scoped to. So the
		// "guests may never share" half of the matrix has no subject to refuse
		// and sharing is open to any signed-in account. This test is what says
		// so out loud; the day a guest role exists it is the one that changes.
		const bob = await makeUser()
		const style = await create(bob.id, {
			title: "Bob shared",
			visibility: "shared"
		})
		expect(style.visibility).toBe("shared")
		expect(style.ownerUserId).toBe(bob.id)
	})

	test("refuses a widgetSlug no widget announced", async () => {
		const alice = await makeUser()
		const { widgetStylesCreate } = await handlers()
		const cap = capture()
		await expect(
			widgetStylesCreate.handler(
				fakeSocket(alice.id),
				{ widgetSlug: "not-a-widget", title: "Nope" },
				cap.emit
			)
		).rejects.toThrow(/not a widget/i)
		expect(cap.errorFor("widgetStyles:create")).toMatch(/not a widget/i)
	})

	/**
	 * A plugin's widgets ship no style presets, so nothing ever seeds them into
	 * this table — the allow-list has to read the manifests or a person could
	 * never skin a plugin's panel at all. Namespaced, because that is the id
	 * the session view seats it under and a style keys on the same string.
	 */
	describe("a plugin's own widget", () => {
		const installTray = async (enabled: boolean) => {
			const pluginId = `acme.tray-${n++}`
			await testDb.insert(schema.plugins).values({
				pluginId,
				name: "Tray",
				bundleSource: "// x",
				bundleHash: "deadbeef",
				enabled,
				manifest: {
					surfaces: {
						panels: [{ id: "tray", entry: "ui/tray.html" }]
					}
				}
			})
			return pluginId
		}

		test("accepts its namespaced id while the plugin is enabled", async () => {
			const alice = await makeUser()
			const pluginId = await installTray(true)
			const style = await create(alice.id, {
				widgetSlug: `${pluginId}:tray`,
				title: "Felt"
			})
			expect(style.widgetSlug).toBe(`${pluginId}:tray`)
			// The minted slug still cannot land on a system row's target: it
			// is five segments where a system slug for this widget is three.
			expect(
				(await rowById(style.id)).slug.startsWith(`user:${alice.id}:`)
			).toBe(true)
		})

		test("refuses a panel the plugin does not declare", async () => {
			const alice = await makeUser()
			const pluginId = await installTray(true)
			const cap = capture()
			await expect(
				createRaw(
					fakeSocket(alice.id),
					{ widgetSlug: `${pluginId}:ghost`, title: "Nope" },
					cap.emit
				)
			).rejects.toThrow(/not a widget/i)
		})

		test("refuses the bare panel id, and any id of a disabled plugin", async () => {
			const alice = await makeUser()
			const pluginId = await installTray(false)
			// Bare: the id the package declared is not the id it is seated
			// under, and a style keyed on it would never be asked for.
			await expect(
				createRaw(
					fakeSocket(alice.id),
					{ widgetSlug: "tray", title: "Nope" },
					capture().emit
				)
			).rejects.toThrow(/not a widget/i)
			// Disabled: its rows survive, but no NEW one may be made — the
			// session view does not offer the widget, so nothing would read it.
			await expect(
				createRaw(
					fakeSocket(alice.id),
					{ widgetSlug: `${pluginId}:tray`, title: "Nope" },
					capture().emit
				)
			).rejects.toThrow(/not a widget/i)
		})
	})

	test("refuses oversized CSS and a var key that is not a custom property", async () => {
		const alice = await makeUser()
		const { widgetStylesCreate } = await handlers()

		const big = capture()
		await expect(
			widgetStylesCreate.handler(
				fakeSocket(alice.id),
				{
					widgetSlug: WIDGET,
					title: "Huge",
					css: "a".repeat(64 * 1024 + 1)
				},
				big.emit
			)
		).rejects.toThrow(/too long/i)
		expect(big.errorFor("widgetStyles:create")).toMatch(/64/)

		const bad = capture()
		await expect(
			widgetStylesCreate.handler(
				fakeSocket(alice.id),
				{
					widgetSlug: WIDGET,
					title: "Bad var",
					vars: { color: "red" }
				},
				bad.emit
			)
		).rejects.toThrow(/--/)
		expect(bad.errorFor("widgetStyles:create")).toMatch(/--/)
	})
})

describe("widgetStyles:update / :delete — a system row is not yours", () => {
	test("refuses both, and leaves the seeded row exactly as it was", async () => {
		const alice = await makeUser(true) // even an admin
		const [seeded] = await testDb
			.select()
			.from(schema.widgetStyles)
			.where(
				and(
					eq(schema.widgetStyles.source, "system"),
					eq(schema.widgetStyles.widgetSlug, WIDGET)
				)
			)
		const { widgetStylesUpdate, widgetStylesDelete } = await handlers()

		const up = capture()
		await expect(
			widgetStylesUpdate.handler(
				fakeSocket(alice.id, true),
				{ id: seeded.id, title: "Hijacked" },
				up.emit
			)
		).rejects.toThrow(/built-in/i)
		expect(up.errorFor("widgetStyles:update")).toMatch(/clone/i)

		const del = capture()
		await expect(
			widgetStylesDelete.handler(
				fakeSocket(alice.id, true),
				{ id: seeded.id },
				del.emit
			)
		).rejects.toThrow(/built-in/i)
		expect(del.errorFor("widgetStyles:delete")).toMatch(/built-in/i)

		const after = await rowById(seeded.id)
		expect(after.title).toBe(seeded.title)
		expect(after.css).toBe(seeded.css)
	})
})

describe("widgetStyles:update — ownership", () => {
	test("another account's PRIVATE row answers as if it were not there", async () => {
		const bob = await makeUser()
		const alice = await makeUser()
		const bobPrivate = await create(bob.id, { title: "Bob private" })

		const { widgetStylesUpdate, widgetStylesDelete } = await handlers()
		const up = capture()
		await expect(
			widgetStylesUpdate.handler(
				fakeSocket(alice.id),
				{ id: bobPrivate.id, title: "Taken" },
				up.emit
			)
		).rejects.toThrow(/not found/i)
		expect(up.errorFor("widgetStyles:update")).toMatch(/not found/i)

		const del = capture()
		await expect(
			widgetStylesDelete.handler(
				fakeSocket(alice.id),
				{ id: bobPrivate.id },
				del.emit
			)
		).rejects.toThrow(/not found/i)

		expect((await rowById(bobPrivate.id)).title).toBe("Bob private")
	})

	test("a SHARED row is the owner's or an admin's — and nobody else's", async () => {
		const bob = await makeUser()
		const carol = await makeUser()
		const admin = await makeUser(true)
		const shared = await create(bob.id, {
			title: "Bob shared",
			visibility: "shared"
		})

		const { widgetStylesUpdate } = await handlers()

		const nope = capture()
		await expect(
			widgetStylesUpdate.handler(
				fakeSocket(carol.id),
				{ id: shared.id, title: "Carol's now" },
				nope.emit
			)
		).rejects.toThrow(/owner or an admin/i)
		expect(nope.errorFor("widgetStyles:update")).toMatch(
			/owner or an admin/i
		)

		const byAdmin = await widgetStylesUpdate.handler(
			fakeSocket(admin.id, true),
			{ id: shared.id, title: "Retitled by admin" },
			() => {}
		)
		expect(byAdmin.style.title).toBe("Retitled by admin")
		// Management is not ownership: the row is still Bob's.
		expect(byAdmin.style.ownerUserId).toBe(bob.id)

		const byOwner = await widgetStylesUpdate.handler(
			fakeSocket(bob.id),
			{ id: shared.id, visibility: "private" },
			() => {}
		)
		expect(byOwner.style.visibility).toBe("private")
	})

	test("the owner may delete their own row", async () => {
		const alice = await makeUser()
		const mine = await create(alice.id, { title: "Disposable" })
		const { widgetStylesDelete } = await handlers()
		const cap = capture()
		const res = await widgetStylesDelete.handler(
			fakeSocket(alice.id),
			{ id: mine.id },
			cap.emit
		)
		expect(res.id).toBe(mine.id)
		expect(await rowById(mine.id)).toBeUndefined()
		expect(cap.listedAfter()?.map((s) => s.id)).not.toContain(mine.id)
	})
})

describe("widgetStyles:clone", () => {
	test("snapshots the source and cuts the link to it", async () => {
		const bob = await makeUser()
		const alice = await makeUser()
		const source = await create(bob.id, {
			title: "Bob shared",
			visibility: "shared",
			css: ".m { gap: 4px }",
			vars: { "--gap": "4px" }
		})

		const { widgetStylesClone, widgetStylesUpdate } = await handlers()
		const cap = capture()
		const { style: clone } = await widgetStylesClone.handler(
			fakeSocket(alice.id),
			{ id: source.id },
			cap.emit
		)

		expect(clone.id).not.toBe(source.id)
		expect(clone.slug).not.toBe(source.slug)
		expect(clone.ownerUserId).toBe(alice.id)
		expect(clone.source).toBe("user")
		expect(clone.visibility).toBe("private")
		expect(clone.css).toBe(".m { gap: 4px }")
		expect(clone.vars).toEqual({ "--gap": "4px" })
		expect(cap.listedAfter()?.map((s) => s.id)).toContain(clone.id)

		// The link is cut: editing the original moves nothing in the copy.
		await widgetStylesUpdate.handler(
			fakeSocket(bob.id),
			{ id: source.id, css: ".m { gap: 99px }" },
			() => {}
		)
		expect((await rowById(clone.id)).css).toBe(".m { gap: 4px }")
	})

	test("a system row is clonable — that is how a built-in becomes editable", async () => {
		const alice = await makeUser()
		const [seeded] = await testDb
			.select()
			.from(schema.widgetStyles)
			.where(
				eq(schema.widgetStyles.slug, systemStyleSlug(WIDGET, "default"))
			)
		const { widgetStylesClone } = await handlers()
		const { style } = await widgetStylesClone.handler(
			fakeSocket(alice.id),
			{ id: seeded.id, title: "My default" },
			() => {}
		)
		expect(style.source).toBe("user")
		expect(style.visibility).toBe("private")
		expect(style.title).toBe("My default")
		// Provenance belongs to the reconciler's rows only.
		expect((await rowById(style.id)).seededByVersion).toBeNull()
	})

	test("refuses a row the caller cannot even see", async () => {
		const bob = await makeUser()
		const alice = await makeUser()
		const hidden = await create(bob.id, { title: "Bob private" })
		const { widgetStylesClone } = await handlers()
		const cap = capture()
		await expect(
			widgetStylesClone.handler(
				fakeSocket(alice.id),
				{ id: hidden.id },
				cap.emit
			)
		).rejects.toThrow(/not found/i)
		expect(cap.errorFor("widgetStyles:clone")).toMatch(/not found/i)
	})
})
