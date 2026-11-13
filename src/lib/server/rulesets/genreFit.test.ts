/**
 * 🚧 (s22-V, ★§22-3) `rulesetFitByGenre`: the rating per genre that declares
 * `uses` (today's `rulesetFit`), and _not-offered_ where a genre's `only`
 * leaves a ruleset out.
 */
import { describe, expect, it } from "vitest"
import { RULESET_RATINGS, rulesetFit, type RulesetDecl } from "@serene-pub/sdk"
import {
	chatGenre,
	dungeonCrawlerGenre,
	freeformRuleset,
	storyGenre,
	visItinerisRuleset
} from "@serene-pub/core-catalog"
import { rulesetFitByGenre, type FitRatingGenre } from "./genreFit"

const asGenre = (
	g: { id: string; name?: unknown },
	name: string
): FitRatingGenre => ({
	genreId: g.id,
	genreName: name,
	decl: g as unknown as FitRatingGenre["decl"]
})
const story = asGenre(storyGenre, "Story")
const chat = asGenre(chatGenre, "Chat")
const crawler = asGenre(dungeonCrawlerGenre, "Dungeon Crawler")
const freeform = freeformRuleset as unknown as RulesetDecl
const vis = visItinerisRuleset as unknown as RulesetDecl

describe("rulesetFitByGenre", () => {
	it("rates a genre that declares uses, with rulesetFit's own reason", () => {
		for (const ruleset of [freeform, vis]) {
			const out = rulesetFitByGenre([story, crawler], ruleset)
			expect(out.map((o) => o.genreId)).toEqual([
				storyGenre.id,
				dungeonCrawlerGenre.id
			])
			for (const [i, g] of [storyGenre, dungeonCrawlerGenre].entries()) {
				expect(out[i]!.genreName).toBe(
					i === 0 ? "Story" : "Dungeon Crawler"
				)
				expect(RULESET_RATINGS as readonly string[]).toContain(
					out[i]!.rating
				)
				const f = rulesetFit(g as any, ruleset)
				expect(out[i]!.rating).toBe(f.rating)
				expect(out[i]!.reason).toBe(f.reason)
				if (f.inWords.length)
					expect(out[i]!.inWords).toEqual(
						f.inWords.map((r) => ({
							label: r.label ?? r.key,
							why: r.why ?? ""
						}))
					)
				else expect(out[i]!.inWords).toBeUndefined()
			}
		}
	})

	it("says nothing for a genre with no uses (Chat)", () => {
		expect(chatGenre.uses).toBeUndefined()
		expect(rulesetFitByGenre([chat], freeform)).toEqual([])
		expect(
			rulesetFitByGenre([chat, story], vis).map((o) => o.genreId)
		).toEqual([storyGenre.id])
	})

	it("reads not-offered where only leaves a ruleset out, and nothing for one inside", () => {
		const only: FitRatingGenre = {
			genreId: "x:genre/only",
			genreName: "Only",
			decl: { rulesets: { only: [vis.id] } }
		}
		const [out] = rulesetFitByGenre([only], freeform)
		expect(out).toMatchObject({
			genreId: "x:genre/only",
			genreName: "Only",
			rating: "not-offered"
		})
		expect(out!.reason.startsWith("this genre plays only ")).toBe(true)
		expect(out!.reason).toContain(
			String((visItinerisRuleset as any).name?.en ?? vis.id)
		)
		expect(rulesetFitByGenre([only], vis)).toEqual([])
	})

	it("rates a ruleset inside an only list when the genre declares uses", () => {
		const onlyUses: FitRatingGenre = {
			genreId: "x:genre/only-uses",
			genreName: "Only uses",
			decl: { uses: storyGenre.uses, rulesets: { only: [vis.id] } }
		}
		const [inside] = rulesetFitByGenre([onlyUses], vis)
		expect(inside!.rating).toBe(rulesetFit(storyGenre as any, vis).rating)
		const [outside] = rulesetFitByGenre([onlyUses], freeform)
		expect(outside!.rating).toBe("not-offered")
	})

	describe("which time a genre keeps", () => {
		const storyTimed = {
			id: "x:ruleset/festival@1",
			name: { en: "Festival" },
			functions: [
				{
					ref: "core:function/scheduled@1",
					key: "festival",
					options: { at: { year: 1, month: 1, day: 3 } }
				}
			]
		} as unknown as RulesetDecl
		const noKeep = (g: FitRatingGenre): FitRatingGenre => ({
			...g,
			decl: { ...g.decl, keepsTime: undefined }
		})

		it("rates rules that count story time Poor on a real-time genre, with the sentence", () => {
			expect(chatGenre.keepsTime).toBe("real")
			const [out] = rulesetFitByGenre([chat], storyTimed)
			expect(out!.rating).toBe("poor")
			expect(out!.reason).toContain("story time")
			expect(out!.reason).toContain("real time")
		})

		it("leaves a story-time genre rated as before", () => {
			const [kept] = rulesetFitByGenre([story], storyTimed)
			const [before] = rulesetFitByGenre([noKeep(story)], storyTimed)
			expect(kept!.rating).toBe(before!.rating)
			expect(kept!.reason).toBe(before!.reason)
		})

		it("says nothing on Chat for rules that declare no time, and leaves Story unchanged", () => {
			for (const ruleset of [freeform, vis]) {
				expect(rulesetFitByGenre([chat], ruleset)).toEqual([])
				const [kept] = rulesetFitByGenre([story], ruleset)
				const [before] = rulesetFitByGenre([noKeep(story)], ruleset)
				expect(kept!.rating).toBe(before!.rating)
				expect(kept!.reason).toBe(before!.reason)
			}
		})
	})
})
