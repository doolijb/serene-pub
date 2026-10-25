/**
 * Pipeline names carry no genre (NOMENCLATURE §2, ruled 2026-10-05): four
 * genres' replies are all "Reply". Wherever pipelines of several genres are
 * listed, the genre shows beside the name — read off the spec's declared
 * claim (`taxonomy.genre`), named by the registry (`sessions:genres`).
 */
import { describe, expect, it } from "vitest"
import {
	pipelineGenreId,
	pipelineGenreName,
	pipelineLabel,
	withGenre
} from "./pipelineGenre"

const genres = [
	{ genreId: "core:genre/story", name: "Story" },
	{ genreId: "core:genre/lair", name: "Lair" }
]

const pipelines = [
	{
		slug: "core:spec/story-respond",
		name: "Reply",
		taxonomy: { role: "primary", genre: "core:genre/story" }
	},
	{
		slug: "core:spec/lair-reply",
		name: "Reply",
		taxonomy: { role: "primary", genre: "core:genre/lair" }
	},
	{
		slug: "core:spec/summarize-scene",
		name: "Summarize scene",
		taxonomy: { role: "maintenance" }
	},
	{ slug: "plug:spec/unclassified", name: "Odd one", taxonomy: null }
]

describe("pipelineGenreId", () => {
	it("is the declared claim, or null for a shared or unclassified pipeline", () => {
		expect(pipelineGenreId(pipelines[0])).toBe("core:genre/story")
		expect(pipelineGenreId(pipelines[2])).toBeNull()
		expect(pipelineGenreId(pipelines[3])).toBeNull()
		expect(pipelineGenreId({})).toBeNull()
	})
})

describe("pipelineGenreName", () => {
	it("is the registry's display name, never the id", () => {
		expect(pipelineGenreName(pipelines[1], genres)).toBe("Lair")
	})
	it("names nothing until the genres have arrived", () => {
		expect(pipelineGenreName(pipelines[1], null)).toBeNull()
	})
	it("falls back to the id for a genre the list does not carry", () => {
		expect(
			pipelineGenreName(
				{ taxonomy: { genre: "plug:genre/gone" } },
				genres
			)
		).toBe("plug:genre/gone")
	})
	it("is null for a pipeline every genre shares", () => {
		expect(pipelineGenreName(pipelines[2], genres)).toBeNull()
	})
})

describe("withGenre", () => {
	it("puts the genre beside the name, or leaves the name bare", () => {
		expect(withGenre("Reply", "Lair")).toBe("Reply · Lair")
		expect(withGenre("Summarize scene", null)).toBe("Summarize scene")
	})
})

describe("pipelineLabel", () => {
	it("tells two genres' Reply apart by slug", () => {
		expect(pipelineLabel("core:spec/story-respond", pipelines, genres)).toBe(
			"Reply · Story"
		)
		expect(
			pipelineLabel("core:spec/lair-reply", pipelines, genres)
		).toBe("Reply · Lair")
	})
	it("leaves a shared pipeline's name bare", () => {
		expect(
			pipelineLabel("core:spec/summarize-scene", pipelines, genres)
		).toBe("Summarize scene")
	})
	it("is null while either list is on its way, or for an unknown slug", () => {
		expect(pipelineLabel("core:spec/story-respond", null, genres)).toBeNull()
		expect(
			pipelineLabel("core:spec/story-respond", pipelines, null)
		).toBeNull()
		expect(pipelineLabel("core:spec/gone", pipelines, genres)).toBeNull()
	})
})
