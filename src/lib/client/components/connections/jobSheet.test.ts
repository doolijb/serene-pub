import { describe, expect, test } from "vitest"
import { S } from "@serene-pub/sdk"
import {
	OPEN_IN_ADMIN,
	overridesSentence,
	overridingPipelines,
	pipelineLinkLabel,
	samplingChoiceLabel,
	samplingChoiceRows,
	samplingDefaultToast,
	samplingHeading,
	sheetSections,
	sheetTitle,
	whereSentence
} from "./jobSheet"
import type { SamplingListRow } from "$lib/client/components/sidebars/samplingList"

const row = (
	id: number,
	name: string,
	shape: string = S.textGen,
	extra: Partial<SamplingListRow> = {}
): SamplingListRow => ({ id, name, shape, values: {}, enabled: [], ...extra })

const ROWS: SamplingListRow[] = [
	row(1, "Balanced", S.textGen, {
		isImmutable: true,
		enabled: ["temperature"]
	}),
	row(2, "SDXL", S.imageGen, { isImmutable: true }),
	row(3, "Nemo tuned"),
	row(4, "Flux copy", S.imageGen)
]

describe("the sheet's frame", () => {
	test("is titled with the job's own name", () => {
		expect(sheetTitle("text->text")).toBe("Reply")
	})

	test("numbers three sections for a job that samples", () => {
		expect(sheetSections("text->text")).toEqual([
			{ key: "model", number: "1", heading: "Which model answers" },
			{ key: "sampling", number: "2", heading: "How it writes" },
			{ key: "where", number: "3", heading: "Where this applies" }
		])
	})

	test("counts 1, 2 for a job with no sampling vocabulary", () => {
		expect(sheetSections("text->embedding")).toEqual([
			{ key: "model", number: "1", heading: "Which model answers" },
			{ key: "where", number: "2", heading: "Where this applies" }
		])
	})

	test("says the sampling section in the job's own verb", () => {
		expect(samplingHeading("text->text")).toBe("How it writes")
		expect(samplingHeading("text+image->text")).toBe("How it writes")
		expect(samplingHeading("text->image")).toBe("How it draws")
		expect(samplingHeading("image->image")).toBe("How it draws")
		expect(samplingHeading("text->audio")).toBe("How it speaks")
		expect(samplingHeading("text->embedding")).toBeNull()
	})

	test("says where the default reaches", () => {
		expect(whereSentence("text->text")).toBe(
			"Every session, unless a pipeline configuration names its own model or sampling."
		)
		expect(whereSentence("text->embedding")).toBe(
			"Every session, unless a pipeline configuration names its own model."
		)
	})

	test("leads to Admin › Defaults", () => {
		expect(OPEN_IN_ADMIN).toEqual({
			label: "Open in Admin",
			href: "/admin/defaults"
		})
	})
})

describe("samplingChoiceRows", () => {
	test("lists only the job's shape, the server's order kept, ★ on its default", () => {
		const rows = samplingChoiceRows(ROWS, "text->text", 3)
		expect(rows.map((r) => r.id)).toEqual([1, 3])
		expect(rows[0]).toEqual({
			id: 1,
			name: "Balanced",
			builtIn: true,
			line: "Built in · 1 setting on",
			isDefault: false
		})
		expect(rows[1]).toMatchObject({
			builtIn: false,
			line: "No settings on",
			isDefault: true
		})
	})

	test("an image job reads the image configs", () => {
		const rows = samplingChoiceRows(ROWS, "text->image", null)
		expect(rows.map((r) => r.name)).toEqual(["SDXL", "Flux copy"])
		expect(rows.every((r) => !r.isDefault)).toBe(true)
	})

	test("a job with no sampling vocabulary has no rows", () => {
		expect(samplingChoiceRows(ROWS, "text->embedding", 1)).toEqual([])
	})

	test("names a row for a screen reader", () => {
		const [balanced, nemo] = samplingChoiceRows(ROWS, "text->text", 3)
		expect(samplingChoiceLabel(balanced, "text->text")).toBe(
			"Use Balanced in the Reply loadout"
		)
		expect(samplingChoiceLabel(nemo, "text->text")).toBe(
			"Nemo tuned, used by the Reply loadout"
		)
	})
})

describe("overridingPipelines", () => {
	const pipelines = {
		1: [{ label: "Reply · Lair", slug: "lair-reply" }],
		2: [{ label: "Portrait · Chat", slug: "chat-portrait" }],
		3: [
			{ label: "Planner · Adventure", slug: "adventure-planner" },
			{ label: "Narrator · Plugin", slug: null }
		]
	}

	test("lists the pipelines picking a config of the job's shape, by label", () => {
		expect(overridingPipelines(ROWS, pipelines, "text->text")).toEqual([
			{
				label: "Narrator · Plugin",
				slug: null,
				configName: "Nemo tuned"
			},
			{
				label: "Planner · Adventure",
				slug: "adventure-planner",
				configName: "Nemo tuned"
			},
			{
				label: "Reply · Lair",
				slug: "lair-reply",
				configName: "Balanced"
			}
		])
		expect(
			overridingPipelines(ROWS, pipelines, "text->image").map(
				(p) => p.label
			)
		).toEqual(["Portrait · Chat"])
	})

	test("nothing before the answer, nothing for a job that does not sample", () => {
		expect(overridingPipelines(ROWS, null, "text->text")).toEqual([])
		expect(overridingPipelines(ROWS, pipelines, "text->embedding")).toEqual(
			[]
		)
	})

	test("counts them in words", () => {
		expect(overridesSentence(0)).toBe(
			"No pipeline picks its own sampling config."
		)
		expect(overridesSentence(1)).toBe(
			"1 pipeline picks its own sampling config:"
		)
		expect(overridesSentence(2)).toBe(
			"2 pipelines pick their own sampling config:"
		)
	})

	test("names each link", () => {
		expect(
			pipelineLinkLabel({
				label: "Reply · Lair",
				slug: "lair-reply",
				configName: "Balanced"
			})
		).toBe("Open Reply · Lair in Admin › Pipelines")
		expect(
			pipelineLinkLabel({
				label: "Narrator · Plugin",
				slug: null,
				configName: "Balanced"
			})
		).toBe("Open Admin › Pipelines (Narrator · Plugin is not listed)")
	})
})

describe("what the sheet says after a write", () => {
	test("the radio's toast names the config and the job", () => {
		expect(samplingDefaultToast("Creative", "text->text")).toEqual({
			title: "Loadout sampling updated",
			description: "The Reply loadout uses Creative now."
		})
		expect(samplingDefaultToast(null, "text->text").description).toBe(
			"The Reply loadout uses the config now."
		)
	})
})
