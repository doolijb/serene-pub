import { describe, expect, it, vi } from "vitest"

const { go } = vi.hoisted(() => ({ go: vi.fn(async () => true) }))
vi.mock("$lib/client/admin/adminRouter.svelte", () => ({
	adminRouter: { go }
}))

import {
	openInConnections,
	openInModels,
	openInPipelines,
	pipelinesAdminHref, openInLoadouts } from "./railDoors"

function ctx() {
	return {
		digest: {} as PanelsCtx["digest"],
		openPanel: vi.fn()
	}
}

describe("openInModels", () => {
	it("sends a job to the Loadouts view, where its sheet lives since I12", () => {
		const c = ctx()
		openInModels(c, { connectionsJob: "text->text" })
		expect(c.digest.connectionsJob).toBe("text->text")
		expect(c.digest.connectionId).toBeUndefined()
		expect(c.openPanel).toHaveBeenCalledWith({ key: "loadouts", toggle: false })
	})

	it("opens the list when no door is given", () => {
		const c = ctx()
		openInModels(c, {})
		expect(c.digest).toEqual({})
		expect(c.openPanel).toHaveBeenCalledOnce()
	})

	it("does nothing without a panels context", () => {
		expect(() =>
			openInModels(undefined, { connectionsJob: "text->text" })
		).not.toThrow()
	})
})

describe("openInConnections", () => {
	it("opens the Connections view on one connection", () => {
		const c = ctx()
		openInConnections(c, { connectionId: 7 })
		expect(c.digest.connectionId).toBe(7)
		expect(c.digest.connectionsJob).toBeUndefined()
		expect(c.openPanel).toHaveBeenCalledWith({
			key: "connections",
			toggle: false
		})
	})

	it("opens the list when no door is given", () => {
		const c = ctx()
		openInConnections(c)
		expect(c.digest).toEqual({})
		expect(c.openPanel).toHaveBeenCalledOnce()
	})

	it("does nothing without a panels context", () => {
		expect(() => openInConnections(undefined, { connectionId: 1 })).not.toThrow()
	})
})

describe("openInPipelines", () => {
	it("opens Admin › Pipelines at one pipeline", () => {
		const c = ctx()
		openInPipelines(c, { slug: "core:spec/story-respond" })
		expect(go).toHaveBeenCalledWith(
			"/admin/pipelines/core%3Aspec%2Fstory-respond"
		)
		expect(c.openPanel).toHaveBeenCalledWith({ key: "admin", toggle: false })
	})

	it("opens the list when no slug is given", () => {
		const c = ctx()
		openInPipelines(c, { slug: null })
		expect(go).toHaveBeenLastCalledWith("/admin/pipelines")
		expect(pipelinesAdminHref()).toBe("/admin/pipelines")
	})

	it("never opens the retired rail view", () => {
		const c = ctx()
		openInPipelines(c)
		expect(c.openPanel).not.toHaveBeenCalledWith(
			expect.objectContaining({ key: "pipelines" })
		)
	})
})

describe("openInLoadouts", () => {
	it("opens one loadout's sheet by row id", () => {
		const c = ctx()
		openInLoadouts(c, { loadoutId: 7 })
		expect(c.digest.loadoutId).toBe(7)
		expect(c.openPanel).toHaveBeenCalledWith({ key: "loadouts", toggle: false })
	})
	it("opens a job's default loadout", () => {
		const c = ctx()
		openInLoadouts(c, { job: "text->image" })
		expect(c.digest.connectionsJob).toBe("text->image")
	})
})

