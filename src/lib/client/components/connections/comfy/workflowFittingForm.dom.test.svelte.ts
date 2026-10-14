/**
 * 🚧 The fitting form (DESIGN-image-generation §4.8 step 3), end to end in
 * the DOM: a person's export comes back from `workflows:fit` as a table of
 * holes; promoting one more literal (the LoRA's name) and pressing Save sends
 * the edited proposal back to be applied, then creates the workflow with that
 * variable declared and its hole in the document.
 *
 * The server half is the REAL walk and rewrite (`fitComfyWorkflow`,
 * `applyFit`), so the form and the starters cannot drift apart unnoticed.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import { applyFit, fitComfyWorkflow } from "$lib/server/imageGen/comfy/fit"
import { SDXL_IPADAPTER_EXPORT } from "$lib/server/imageGen/comfy/fixtures/sdxlIpAdapter"
import { UI_FORMAT_REFUSAL } from "$lib/server/imageGen/comfy/graph"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({ emit: () => {} })
}))
const asked: any[] = []
vi.mock("$lib/client/utils/awaitReply", () => ({
	awaitReply: async (opts: any) => {
		asked.push(opts)
		if (opts.event === "workflows:fit") {
			const parsed = JSON.parse(opts.params.content)
			const proposal = fitComfyWorkflow(parsed)
			if (!proposal.holes.length) return { proposal }
			return {
				proposal,
				applied: applyFit(parsed, opts.params.proposal ?? proposal, opts.params.chosen)
			}
		}
		if (opts.event === "workflows:create")
			return { workflow: { ...opts.params.workflow, id: 77, seedKey: null } }
		return {}
	},
	isReplyTimeout: () => false
}))

import WorkflowFittingForm from "./WorkflowFittingForm.svelte"

const mounted: ReturnType<typeof mount>[] = []
beforeEach(() => {
	asked.length = 0
})
afterEach(() => {
	for (const app of mounted.splice(0)) unmount(app)
	document.body.innerHTML = ""
})

async function render(content: string, onSaved = vi.fn()) {
	const target = document.createElement("div")
	document.body.appendChild(target)
	mounted.push(
		mount(WorkflowFittingForm, {
			target,
			props: { content, initialName: "Knight", onSaved }
		})
	)
	flushSync()
	for (let i = 0; i < 5; i++) await tick()
	flushSync()
	return { target, onSaved }
}

const byText = (root: ParentNode, text: string) =>
	[...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)

describe("the fitting form", () => {
	test("shows the proposal, promotes a literal, and saves the applied document", async () => {
		const { target, onSaved } = await render(JSON.stringify(SDXL_IPADAPTER_EXPORT))

		// The standard rows, the prompt landing on its encoder.
		const promptRow = target.querySelector('[data-hole-row="prompt"]')
		expect(promptRow).toBeTruthy()
		expect(target.querySelector('[data-hole-row="model"]')).toBeTruthy()

		// The LoRA's name is offered as an other literal, kept literal.
		const lora = target.querySelector('[data-literal="10.lora_name"]') as HTMLElement
		expect(lora).toBeTruthy()
		byText(lora, "Promote to variable")!.click()
		flushSync()
		const nameInput = lora.querySelector("input") as HTMLInputElement
		expect(nameInput.value).toBe("lora_name")

		byText(target, "Save workflow")!.click()
		for (let i = 0; i < 6; i++) await tick()
		flushSync()

		const fits = asked.filter((a) => a.event === "workflows:fit")
		expect(fits).toHaveLength(2)
		expect(fits[1].params.chosen).toContain("10.lora_name")
		expect(fits[1].params.proposal.holes.length).toBeGreaterThan(5)

		const create = asked.find((a) => a.event === "workflows:create")
		expect(create).toBeTruthy()
		const wf = create.params.workflow
		expect(wf.name).toBe("Knight")
		expect(wf.dialect).toBe("comfyui")
		expect(wf.document).toContain('"lora_name": "{{lora_name}}"')
		expect(wf.document).toContain('"text": "{{prompt}}"')
		expect(wf.variables.find((v: any) => v.name === "lora_name")).toMatchObject({
			default: "pixel-art-xl.safetensors"
		})
		expect(wf.outputNode).toBe("9")
		expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 77 }))
	})

	test("refuses a UI save with the server's sentence, verbatim", async () => {
		const { target } = await render(JSON.stringify({ nodes: [], links: [] }))
		expect(target.querySelector("[data-fit-refusal]")?.textContent?.trim()).toBe(
			UI_FORMAT_REFUSAL
		)
		expect(asked.some((a) => a.event === "workflows:create")).toBe(false)
	})
})
