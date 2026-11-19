/**
 * `haltExplanation`: the sentence a failed or halted run shows a person
 * (PLAN-less-confusing D4, 2026-10-11). It used to end `(at 'render')`, the
 * spec's internal name for the step; that stays on the receipt for the run
 * inspector and leaves the user-facing sentence.
 */
import { describe, expect, it } from "vitest"
import {
	ADMINISTRATOR_SUGGESTION,
	HALT_WITHOUT_REASON,
	haltExplanation,
	haltExplanationFor,
	haltedAtModelCall,
	receiptHaltFor,
	receiptPeopleSentence,
	haltStepShownTo,
	rejectedAtReview,
	REVIEW_REJECTED_REASON,
	type HaltSurface
} from "./haltExplanation"

describe("haltExplanation", () => {
	it("a run that finished has nothing to explain", () => {
		expect(haltExplanation({ outcome: "ok" })).toBeNull()
	})

	it("says the reason alone, never the step it stopped at", () => {
		const why =
			"No model is set for Images, and one is never picked automatically. An admin chooses it in Admin › Models › Loadouts."
		const said = haltExplanation({ outcome: "err", haltReason: why })
		expect(said).toBe(why)
		expect(said).not.toMatch(/\(at '/)
	})

	it("a halt reads the same way as an error", () => {
		expect(
			haltExplanation({ outcome: "halt", haltReason: "Rejected in review." })
		).toBe("Rejected in review.")
	})

	it("a stop with no reason gets a whole sentence, not an empty one", () => {
		expect(haltExplanation({ outcome: "err" })).toBe(HALT_WITHOUT_REASON)
		expect(haltExplanation({ outcome: "err", haltReason: "  " })).toBe(
			HALT_WITHOUT_REASON
		)
	})
})

describe("haltExplanationFor", () => {
	const said =
		"KoboldCPP API error at http://10.0.0.5:5001/api/v1/generate: model 'mistral-7b.Q4_K_M.gguf' not loaded (at 'respond.generate')"
	const plain: Record<HaltSurface, string> = {
		action: "The action could not finish.",
		summary: "The summary could not be written.",
		prompt: "The prompt could not be compiled.",
		reply: "The reply could not be generated.",
		routine: "A background routine could not run.",
		save: "Your message could not be saved. Your text was kept.",
		delete: "The message was not deleted."
	}
	const surfaces = Object.keys(plain) as HaltSurface[]

	it("an administrator reads the text unchanged", () => {
		for (const surface of surfaces) {
			expect(haltExplanationFor({ isAdmin: true }, surface, said)).toBe(
				said
			)
		}
	})

	it("anyone else reads the plain sentence and the suggestion, nothing of the reason", () => {
		const readers = [{ isAdmin: false }, {}, null, undefined]
		for (const reader of readers) {
			for (const surface of surfaces) {
				const text = haltExplanationFor(reader, surface, said)
				expect(text).toBe(
					`${plain[surface]} ${ADMINISTRATOR_SUGGESTION}`
				)
				expect(text).not.toContain("http://")
				expect(text).not.toContain(".gguf")
				expect(text).not.toContain("respond.generate")
			}
		}
	})

	it("the suggestion appears once in a non-administrator's text", () => {
		const text = haltExplanationFor(null, "action", said)
		expect(text.split(ADMINISTRATOR_SUGGESTION)).toHaveLength(2)
	})
})

describe("haltedAtModelCall", () => {
	type Rows = Parameters<typeof haltedAtModelCall>[0]["nodes"]
	const row = (
		nodeKey: string,
		kind: string,
		result: "ok" | "err" | "halt" | "cancelled",
		extra: Record<string, unknown> = {}
	) => ({ nodeKey, kind, result, seq: 0, definitionId: "x", ...extra })
	const receipt = (outcome: "err" | "halt", nodes: unknown[]) =>
		({ outcome, nodes }) as unknown as { outcome: typeof outcome; nodes: Rows }

	it("a run that finished is not a model-call failure", () => {
		expect(
			haltedAtModelCall({ outcome: "ok", nodes: [row("a", "oracle", "ok")] as Rows })
		).toBe(false)
	})

	it("an oracle that threw ended the run: yes", () => {
		expect(
			haltedAtModelCall(
				receipt("err", [row("assemble", "pure", "ok"), row("respond.generate", "oracle", "err")])
			)
		).toBe(true)
	})

	it("a review rejection, script halt or empty completion lands on the oracle as `halt`: no", () => {
		expect(
			haltedAtModelCall(
				receipt("halt", [row("respond.generate", "oracle", "halt")])
			)
		).toBe(false)
	})

	it("a write, form, assemble or review gate that refused: no", () => {
		for (const kind of ["effect", "pure", "gate", "form"]) {
			expect(
				haltedAtModelCall(
					receipt("err", [row("respond.generate", "oracle", "ok"), row("save", kind, "err")])
				)
			).toBe(false)
		}
	})

	it("an optional step that failed and recovered is not the halt: the later refusal decides", () => {
		const nodes = [
			row("embed", "oracle", "err", { recoveredAsEmpty: true }),
			row("save", "effect", "err")
		]
		expect(haltedAtModelCall(receipt("err", nodes))).toBe(false)
	})

	it("a recovered failure with nothing after it is not what halted the run", () => {
		expect(
			haltedAtModelCall(
				receipt("err", [row("embed", "oracle", "err", { recoveredAsEmpty: true })])
			)
		).toBe(false)
	})

	it("gather: chain 0 oracle err, chain 1 halts, run ended err: yes (the URL never leaks)", () => {
		expect(
			haltedAtModelCall(
				receipt("err", [
					row("a.generate", "oracle", "err"),
					row("b.check", "gate", "halt")
				])
			)
		).toBe(true)
	})

	it("gather: chain 0 halts with a refusal, chain 1 oracle err, run ended err: yes", () => {
		expect(
			haltedAtModelCall(
				receipt("err", [
					row("a.check", "gate", "halt"),
					row("b.generate", "oracle", "err")
				])
			)
		).toBe(true)
	})

	it("a run that ended halt is never plain, whatever an oracle row did elsewhere", () => {
		expect(
			haltedAtModelCall(
				receipt("halt", [
					row("a.generate", "oracle", "err"),
					row("b.check", "gate", "halt")
				])
			)
		).toBe(false)
	})

	it("a recovered oracle then a model call that threw: yes", () => {
		expect(
			haltedAtModelCall(
				receipt("err", [
					row("embed", "oracle", "err", { recoveredAsEmpty: true }),
					row("generate", "oracle", "err")
				])
			)
		).toBe(true)
	})
})

describe("receiptHaltFor", () => {
	const said =
		"KoboldCPP API error at http://10.0.0.5:5001/api/v1/generate: model 'mistral-7b.Q4_K_M.gguf' not loaded"
	const failed = {
		outcome: "err",
		nodes: [{ nodeKey: "respond.generate", kind: "oracle", result: "err" }]
	} as never
	const refused = {
		outcome: "err",
		nodes: [{ nodeKey: "save", kind: "effect", result: "err" }],
		meta: { peopleSentence: "Only the session's owner can change its rules." }
	} as never

	it("a non-administrator on a model-call failure reads the plain sentence and no step name", () => {
		for (const reader of [{ isAdmin: false }, null, undefined]) {
			const r = receiptHaltFor(reader, "reply", failed, said)
			expect(r).toBe(
				`The reply could not be generated. ${ADMINISTRATOR_SUGGESTION}`
			)
		}
	})

	it("an administrator reads the reason", () => {
		expect(receiptHaltFor({ isAdmin: true }, "reply", failed, said)).toBe(said)
	})

	it("a halt marked for people keeps its text for everyone", () => {
		const refusal = "Only the session's owner can change its rules."
		for (const reader of [{ isAdmin: true }, { isAdmin: false }, null]) {
			expect(receiptHaltFor(reader, "action", refused, refusal)).toBe(refusal)
		}
	})
})

describe("receiptHaltFor: the people sentence", () => {
	const owner = { isAdmin: false }
	const guest = { isAdmin: false }
	const admin = { isAdmin: true }
	const readers = [owner, guest, admin]
	const wiring =
		"assemble: no published version of 'core:spec/x' (a step the spec names)"
	const plainAction = `The action could not finish. ${ADMINISTRATOR_SUGGESTION}`
	const base = { nodes: [{ nodeKey: "assemble", kind: "effect", result: "halt" }] }

	it("an unstamped wiring halt: plain for a non-administrator, the reason for an administrator", () => {
		const r = { ...base, outcome: "halt", haltReason: wiring } as never
		expect(receiptHaltFor(owner, "action", r, wiring)).toBe(plainAction)
		expect(receiptHaltFor(guest, "action", r, wiring)).toBe(plainAction)
		expect(receiptHaltFor(admin, "action", r, wiring)).toBe(wiring)
	})

	it("a stamped receipt reads its sentence for every reader", () => {
		const sentence = "Only the session's owner can change its rules."
		for (const outcome of ["halt", "err"]) {
			const r = {
				...base,
				outcome,
				haltReason: sentence,
				meta: { peopleSentence: sentence }
			} as never
			for (const reader of readers)
				expect(receiptHaltFor(reader, "action", r, "x")).toBe(sentence)
		}
	})

	it("a review rejection reads the review sentence for every reader, compacted or not", () => {
		const full = {
			...base,
			outcome: "halt",
			haltReason: REVIEW_REJECTED_REASON,
			reviews: [{ action: "reject" }]
		} as never
		const compacted = {
			outcome: "halt",
			nodes: [],
			haltReason: "rejected at review"
		} as never
		for (const r of [full, compacted])
			for (const reader of readers)
				expect(receiptHaltFor(reader, "reply", r, "z")).toBe(
					REVIEW_REJECTED_REASON
				)
	})

	it("a receipt stored without a stamp reads as detail", () => {
		const r = {
			...base,
			outcome: "err",
			haltReason: "That name is taken by another seat."
		} as never
		expect(receiptHaltFor(guest, "action", r, "That name is taken by another seat.")).toBe(
			plainAction
		)
		expect(receiptHaltFor(admin, "action", r, "That name is taken by another seat.")).toBe(
			"That name is taken by another seat."
		)
	})

	it("a model-call failure: plain for a non-administrator, the reason for an administrator", () => {
		const r = {
			outcome: "err",
			nodes: [{ nodeKey: "respond.generate", kind: "oracle", result: "err" }]
		} as never
		expect(receiptHaltFor(owner, "reply", r, "http://10.0.0.5")).toBe(
			`The reply could not be generated. ${ADMINISTRATOR_SUGGESTION}`
		)
		expect(receiptHaltFor(admin, "reply", r, "http://10.0.0.5")).toBe(
			"http://10.0.0.5"
		)
	})

	it("an empty stamp is not a people sentence", () => {
		const r = { outcome: "err", nodes: [], meta: { peopleSentence: "" } } as never
		expect(receiptPeopleSentence(r)).toBeUndefined()
	})

	it("rejectedAtReview needs a halt", () => {
		expect(
			rejectedAtReview({ outcome: "err", reviews: [{ action: "reject" }] })
		).toBe(false)
		expect(rejectedAtReview({ outcome: "halt", reviews: [{ action: "approve" }] })).toBe(false)
	})

	it("only an administrator is sent the step, and a people sentence names no step", () => {
		const plainHalt = { outcome: "halt", nodes: [], haltReason: wiring } as never
		const stamped = {
			outcome: "halt",
			nodes: [],
			haltReason: "s",
			meta: { peopleSentence: "s" }
		} as never
		const rejected = {
			outcome: "halt",
			nodes: [],
			reviews: [{ action: "reject" }]
		} as never
		expect(haltStepShownTo(admin, plainHalt)).toBe(true)
		expect(haltStepShownTo(owner, plainHalt)).toBe(false)
		expect(haltStepShownTo(null, plainHalt)).toBe(false)
		expect(haltStepShownTo(admin, stamped)).toBe(false)
		expect(haltStepShownTo(admin, rejected)).toBe(false)
	})
})
