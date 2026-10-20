import { describe, expect, it } from "vitest"
import { S } from "@serene-pub/sdk"
import {
	groupSamplingConfigs,
	initialSamplingId,
	jobsWithLiveDefaults,
	nameTaken,
	samplingDeleteWarnings,
	samplingRowLine,
	samplingSettingsOn,
	samplingStarWords,
	samplingUseOf,
	sortJobs,
	uniqueCopyName,
	type SamplingJob,
	type SamplingListRow
} from "./samplingList"

const row = (
	id: number,
	name: string,
	shape: string = S.textGen,
	extra: Partial<SamplingListRow> = {}
): SamplingListRow => ({ id, name, shape, values: {}, enabled: [], ...extra })

const ROWS = [
	row(1, "Default", S.textGen, { isImmutable: true }),
	row(2, "SDXL", S.imageGen, { isImmutable: true }),
	row(3, "Creative"),
	row(4, "Flux copy", S.imageGen)
]

const job = (
	capability: string,
	samplingConfigId: number | null,
	shape: string = S.textGen
): SamplingJob => ({ capability, shape, samplingConfigId })

describe("groupSamplingConfigs", () => {
	it("groups by shape, text first, keeping the server's order inside", () => {
		const groups = groupSamplingConfigs(ROWS)
		expect(groups.map((g) => g.label)).toEqual([
			"Large language models",
			"Image generation"
		])
		expect(groups[0].rows.map((r) => r.id)).toEqual([1, 3])
		expect(groups[1].rows.map((r) => r.id)).toEqual([2, 4])
	})

	it("filters by name and drops a group the filter empties", () => {
		const groups = groupSamplingConfigs(ROWS, "  flux ")
		expect(groups.map((g) => g.label)).toEqual(["Image generation"])
		expect(groups[0].rows.map((r) => r.id)).toEqual([4])
	})

	it("files a row with no shape under text", () => {
		const groups = groupSamplingConfigs([
			{ id: 9, name: "Old", shape: null }
		])
		expect(groups[0].label).toBe("Large language models")
	})
})

describe("jobsWithLiveDefaults", () => {
	it("reads each job's holder from the live map when it is loaded", () => {
		const jobs = [job("text->text", 1), job("text+image->text", null)]
		const live = {
			"text->text": { samplingConfigId: 3 },
			"text+image->text": { samplingConfigId: 1 }
		}
		expect(jobsWithLiveDefaults(jobs, live)).toEqual([
			job("text->text", 3),
			job("text+image->text", 1)
		])
	})

	it("adds a live default the job list has not caught up with", () => {
		const out = jobsWithLiveDefaults([], {
			"text->image": { samplingConfigId: 2 },
			"text->embedding": { samplingConfigId: null }
		})
		expect(out).toEqual([job("text->image", 2, S.imageGen)])
	})

	it("keeps the server's answer while the live map is absent", () => {
		const jobs = [job("text->text", 1)]
		expect(jobsWithLiveDefaults(jobs, undefined)).toEqual(jobs)
	})
})

describe("samplingUseOf and the row's second line", () => {
	const jobs = [
		job("text+image->text", 3),
		job("text->text", 3),
		job("text->image", 2, S.imageGen)
	]
	const pipelines = {
		4: [{ label: "Reply · Chat", slug: "core:spec/story-respond" }]
	}

	it("names every loadout holding the config, Reply first", () => {
		const use = samplingUseOf(3, jobs, pipelines)
		expect(use.jobs.map((j) => j.capability)).toEqual([
			"text->text",
			"text+image->text"
		])
		expect(samplingRowLine(ROWS[2], use)).toBe(
			"No settings on · in the Reply and Vision loadouts"
		)
	})

	it("counts the pipelines that pick it", () => {
		const use = samplingUseOf(4, jobs, pipelines)
		expect(samplingRowLine(ROWS[3], use)).toBe(
			"No settings on · used by 1 pipeline"
		)
	})

	it("says unused when nothing picks it", () => {
		const use = samplingUseOf(1, jobs, pipelines)
		expect(samplingRowLine(ROWS[0], use)).toMatch(/· unused$/)
	})

	it("counts the settings it turns on, in words, against its shape", () => {
		const sending = row(5, "Warm", S.textGen, {
			enabled: ["temperature", "topP", "notInTheSchema"]
		})
		expect(samplingRowLine(sending, { jobs: [], pipelines: [] })).toBe(
			"2 settings on · unused"
		)
		const one = row(6, "Cool", S.textGen, { enabled: ["temperature"] })
		const two = {
			jobs: [],
			pipelines: [...pipelines[4], ...pipelines[4]]
		}
		expect(samplingRowLine(one, two)).toBe(
			"1 setting on · used by 2 pipelines"
		)
		expect(samplingRowLine(one, two)).not.toMatch(/ of | sent|picked/)
	})

	it("says the settings on in the words Admin › Sampling uses too", () => {
		// The changelist's Settings column calls the same helper, so the
		// admin row and the Sampling view's row never count differently.
		const warm = row(7, "Warm", S.textGen, {
			enabled: ["temperature", "topP", "notInTheSchema"]
		})
		expect(samplingSettingsOn(warm)).toBe("2 settings on")
		const cool = row(8, "Cool", S.textGen, { enabled: ["temperature"] })
		expect(samplingSettingsOn(cool)).toBe("1 setting on")
		expect(samplingSettingsOn(row(9, "Bare"))).toBe("No settings on")
		expect(samplingRowLine(warm, { jobs: [], pipelines: [] })).toMatch(
			/^2 settings on · /
		)
	})
})

describe("what the row's star and the Delete dialog say", () => {
	const jobs = [
		job("text+image->text", 3),
		job("text->text", 3),
		job("text->image", 2, S.imageGen)
	]
	const pipelines = {
		3: [{ label: "Reply · Chat", slug: "core:spec/story-respond" }],
		4: [
			{ label: "Reply · Chat", slug: "core:spec/story-respond" },
			{ label: "Narrate", slug: "core:spec/narrate" }
		]
	}

	it("the star names every default loadout holding it, Reply first", () => {
		expect(samplingStarWords(samplingUseOf(3, jobs, pipelines))).toBe(
			"In the Reply and Vision loadouts"
		)
		expect(samplingStarWords(samplingUseOf(2, jobs, pipelines))).toBe(
			"In the Images loadout"
		)
	})

	it("no default, no star", () => {
		expect(samplingStarWords(samplingUseOf(4, jobs, pipelines))).toBeNull()
	})

	it("deleting a default says which loadout falls back, and to what", () => {
		expect(
			samplingDeleteWarnings(samplingUseOf(2, jobs, pipelines))
		).toEqual([
			"The Images loadout uses it, so it will use the connection's own defaults until you set another."
		])
	})

	it("several loadouts are named once", () => {
		expect(
			samplingDeleteWarnings(samplingUseOf(3, jobs, pipelines))
		).toEqual([
			"The Reply and Vision loadouts use it, so they will use the connection's own defaults until you set another.",
			"1 pipeline uses it and will need another choice."
		])
	})

	it("pipelines alone are counted", () => {
		expect(
			samplingDeleteWarnings(samplingUseOf(4, jobs, pipelines))
		).toEqual(["2 pipelines use it and will need another choice."])
	})

	it("nothing uses it, nothing to warn about", () => {
		expect(
			samplingDeleteWarnings(samplingUseOf(9, jobs, pipelines))
		).toEqual([])
	})
})

describe("initialSamplingId", () => {
	it("opens the config last open when it is still there", () => {
		expect(initialSamplingId(ROWS, [], 4)).toBe(4)
		expect(initialSamplingId(ROWS, [], 99)).toBe(1)
	})

	it("opens the text config Chat's default names", () => {
		expect(initialSamplingId(ROWS, [job("text->text", 3)], null)).toBe(3)
	})

	it("else a text config holding any default, else the first text config", () => {
		expect(
			initialSamplingId(ROWS, [job("text+image->text", 3)], null)
		).toBe(3)
		expect(
			initialSamplingId(ROWS, [job("text->image", 2, S.imageGen)], null)
		).toBe(1)
		expect(initialSamplingId([], [], null)).toBeNull()
	})
})

describe("sortJobs", () => {
	it("puts Chat first and the rest by label", () => {
		expect(
			sortJobs([
				job("text+image->text", null),
				job("text->text", null),
				job("text+document->text", null)
			]).map((j) => j.capability)
		).toEqual(["text->text", "text+document->text", "text+image->text"])
	})
})

describe("names", () => {
	it("a copy's name is unique within its modality", () => {
		expect(uniqueCopyName("Flux", S.imageGen, ROWS)).toBe("Flux copy 2")
		expect(uniqueCopyName("Flux", S.textGen, ROWS)).toBe("Flux copy")
	})

	it("a taken name is taken in its modality only, any case", () => {
		expect(nameTaken(" creative ", S.textGen, ROWS)).toBe(true)
		expect(nameTaken("Creative", S.imageGen, ROWS)).toBe(false)
		expect(nameTaken("Creative", S.textGen, ROWS, 3)).toBe(false)
	})
})
