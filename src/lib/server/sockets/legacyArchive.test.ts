import { describe, expect, it } from "vitest"
import { archivedWrite } from "./legacyArchive"

/**
 * The archive rule, which is the only thing actually making the 0.5 tables
 * read-only — the sidebar hiding its Save button is a courtesy, and anything
 * with a socket can still emit.
 *
 * The cases that matter here are the two directions of getting it wrong:
 * refusing a read (which would break the panel this exists to keep usable) and
 * allowing a write (which would let someone re-tune a prompt config, watch it
 * save, and spend a week wondering why nothing changed).
 */

describe("what the archive refuses", () => {
	const NAMESPACES = [
		"contextConfigs",
		"promptConfigs",
		"narratorPromptConfigs",
		"worldSummarizeConfigs",
		"characterSummarizeConfigs",
		"sceneSummarizeConfigs",
		"graphBuildConfigs"
	]

	for (const ns of NAMESPACES)
		describe(ns, () => {
			for (const verb of ["create", "update", "delete"])
				it(`refuses ${verb}`, () => {
					const r = archivedWrite(`${ns}:${verb}`)
					expect(r?.event).toBe(`${ns}:${verb}:error`)
					expect(r?.message).toMatch(/read-only/)
				})

			for (const verb of ["get", "list", "preview"])
				it(`still allows ${verb}`, () => {
					expect(archivedWrite(`${ns}:${verb}`)).toBeNull()
				})

			for (const verb of ["setUserActive", "setDefault"])
				it(`refuses ${verb}, which reads as selection and is not`, () => {
					// What these select is which archived row a scope points
					// at, and nothing reads those pointers any more — so they
					// are writes that change nothing observable, which is the
					// precise shape of the mistake the archive prevents.
					expect(archivedWrite(`${ns}:${verb}`)).toBeTruthy()
				})
		})

	it("fails closed on a verb nobody has thought of yet", () => {
		// The reads are listed and everything else refuses, rather than the
		// reverse. A bulk import or a `duplicate` added later must not stay
		// writable by default — the harmless mistake is refusing a new read
		// once, loudly.
		expect(archivedWrite("promptConfigs:duplicate")).toBeTruthy()
		expect(archivedWrite("contextConfigs:reorder")).toBeTruthy()
	})
})

describe("what it leaves alone", () => {
	it("does not touch the pipeline tables that replaced these", () => {
		for (const e of [
			"pipelines:setOption",
			"pipelines:updateContextTemplate",
			"pipelines:libraryDeleteTemplate",
			"pipelines:libraryUpdatePrompt"
		])
			expect(archivedWrite(e), e).toBeNull()
	})

	it("does not touch tables that are still live", () => {
		// Sampling configs and connections are *not* legacy — they are the
		// same entity in 0.6, selected through the config layer. A rule that
		// caught them by pattern rather than by name would take the whole
		// application read-only.
		for (const e of [
			"samplingConfigs:update",
			"samplingConfigs:setUserActive",
			"connections:create",
			"characters:update",
			"chats:delete"
		])
			expect(archivedWrite(e), e).toBeNull()
	})

	it("ignores anything that is not a namespaced event", () => {
		expect(archivedWrite("connect")).toBeNull()
		expect(archivedWrite("")).toBeNull()
	})
})
