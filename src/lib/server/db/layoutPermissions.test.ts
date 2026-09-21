/**
 * The ruled layout-preset matrix (session layout v2 §4.5), cell by cell.
 *
 * Pure predicates, so this is a unit test and not an integration one — which is
 * the point of having them as predicates: the socket layer can then be tested
 * for the SENTENCES it refuses with, and this for who may do what, without
 * either having to restate the other.
 */
import { describe, expect, test } from "vitest"
import {
	canClone,
	canManage,
	canSee,
	canShare,
	type LayoutActor,
	type LayoutPresetOwnership
} from "./layoutPermissions"

const AUTHOR = 7
const STRANGER = 8

const author: LayoutActor = { id: AUTHOR }
const stranger: LayoutActor = { id: STRANGER }
const admin: LayoutActor = { id: 9, isAdmin: true }
const guest: LayoutActor = { id: AUTHOR, isGuest: true }

const core: LayoutPresetOwnership = {
	origin: "core",
	authorUserId: null,
	visibility: "shared",
	withdrawnAt: null
}
const plugin: LayoutPresetOwnership = {
	origin: "plugin",
	authorUserId: null,
	visibility: "shared",
	withdrawnAt: null
}
const withdrawn: LayoutPresetOwnership = {
	...plugin,
	withdrawnAt: new Date()
}
const shared: LayoutPresetOwnership = {
	origin: "user",
	authorUserId: AUTHOR,
	visibility: "shared",
	withdrawnAt: null
}
const priv: LayoutPresetOwnership = {
	origin: "user",
	authorUserId: AUTHOR,
	visibility: "private",
	withdrawnAt: null
}

describe("see", () => {
	test("everybody sees a shipped row", () => {
		for (const row of [core, plugin])
			for (const who of [author, stranger, admin, guest])
				expect(canSee(row, who)).toBe(true)
	})

	test("everybody sees a shared user row", () => {
		for (const who of [author, stranger, admin, guest])
			expect(canSee(shared, who)).toBe(true)
	})

	test("only the author sees a private one — an admin is not extra visibility", () => {
		expect(canSee(priv, author)).toBe(true)
		expect(canSee(priv, stranger)).toBe(false)
		expect(canSee(priv, admin)).toBe(false)
	})

	test("a withdrawn row is seen by nobody", () => {
		for (const who of [author, stranger, admin])
			expect(canSee(withdrawn, who)).toBe(false)
	})
})

describe("manage", () => {
	test("nobody manages a shipped row, admin included", () => {
		for (const row of [core, plugin])
			for (const who of [author, stranger, admin])
				expect(canManage(row, who)).toBe(false)
	})

	test("a shared user row: the author or an admin", () => {
		expect(canManage(shared, author)).toBe(true)
		expect(canManage(shared, admin)).toBe(true)
		expect(canManage(shared, stranger)).toBe(false)
	})

	test("a private one: the author alone", () => {
		expect(canManage(priv, author)).toBe(true)
		expect(canManage(priv, admin)).toBe(false)
		expect(canManage(priv, stranger)).toBe(false)
	})
})

describe("share", () => {
	test("is management, minus the guest", () => {
		expect(canShare(priv, author)).toBe(true)
		// Same person, reached through a session they are a guest on.
		expect(canShare(priv, guest)).toBe(false)
		expect(canShare(shared, admin)).toBe(true)
		expect(canShare(core, admin)).toBe(false)
	})
})

describe("clone", () => {
	test("seeing it is the whole permission", () => {
		expect(canClone(core, stranger)).toBe(true)
		expect(canClone(plugin, guest)).toBe(true)
		expect(canClone(shared, stranger)).toBe(true)
		expect(canClone(priv, stranger)).toBe(false)
		expect(canClone(withdrawn, author)).toBe(false)
	})
})
