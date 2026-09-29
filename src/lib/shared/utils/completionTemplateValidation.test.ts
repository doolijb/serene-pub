/**
 * The rules a completion template is held to on save.
 *
 * Each of these is a hazard the design map named, turned into a refusal — and
 * each is asserted in BOTH directions, because a validator that refuses
 * everything passes any test that only checks refusals, and the shipped
 * built-ins are the strongest evidence that it does not.
 */
import { describe, it, expect } from "vitest"
import { validateCompletionTemplate } from "./completionTemplateValidation"
import { BUILTIN_COMPLETION_TEMPLATES } from "$lib/shared/constants/completionTemplates"

/** A template that passes, for varying one thing at a time. */
const ok = (over: Record<string, any> = {}) => ({
	key: "house-style",
	name: "House Style",
	renderMode: "flat",
	roles: {
		system: { prefix: "<<sys>>\n", suffix: "\n" },
		user: { prefix: "<<usr>>\n", suffix: "\n" },
		assistant: { prefix: "<<ast>>\n", suffix: "\n" },
		model: { prefix: "<<mdl>>\n", suffix: "\n" },
		tool: { prefix: "<<tool>>\n", suffix: "\n" },
		function: { prefix: "<<fn>>\n", suffix: "\n" }
	},
	fallbackRole: { prefix: "<<usr>>\n", suffix: "\n" },
	stopStrings: ["<<end>>"],
	isSelectable: true,
	...over
})

describe("validateCompletionTemplate", () => {
	it("accepts a well-formed template", () => {
		expect(validateCompletionTemplate(ok())).toBeNull()
	})

	it("accepts every FLAT template that ships", () => {
		// The strongest evidence that the rules are not merely strict: the eight
		// rows core seeds are the specification of what a template is, and seven
		// of them are flat. `split_chat` is the exception on purpose — it is
		// the one thing an admin may not author, and the rule below says so.
		for (const t of BUILTIN_COMPLETION_TEMPLATES) {
			const verdict = validateCompletionTemplate(t as any)
			if (t.renderMode === "flat") expect(verdict, t.key).toBeNull()
			else expect(verdict, t.key).toMatch(/cannot be set here/i)
		}
	})

	describe("the key", () => {
		it("is required — it is what a connection stores", () => {
			expect(validateCompletionTemplate(ok({ key: "" }))).toMatch(
				/needs a key/i
			)
			expect(validateCompletionTemplate(ok({ key: "   " }))).toMatch(
				/needs a key/i
			)
			expect(validateCompletionTemplate(ok({ key: null }))).toMatch(
				/needs a key/i
			)
		})
		it("is a lowercase slug", () => {
			for (const key of [
				"Has Spaces",
				"UPPER",
				"-leading-dash",
				"has/slash",
				"a".repeat(65)
			])
				expect(validateCompletionTemplate(ok({ key })), key).toMatch(
					/not a usable key/i
				)
		})
		it("accepts the shapes the shipped keys already take", () => {
			for (const key of ["vicuna", "llama2_inst", "split_chat", "x9"])
				expect(
					validateCompletionTemplate(ok({ key })),
					key
				).toBeNull()
		})
	})

	it("requires a name — the picker has to show something", () => {
		expect(validateCompletionTemplate(ok({ name: "" }))).toMatch(
			/needs a name/i
		)
		expect(validateCompletionTemplate(ok({ name: "  " }))).toMatch(
			/needs a name/i
		)
	})

	it("refuses role_array outright", () => {
		expect(
			validateCompletionTemplate(ok({ renderMode: "role_array" }))
		).toMatch(/cannot be set here/i)
		// And anything else that is not flat, rather than only the one name.
		expect(
			validateCompletionTemplate(ok({ renderMode: "something-else" }))
		).toMatch(/cannot be set here/i)
		// Absent is fine: the handler writes the column from a literal.
		expect(
			validateCompletionTemplate(ok({ renderMode: undefined }))
		).toBeNull()
	})

	describe("the reserved role-marker vocabulary", () => {
		const markers = [
			"<@role:user>",
			"<@role:assistant>",
			"<@role:system>"
		]
		it("is refused in an opening, a closing, and the fallback", () => {
			for (const m of markers) {
				expect(
					validateCompletionTemplate(
						ok({ roles: { system: { prefix: m, suffix: "\n" } } })
					),
					m
				).toMatch(/reserved role marker/i)
				expect(
					validateCompletionTemplate(
						ok({
							roles: {
								...ok().roles,
								user: { prefix: "<<u>>", suffix: `x${m}y` }
							}
						})
					),
					m
				).toMatch(/reserved role marker/i)
				expect(
					validateCompletionTemplate(
						ok({ fallbackRole: { prefix: m, suffix: "" } })
					),
					m
				).toMatch(/reserved role marker/i)
			}
		})
		it("does not refuse text that merely resembles one", () => {
			// The pattern is exact; a template using angle brackets and a colon
			// is a normal thing and must not be blocked.
			expect(
				validateCompletionTemplate(
					ok({
						roles: {
							system: { prefix: "<@role:tool>\n", suffix: "\n" }
						}
					})
				)
			).toBeNull()
			expect(
				validateCompletionTemplate(
					ok({
						roles: {
							system: { prefix: "<|im_start|>system\n", suffix: "" }
						}
					})
				)
			).toBeNull()
		})
	})

	describe("an opening for at least one role", () => {
		const noOpenings = {
			system: { prefix: "", suffix: "\n" },
			user: { prefix: "", suffix: "\n" },
			assistant: { prefix: "", suffix: "\n" },
			model: { prefix: "", suffix: "\n" },
			tool: { prefix: "", suffix: "\n" },
			function: { prefix: "", suffix: "\n" }
		}
		it("is required", () => {
			expect(
				validateCompletionTemplate(
					ok({
						roles: noOpenings,
						fallbackRole: { prefix: "", suffix: "\n" }
					})
				)
			).toMatch(/opens with nothing/i)
		})
		it("is satisfied by the fallback alone", () => {
			// A row that names no roles at all still opens, through the
			// fallback every unnamed role resolves to.
			expect(
				validateCompletionTemplate(
					ok({
						roles: {},
						fallbackRole: { prefix: "> ", suffix: "\n" }
					})
				)
			).toBeNull()
		})
		it("is satisfied by ONE role opening", () => {
			expect(
				validateCompletionTemplate(
					ok({
						roles: { ...noOpenings, system: { prefix: "S:", suffix: "" } },
						fallbackRole: { prefix: "", suffix: "" }
					})
				)
			).toBeNull()
		})
	})

	it("bounds the framing and the stop list", () => {
		expect(
			validateCompletionTemplate(
				ok({
					roles: {
						system: { prefix: "x".repeat(513), suffix: "" }
					}
				})
			)
		).toMatch(/longer than/i)
		expect(
			validateCompletionTemplate(ok({ stopStrings: "not a list" }))
		).toMatch(/list of strings/i)
		expect(
			validateCompletionTemplate(ok({ stopStrings: [1, 2] }))
		).toMatch(/list of strings/i)
		expect(
			validateCompletionTemplate(
				ok({ stopStrings: new Array(33).fill("x") })
			)
		).toMatch(/at most/i)
		// Absent and empty are both fine.
		expect(
			validateCompletionTemplate(ok({ stopStrings: undefined }))
		).toBeNull()
		expect(validateCompletionTemplate(ok({ stopStrings: [] }))).toBeNull()
	})
})
