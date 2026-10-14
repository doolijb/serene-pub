import { describe, expect, it } from "vitest"
import { fitComfyWorkflow } from "$lib/server/imageGen/comfy/fit"
import { SDXL_IPADAPTER_EXPORT } from "$lib/server/imageGen/comfy/fixtures/sdxlIpAdapter"
import { firstReadyWorkflow, outputCandidates, rowActions, validityChip } from "./workflowsTab"
import {
	assignStandard,
	draftFromProposal,
	draftProblems,
	editedProposal,
	markOutput,
	otherLiterals,
	setPromoted,
	standardRows
} from "./fitting"

const ON_SERVER = {
	checked: true,
	results: [
		{ workflowId: 1, problem: null, missingNodes: [], missingNames: [] },
		{
			workflowId: 2,
			problem: "Missing nodes: IPAdapter",
			missingNodes: ["IPAdapter"],
			missingNames: []
		},
		{
			workflowId: 3,
			problem: "This workflow names sdxl.safetensors; your ComfyUI doesn't have it.",
			missingNodes: [],
			missingNames: ["sdxl.safetensors"]
		}
	]
}

describe("validity chips", () => {
	it("says ready, the missing nodes, or the missing name — in the §4.9 words", () => {
		expect(validityChip(1, ON_SERVER)).toMatchObject({ tone: "ready", label: "ready" })
		expect(validityChip(2, ON_SERVER)).toMatchObject({
			tone: "missing",
			label: "Missing nodes: IPAdapter"
		})
		expect(validityChip(3, ON_SERVER).label).toBe(
			"This workflow names sdxl.safetensors; your ComfyUI doesn't have it"
		)
		expect(validityChip(1, { checked: false, results: [] }).tone).toBe("unchecked")
		expect(validityChip(9, ON_SERVER).tone).toBe("unchecked")
	})

	it("defaults Draw a test to the first ready workflow", () => {
		expect(firstReadyWorkflow([{ id: 2 }, { id: 1 }], ON_SERVER)).toBe(1)
		expect(firstReadyWorkflow([{ id: 2 }], ON_SERVER)).toBe(2)
		expect(firstReadyWorkflow([], ON_SERVER)).toBeNull()
	})

	it("keeps a starter read-only: no Edit, no Delete", () => {
		expect(rowActions({ isStarter: true })).not.toContain("delete")
		expect(rowActions({ isStarter: true })).not.toContain("edit")
		expect(rowActions({ isStarter: false })).toContain("delete")
	})

	it("finds the output candidates in a document with bare holes", () => {
		const doc = `{"3": {"class_type": "KSampler", "inputs": {"seed": {{seed}}}},
"9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "serene/{{runId}}/{{key}}"}}}`
		expect(outputCandidates(doc)).toEqual([{ nodeId: "9", classType: "SaveImage" }])
	})
})

describe("the fitting form's model", () => {
	const proposal = fitComfyWorkflow(SDXL_IPADAPTER_EXPORT) as any

	it("moves a standard hole, unassigns it, and promotes a literal", () => {
		const draft = draftFromProposal(proposal)
		const rows = standardRows(draft)
		expect(rows.map((r) => r.variable).slice(0, 10)).toEqual([
			"prompt",
			"negative",
			"seed",
			"steps",
			"cfg",
			"sampler",
			"scheduler",
			"width",
			"height",
			"model"
		])
		expect(rows.find((r) => r.variable === "model")!.landings[0]!.address).toBe("4.ckpt_name")

		// Unassign the model: the checkpoint stays baked.
		assignStandard(draft, "model", null)
		expect(standardRows(draft).find((r) => r.variable === "model")!.landings).toEqual([])
		expect(editedProposal(draft).chosen).not.toContain("4.ckpt_name")

		const lora = otherLiterals(draft).find((h) => h.address === "10.lora_name")!
		setPromoted(draft, lora.address, true)
		expect(editedProposal(draft).chosen).toContain("10.lora_name")

		// A promoted name that collides with a standard one is refused.
		lora.variable = "seed"
		expect(draftProblems(draft).join(" ")).toMatch(/standard name/)
		lora.variable = "lora_name"
		expect(draftProblems(draft)).toEqual([])
	})

	it("moves the output mark", () => {
		const draft = draftFromProposal(proposal)
		const preview = draft.outputs.find((o) => o.classType === "PreviewImage")!
		markOutput(draft, preview.nodeId)
		expect(draft.outputNode).toBe(preview.nodeId)
		expect(editedProposal(draft).proposal.outputs.filter((o) => o.role === "output")).toHaveLength(1)
	})
})
