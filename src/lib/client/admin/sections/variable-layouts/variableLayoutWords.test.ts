import { describe, expect, it } from "vitest"
import {
	differenceLine,
	lastOwnerSlug,
	leftoverLineWords,
	layoutFormHref,
	layoutSlugOf,
	ownerSlugProblem,
	parseStepParam,
	presetsDifferingWords,
	referenceOf,
	slugProblem,
	stepWords,
	variablesAtSeveralLevels,
	useEverywhereSentence,
	variableHref,
	variableKeyOf,
	writtenAsWords
} from "./variableLayoutWords"

const inUse = (name: string, reason: "pub" | "default" | "automatic") => ({
	id: 1,
	name,
	reference: null,
	reason
})

describe("addresses", () => {
	it("encodes the variable id as one segment", () => {
		expect(variableHref("core:var/characters@1")).toBe(
			"/admin/variable-layouts/core%3Avar%2Fcharacters%401"
		)
		expect(layoutFormHref("core:var/characters@1", 7)).toBe(
			"/admin/variable-layouts/core%3Avar%2Fcharacters%401/7"
		)
		expect(layoutFormHref("core:var/characters@1", "new", 3)).toBe(
			"/admin/variable-layouts/core%3Avar%2Fcharacters%401/new?from=3"
		)
	})
})

describe("writtenAsWords", () => {
	it("says why for each reason", () => {
		expect(
			writtenAsWords({ inUse: inUse("Prose", "pub"), reason: "pub" })
		).toBe("Prose · chosen for this pub")
		expect(
			writtenAsWords({
				inUse: inUse("JSON", "automatic"),
				reason: "automatic"
			})
		).toBe("JSON (automatic)")
		expect(
			writtenAsWords({
				inUse: inUse("Titled JSON block", "default"),
				reason: "default"
			})
		).toBe("Titled JSON block")
		expect(writtenAsWords({ inUse: null, reason: "as-written" })).toBe(
			"As written"
		)
	})
	it("counts presets that differ", () => {
		expect(presetsDifferingWords(0)).toBe("")
		expect(presetsDifferingWords(1)).toBe("+ 1 preset")
		expect(presetsDifferingWords(3)).toBe("+ 3 presets")
	})
})

describe("references", () => {
	it("slugs a name the way the server does", () => {
		expect(layoutSlugOf("  Titled JSON block! ")).toBe("titled-json-block")
	})
	it("writes owner/slug@major with the variable's major", () => {
		expect(referenceOf("acme:var/omens@2", "mypub", "prose")).toBe(
			"mypub/prose@2"
		)
		expect(referenceOf("core:var/characters@1", "mypub", "prose")).toBe(
			"mypub/prose@1"
		)
	})
	it("refuses a bad owner or slug in words", () => {
		expect(ownerSlugProblem("")).toMatch(/needed/)
		expect(ownerSlugProblem("core")).toMatch(/Serene Pub's own/)
		expect(ownerSlugProblem("My Pub")).toMatch(/lowercase/)
		expect(ownerSlugProblem("my.pub")).toBeNull()
		expect(slugProblem("")).toMatch(/needed/)
		expect(slugProblem("Prose")).toMatch(/lowercase/)
		expect(slugProblem("titled-json")).toBeNull()
	})
	it("prefills the owner this pub last used", () => {
		const row = (
			id: number,
			reference: string | null,
			isImmutable = false
		) =>
			({
				id,
				reference,
				isImmutable
			}) as Sockets.Pipelines.Library.LibraryTemplate
		expect(
			lastOwnerSlug([
				row(1, "old/prose@1"),
				row(9, "core/json@1", true),
				row(4, "mypub/lines@1"),
				row(5, null)
			])
		).toBe("mypub")
		expect(lastOwnerSlug([])).toBe("")
	})
})

describe("useEverywhereSentence", () => {
	it("counts pipelines and templates, naming unchecked ones", () => {
		expect(
			useEverywhereSentence("characters", {
				pipelines: 9,
				contextTemplates: 3,
				uncheckedContextTemplates: 0
			})
		).toBe(
			"Every template that writes {{{characters}}} without naming a variable layout uses this one: 9 pipelines, 3 templates."
		)
		expect(
			useEverywhereSentence("omens", {
				pipelines: 1,
				contextTemplates: 1,
				uncheckedContextTemplates: 2
			})
		).toMatch(
			/1 pipeline, 1 template\. 2 templates in a language the check cannot read are not counted\.$/
		)
	})
	it("reads the key from the scope, else the id", () => {
		expect(variableKeyOf({ worldLore: {} }, "core:var/world-lore@1")).toBe(
			"worldLore"
		)
		expect(variableKeyOf({}, "acme:var/omens@1")).toBe("omens")
	})
})

describe("parseStepParam", () => {
	it("splits at the last colon", () => {
		expect(parseStepParam("core:story-respond:694ff0a079d37191")).toEqual({
			specSlug: "core:story-respond",
			stepKey: "694ff0a079d37191"
		})
		expect(parseStepParam("respond")).toBeNull()
		expect(parseStepParam(null)).toBeNull()
	})
})

describe("W2 words", async () => {
	const w = await import("./variableLayoutWords")
	it("joins names the way a sentence does", () => {
		expect(w.joinNames(["A"])).toBe("A")
		expect(w.joinNames(["A", "B"])).toBe("A and B")
		expect(w.joinNames(["A", "B", "C"])).toBe("A, B and C")
		expect(w.presetsWords(["Small"])).toBe("the Small preset")
		expect(w.presetsWords(["A", "B"])).toBe("the A and B presets")
	})
	it("counts the templates that name a layout", () => {
		expect(w.namedByTemplatesWords(0)).toBe("")
		expect(w.namedByTemplatesWords(1)).toBe("Named by 1 context template")
		expect(w.namedByTemplatesWords(2)).toBe("Named by 2 context templates")
	})
	it("says why a layout stays, in the order the server checks", () => {
		const base = { inUse: false, namedByTemplates: 0, chosenByPresets: [] }
		expect(w.layoutStaysWords(base)).toBeNull()
		expect(
			w.layoutStaysWords({ ...base, inUse: true, namedByTemplates: 2 })
		).toMatch(/in use/)
		expect(
			w.layoutStaysWords({
				...base,
				chosenByPresets: [{ name: "A" }, { name: "B" }]
			})
		).toBe("chosen by the A and B presets")
		expect(w.layoutStaysWords({ ...base, namedByTemplates: 1 })).toBe(
			"named by 1 context template"
		)
	})
})

import { engineWords as engineWordsFor } from "./variableLayoutWords"
describe("engineWords", () => {
	it("names core's two languages and passes a plugin's through", () => {
		expect(engineWordsFor("core:template/handlebars@1")).toBe("Handlebars")
		expect(engineWordsFor("core:template/liquid@1")).toBe("Liquid")
		expect(engineWordsFor("acme:template/x@1")).toBe("acme:template/x@1")
	})
})

describe("stepWords", () => {
	it("falls back from heading and label to a step in the pipeline to this step", () => {
		expect(stepWords("Build", "Reply")).toBe("Build in Reply")
		expect(stepWords("Build")).toBe("Build")
		expect(stepWords(undefined, "Reply")).toBe("a step in Reply")
		expect(stepWords()).toBe("this step")
	})
})

describe("leftoverLineWords", () => {
	const base = {
		variableLabel: "Characters",
		layoutName: "JSON",
		scope: { kind: "instance" } as const
	}
	it("reads plainly, naming the step when given", () => {
		expect(leftoverLineWords(base)).toBe(
			"Characters uses JSON here (set before layouts moved)."
		)
		expect(leftoverLineWords(base, { stepHeading: "Build" })).toBe(
			"Characters uses JSON (set on Build before layouts moved)."
		)
	})
	it("names the level", () => {
		const lv = { levelNamed: true }
		expect(
			leftoverLineWords(
				{ ...base, scope: { kind: "genre", genreId: "g" } },
				lv
			)
		).toBe(
			"Characters uses the genre's JSON here (set before layouts moved)."
		)
		expect(
			leftoverLineWords(
				{
					...base,
					scope: { kind: "preset", presetId: 1 },
					presetName: "Quick start"
				},
				{ ...lv, stepHeading: "Build" }
			)
		).toBe(
			"Characters uses the Quick start preset's JSON (set on Build before layouts moved)."
		)
		expect(
			leftoverLineWords(
				{ ...base, scope: { kind: "preset", presetId: 1 } },
				lv
			)
		).toContain("the preset's JSON")
		expect(leftoverLineWords(base, lv)).toContain("the pipeline's JSON")
	})
	it("finds the variables at several levels", () => {
		const g = { kind: "genre", genreId: "g" } as const
		const i = { kind: "instance" } as const
		expect([
			...variablesAtSeveralLevels([
				{ variableId: "a", scope: g },
				{ variableId: "a", scope: i },
				{ variableId: "b", scope: g },
				{ variableId: "b", scope: g }
			])
		]).toEqual(["a"])
	})
	it("words every kind of difference, with its link", () => {
		const layout = { id: 4, name: "Prose" }
		expect(
			differenceLine({ kind: "template", id: 7, name: "Chat", layout })
		).toEqual({
			lead: "The context template ",
			link: { text: "Chat", href: "/admin/context-templates/7" },
			rest: " names Prose."
		})
		expect(
			differenceLine({ kind: "preset", id: 3, name: "Cozy", layout })
		).toEqual({
			lead: "The ",
			link: { text: "Cozy", href: "/admin/session-presets/3" },
			rest: " preset chooses Prose."
		})
		const step = {
			specSlug: "core/story@1",
			pipelineLabel: "Story",
			stepKey: "abc",
			layout
		}
		expect(
			differenceLine({ kind: "leftover", ...step, stepHeading: "Reply" })
		).toEqual({
			lead: "Reply in ",
			link: { text: "Story", href: "/admin/pipelines/core%2Fstory%401" },
			rest: " keeps Prose, picked before layouts moved."
		})
		expect(differenceLine({ kind: "authored", ...step })).toEqual({
			lead: "A step in ",
			link: { text: "Story", href: "/admin/pipelines/core%2Fstory%401" },
			rest: " uses Prose, the pipeline's choice for that step."
		})
	})
})
