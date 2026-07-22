import { describe, expect, test } from "vitest"
import { PromptBlockFormatter } from "./PromptBlockFormatter"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"

const roles = ["system", "user", "assistant"] as const

describe("PromptBlockFormatter.makeBlock", () => {
	describe("chatml", () => {
		for (const role of roles) {
			test(`role=${role}`, () => {
				expect(
					PromptBlockFormatter.makeBlock({
						format: PromptFormats.CHATML,
						role,
						content: "hello"
					})
				).toBe(`<|im_start|>${role}\nhello<|im_end|>\n`)
			})
		}

		test("includeClose: false omits the close tag", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.CHATML,
					role: "user",
					content: "hello",
					includeClose: false
				})
			).toBe("<|im_start|>user\nhello")
		})
	})

	describe("basic", () => {
		for (const role of roles) {
			test(`role=${role}`, () => {
				expect(
					PromptBlockFormatter.makeBlock({
						format: PromptFormats.BASIC,
						role,
						content: "hello"
					})
				).toBe(`*** ${role}\nhello\n\n`)
			})
		}

		test("includeClose: false omits the close tag", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.BASIC,
					role: "user",
					content: "hello",
					includeClose: false
				})
			).toBe("*** user\nhello")
		})
	})

	describe("vicuna", () => {
		test("role=system capitalizes to 'System:'", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.VICUNA,
					role: "system",
					content: "hello"
				})
			).toBe("### System:\nhello\n")
		})
		test("role=user capitalizes to 'User:'", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.VICUNA,
					role: "user",
					content: "hello"
				})
			).toBe("### User:\nhello\n")
		})
		test("role=assistant capitalizes to 'Assistant:'", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.VICUNA,
					role: "assistant",
					content: "hello"
				})
			).toBe("### Assistant:\nhello\n")
		})

		test("includeClose: false omits the close tag", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.VICUNA,
					role: "user",
					content: "hello",
					includeClose: false
				})
			).toBe("### User:\nhello")
		})
	})

	describe("openai", () => {
		for (const role of roles) {
			test(`role=${role}`, () => {
				expect(
					PromptBlockFormatter.makeBlock({
						format: PromptFormats.OPENAI,
						role,
						content: "hello"
					})
				).toBe(`<|${role}|>\nhello\n`)
			})
		}

		test("includeClose: false omits the close tag", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.OPENAI,
					role: "user",
					content: "hello",
					includeClose: false
				})
			).toBe("<|user|>\nhello")
		})
	})

	describe("llama2_inst", () => {
		test("role=system uses the <<SYS>> wrapper and the fixed close (real Llama-2 template: ' [/INST]</s>\\n', no stray '>')", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.LLAMA2_INST,
					role: "system",
					content: "hello"
				})
			).toBe("<s>[INST] <<SYS>>\nhello\n<</SYS>> [/INST]</s>\n")
		})
		test("role=user opens with a bare <s> and closes with </s>", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.LLAMA2_INST,
					role: "user",
					content: "hello"
				})
			).toBe("<s>\nhello\n</s>\n")
		})
		test("role=assistant opens with a bare <s> and closes with </s>", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.LLAMA2_INST,
					role: "assistant",
					content: "hello"
				})
			).toBe("<s>\nhello\n</s>\n")
		})
		test("an unrecognized role falls back to the default open/close pair", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.LLAMA2_INST,
					role: "tool" as any,
					content: "hello"
				})
			).toBe("<s>[INST] hello [/INST]</s>\n")
		})

		test("includeClose: false omits the close tag", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.LLAMA2_INST,
					role: "system",
					content: "hello",
					includeClose: false
				})
			).toBe("<s>[INST] <<SYS>>\nhello")
		})

		test("LLAMA2_INST_CLOSE constant is the real Llama-2 close template, no stray '>' before </s>", () => {
			expect(PromptBlockFormatter.LLAMA2_INST_CLOSE).toBe(
				" [/INST]</s>\n"
			)
		})
	})

	describe("claude", () => {
		test("role=user opens with 'Human: '", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.CLAUDE,
					role: "user",
					content: "hello"
				})
			).toBe("Human: hello\n")
		})
		test("role=assistant opens with the close-token 'Assistant: ' string", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.CLAUDE,
					role: "assistant",
					content: "hello"
				})
			).toBe("\nAssistant: hello\n")
		})
		test("role=system also falls back to the 'Assistant: ' open (non-user role)", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.CLAUDE,
					role: "system",
					content: "hello"
				})
			).toBe("\nAssistant: hello\n")
		})

		test("includeClose: false omits the trailing newline", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.CLAUDE,
					role: "user",
					content: "hello",
					includeClose: false
				})
			).toBe("Human: hello")
		})
	})

	describe("instruct", () => {
		for (const role of roles) {
			test(`role=${role} (role does not affect instruct format's fixed markers)`, () => {
				expect(
					PromptBlockFormatter.makeBlock({
						format: PromptFormats.INSTRUCT,
						role,
						content: "hello"
					})
				).toBe("### Instruction:\nhello\n### Response:\n")
			})
		}

		test("includeClose: false omits the close tag", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.INSTRUCT,
					role: "user",
					content: "hello",
					includeClose: false
				})
			).toBe("### Instruction:\nhello")
		})
	})

	describe("split_chat", () => {
		for (const role of roles) {
			test(`role=${role}`, () => {
				expect(
					PromptBlockFormatter.makeBlock({
						format: PromptFormats.SPLIT_CHAT,
						role,
						content: "hello"
					})
				).toBe(`<@role:${role}>\nhello\n`)
			})
		}

		test("includeClose has no effect on split_chat's fixed markup", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.SPLIT_CHAT,
					role: "user",
					content: "hello",
					includeClose: false
				})
			).toBe("<@role:user>\nhello\n")
		})
	})

	describe("unknown format", () => {
		test("falls back to chatml behavior", () => {
			expect(
				PromptBlockFormatter.makeBlock({
					format: "not-a-real-format",
					role: "user",
					content: "hello"
				})
			).toBe("<|im_start|>user\nhello<|im_end|>\n")
		})
	})
})
