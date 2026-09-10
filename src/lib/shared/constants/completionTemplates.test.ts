/**
 * The templates ARE the old switch — recorded, not re-derived.
 *
 * ## What this file is for
 *
 * `PromptBlockFormatter` used to be a nine-arm `switch (format)` with eight
 * helper methods behind it, three of which computed a role label
 * (`` `### ${_.capitalize(role)}:\n` ``). Replacing that with a table of literal
 * prefixes and suffixes is only safe if the literals are the SAME BYTES the
 * computation produced, for every role, and "every role" is six — `BlockRole`
 * names `model`, `tool` and `function` too, and `BaseConnectionAdapter` maps
 * over an untyped `any[]` of messages to reach this.
 *
 * The byte-exact per-role cases in `PromptBlockFormatter.test.ts` cover three
 * roles across the seven selectable formats. This covers all six roles, both
 * `includeClose` values and all eight formats — 96 combinations — and every
 * expectation in EXPECTED below was HARVESTED FROM THE OLD SWITCH by running it
 * before it was deleted, not typed out from reading the new data. Typing them
 * from the new table would make this a test that the table equals itself.
 *
 * ## What is deliberately NOT identical
 *
 * A format naming no template — `""`, `"tekken"`, `"not-a-real-format"` — used
 * to render ChatML via the `default:` arm and now renders the default template.
 * That is the resolved half of a disagreement the codebase was carrying in two
 * tested places at once; the reasoning is in `PromptBlockFormatter.test.ts`
 * under "a format that names no template". It is asserted here as a change
 * rather than left to be discovered.
 */

import { describe, expect, it } from "vitest"
import { PromptBlockFormatter } from "$lib/shared/utils/PromptBlockFormatter"
import { composeStops } from "$lib/server/connections/stops"
import { PromptFormats } from "./PromptFormats"
import {
	BLOCK_ROLES,
	BUILTIN_COMPLETION_TEMPLATES,
	completionTemplateOf,
	DEFAULT_COMPLETION_TEMPLATE_KEY,
	type BlockRole
} from "./completionTemplates"

/** `[withClose, withoutClose]`, as the old switch produced them for "hello". */
const EXPECTED: Record<string, Record<string, [string, string]>> = {
	vicuna: {
		system: ["### System:\nhello\n", "### System:\nhello"],
		user: ["### User:\nhello\n", "### User:\nhello"],
		assistant: ["### Assistant:\nhello\n", "### Assistant:\nhello"],
		model: ["### Model:\nhello\n", "### Model:\nhello"],
		tool: ["### Tool:\nhello\n", "### Tool:\nhello"],
		function: ["### Function:\nhello\n", "### Function:\nhello"]
	},
	chatml: {
		system: [
			"<|im_start|>system\nhello<|im_end|>\n",
			"<|im_start|>system\nhello"
		],
		user: [
			"<|im_start|>user\nhello<|im_end|>\n",
			"<|im_start|>user\nhello"
		],
		assistant: [
			"<|im_start|>assistant\nhello<|im_end|>\n",
			"<|im_start|>assistant\nhello"
		],
		model: [
			"<|im_start|>model\nhello<|im_end|>\n",
			"<|im_start|>model\nhello"
		],
		tool: [
			"<|im_start|>tool\nhello<|im_end|>\n",
			"<|im_start|>tool\nhello"
		],
		function: [
			"<|im_start|>function\nhello<|im_end|>\n",
			"<|im_start|>function\nhello"
		]
	},
	basic: {
		system: ["*** system\nhello\n\n", "*** system\nhello"],
		user: ["*** user\nhello\n\n", "*** user\nhello"],
		assistant: ["*** assistant\nhello\n\n", "*** assistant\nhello"],
		model: ["*** model\nhello\n\n", "*** model\nhello"],
		tool: ["*** tool\nhello\n\n", "*** tool\nhello"],
		function: ["*** function\nhello\n\n", "*** function\nhello"]
	},
	openai: {
		system: ["<|system|>\nhello\n", "<|system|>\nhello"],
		user: ["<|user|>\nhello\n", "<|user|>\nhello"],
		assistant: ["<|assistant|>\nhello\n", "<|assistant|>\nhello"],
		model: ["<|model|>\nhello\n", "<|model|>\nhello"],
		tool: ["<|tool|>\nhello\n", "<|tool|>\nhello"],
		function: ["<|function|>\nhello\n", "<|function|>\nhello"]
	},
	llama2_inst: {
		system: [
			"<s>[INST] <<SYS>>\nhello\n<</SYS>> [/INST]</s>\n",
			"<s>[INST] <<SYS>>\nhello"
		],
		user: ["<s>\nhello\n</s>\n", "<s>\nhello"],
		assistant: ["<s>\nhello\n</s>\n", "<s>\nhello"],
		model: ["<s>[INST] hello [/INST]</s>\n", "<s>[INST] hello"],
		tool: ["<s>[INST] hello [/INST]</s>\n", "<s>[INST] hello"],
		function: ["<s>[INST] hello [/INST]</s>\n", "<s>[INST] hello"]
	},
	claude: {
		system: ["\nAssistant: hello\n", "\nAssistant: hello"],
		user: ["Human: hello\n", "Human: hello"],
		assistant: ["\nAssistant: hello\n", "\nAssistant: hello"],
		model: ["\nAssistant: hello\n", "\nAssistant: hello"],
		tool: ["\nAssistant: hello\n", "\nAssistant: hello"],
		function: ["\nAssistant: hello\n", "\nAssistant: hello"]
	},
	instruct: {
		system: [
			"### Instruction:\nhello\n### Response:\n",
			"### Instruction:\nhello"
		],
		user: [
			"### Instruction:\nhello\n### Response:\n",
			"### Instruction:\nhello"
		],
		assistant: [
			"### Instruction:\nhello\n### Response:\n",
			"### Instruction:\nhello"
		],
		model: [
			"### Instruction:\nhello\n### Response:\n",
			"### Instruction:\nhello"
		],
		tool: [
			"### Instruction:\nhello\n### Response:\n",
			"### Instruction:\nhello"
		],
		function: [
			"### Instruction:\nhello\n### Response:\n",
			"### Instruction:\nhello"
		]
	},
	split_session: {
		system: ["<@role:system>\nhello\n", "<@role:system>\nhello\n"],
		user: ["<@role:user>\nhello\n", "<@role:user>\nhello\n"],
		assistant: ["<@role:assistant>\nhello\n", "<@role:assistant>\nhello\n"],
		model: ["<@role:model>\nhello\n", "<@role:model>\nhello\n"],
		tool: ["<@role:tool>\nhello\n", "<@role:tool>\nhello\n"],
		function: ["<@role:function>\nhello\n", "<@role:function>\nhello\n"]
	}
}

const EXPECTED_STOPS: Record<string, string[]> = {
	vicuna: [
		"</s>",
		"system:",
		"System:",
		"user:",
		"User:",
		"assistant:",
		"Assistant:"
	],
	chatml: ["<|im_start|>", "<|im_end|>"],
	basic: ["system:", "System:", "user:", "User:", "assistant:", "Assistant:"],
	openai: [
		"system:",
		"System:",
		"user:",
		"User:",
		"assistant:",
		"Assistant:"
	],
	llama2_inst: ["</s>", "User:", "Assistant:", "System:"],
	claude: [
		"system:",
		"System:",
		"user:",
		"User:",
		"assistant:",
		"Assistant:"
	],
	instruct: [
		"system:",
		"System:",
		"user:",
		"User:",
		"assistant:",
		"Assistant:"
	],
	split_session: [
		"system:",
		"System:",
		"user:",
		"User:",
		"assistant:",
		"Assistant:"
	]
}

describe("every built-in renders exactly what the switch rendered", () => {
	for (const [format, byRole] of Object.entries(EXPECTED)) {
		describe(format, () => {
			for (const [role, [withClose, withoutClose]] of Object.entries(
				byRole
			)) {
				it(`role=${role}`, () => {
					expect(
						PromptBlockFormatter.makeBlock({
							format,
							role: role as BlockRole,
							content: "hello"
						})
					).toBe(withClose)
					expect(
						PromptBlockFormatter.makeBlock({
							format,
							role: role as BlockRole,
							content: "hello",
							includeClose: false
						})
					).toBe(withoutClose)
				})
			}
		})
	}

	it("covers every role the type declares", () => {
		// So that adding a role to `BlockRole` without extending the templates
		// fails here rather than in someone's prompt.
		for (const format of Object.keys(EXPECTED))
			expect(Object.keys(EXPECTED[format]).sort()).toEqual(
				[...BLOCK_ROLES].sort()
			)
	})

	it("covers every built-in", () => {
		expect(Object.keys(EXPECTED).sort()).toEqual(
			BUILTIN_COMPLETION_TEMPLATES.map((t) => t.key).sort()
		)
	})
})

/**
 * The composer, asked the one question this file is about: what does a FORMAT
 * stop on?
 *
 * ⚠ `StopStrings.get` used to answer this and returned a flat `string[]`. Since
 * the ruling of 2026-09-10 there is one composer (`connections/stops.ts`), every
 * entry carries the kind it came from, and the wire rule decides where it goes —
 * so the completion wire is stated here, because a completion template's stop
 * strings are meaningless on the other one and are held back there by design.
 * The VALUES these cases pin are unchanged.
 */
const formatStops = (format: any, over: Record<string, any> = {}) =>
	composeStops({
		template: format,
		characters: [],
		personas: [],
		currentCharacterId: null,
		explicit: [],
		wire: "completion",
		...over
	}).sent.map((s) => s.value)

describe("stop strings come off the row and keep their old values", () => {
	for (const [format, expected] of Object.entries(EXPECTED_STOPS)) {
		it(format, () => {
			expect(formatStops(format)).toEqual(expected)
		})
	}

	it("covers all eight, which the switch it replaced did not", () => {
		// ⚠ The old switch had five arms. Claude, Instruct and split-session
		// reached the generic list through `default:` — the same bytes, but by
		// accident, and nothing made adding a format add its stop strings.
		// Every template now carries its own, so the question cannot go
		// unanswered for a format that ships later.
		expect(Object.keys(EXPECTED_STOPS).length).toBe(8)
		for (const t of BUILTIN_COMPLETION_TEMPLATES)
			expect(t.stopStrings.length).toBeGreaterThan(0)
	})

	it("does not hand a caller the template's own array to mutate", () => {
		// The composer puts character and persona names in the same list as the
		// template's. Building that list on top of the row's own array would
		// append every session's cast to the built-in, permanently, for every
		// later caller in the process.
		const before = [...completionTemplateOf("vicuna").stopStrings]
		formatStops("vicuna", {
			characters: [{ id: 1, name: "Aria" } as any]
		})
		expect(completionTemplateOf("vicuna").stopStrings).toEqual(before)
	})
})

describe("the three states that mean 'no template'", () => {
	/**
	 * Absent, cleared and unresolved. The third is new with the table — a key
	 * whose row is gone — and the reason all three answer alike is that they are
	 * one question. Answering them differently is what produced a prompt wrapped
	 * in Vicuna markers and stopped on ChatML's.
	 */
	for (const [label, value] of [
		["absent (null)", null],
		["absent (undefined)", undefined],
		["cleared (empty string)", ""],
		["unresolved (a key with no row)", "a-template-that-was-deleted"],
		["unresolved (the dead tekken arm)", PromptFormats.TEKKEN]
	] as const) {
		it(`${label} resolves to the default template`, () => {
			expect(completionTemplateOf(value).key).toBe(
				DEFAULT_COMPLETION_TEMPLATE_KEY
			)
		})
	}

	it("renders and stops as the default, in agreement", () => {
		// The pairing that used to disagree, stated end to end.
		expect(
			PromptBlockFormatter.makeBlock({
				format: "",
				role: "user",
				content: "hello"
			})
		).toBe(EXPECTED[DEFAULT_COMPLETION_TEMPLATE_KEY].user[0])
		expect(formatStops("")).toEqual(
			EXPECTED_STOPS[DEFAULT_COMPLETION_TEMPLATE_KEY]
		)
	})

	it("takes a resolved row as readily as a key", () => {
		// The seam the admin lane needs: a caller holding a `completion_templates`
		// row renders from it without a round trip through its key.
		const row = completionTemplateOf(PromptFormats.CHATML)
		expect(
			PromptBlockFormatter.makeBlock({
				format: row,
				role: "user",
				content: "hello"
			})
		).toBe(EXPECTED.chatml.user[0])
	})
})

describe("split_session is referenceable, not authorable", () => {
	const split = completionTemplateOf(PromptFormats.SPLIT_CHAT)

	it("is the only role_array template, and it is not selectable", () => {
		const roleArray = BUILTIN_COMPLETION_TEMPLATES.filter(
			(t) => t.renderMode === "role_array"
		)
		expect(roleArray.map((t) => t.key)).toEqual([PromptFormats.SPLIT_CHAT])
		expect(split.isSelectable).toBe(false)
		// Every other one is selectable and flat.
		for (const t of BUILTIN_COMPLETION_TEMPLATES)
			if (t.key !== PromptFormats.SPLIT_CHAT) {
				expect(t.renderMode).toBe("flat")
				expect(t.isSelectable).toBe(true)
			}
	})

	it("carries NO framing, so no row can define its markers", () => {
		/**
		 * ⚠ This is the security property, not a tidiness one.
		 *
		 * The emitted `<@role:user>` marker, `ROLE_MARKER_PATTERN` and
		 * `parseSplitChatPrompt` are a three-way correspondence maintained by
		 * hand — that is what the neutralisation guard rests on. If the emitter
		 * read its markers from these fields, an admin editing the row would
		 * define markers the neutraliser does not know about, and a literal
		 * `<@role:system>` in a chat message or lore entry would parse as a real
		 * system message again (on Anthropic, promoted into the top-level system
		 * prompt). Empty rather than a copy of the real markers, because a copy
		 * is a second place for them to live.
		 */
		for (const role of BLOCK_ROLES) {
			expect(split.roles[role].prefix).toBe("")
			expect(split.roles[role].suffix).toBe("")
		}
		expect(split.fallbackRole).toEqual({ prefix: "", suffix: "" })
	})

	it("emits its markers regardless, because the emitter is not data-driven", () => {
		// The proof that the empty framing above is not merely unused but
		// unreachable: rendering through it produces the real markers.
		for (const role of BLOCK_ROLES)
			expect(
				PromptBlockFormatter.makeBlock({
					format: PromptFormats.SPLIT_CHAT,
					role,
					content: "hello"
				})
			).toBe(`<@role:${role}>\nhello\n`)
	})

	it("is chosen by renderMode, never by its name containing 'split'", () => {
		// ⚠ `prompt/assemble.ts` decided this with `/split/i.test(name)`. A
		// template someone calls "my split format" must render FLAT.
		for (const name of ["split", "SPLITTY", "my split format", "Splitwise"])
			expect(completionTemplateOf(name).renderMode).toBe("flat")
	})
})

describe("the picker offers exactly the selectable templates", () => {
	it("matches PromptFormats.options, key and label", () => {
		// Two lists, and nothing at runtime compares them — a format added to
		// one and not the other is either invisible in the UI or offered and
		// unrenderable.
		expect(PromptFormats.options).toEqual(
			BUILTIN_COMPLETION_TEMPLATES.filter((t) => t.isSelectable).map(
				(t) => ({ value: t.key, label: t.name })
			)
		)
	})

	it("does not offer tekken, which is not expressible as a template", () => {
		// `tekkenBlock` takes a whole conversation, not one block. The
		// commented-out entries that used to sit in `keys` and `options` are
		// deleted; this pins that they stay gone rather than being uncommented
		// into a picker where selecting one renders something else entirely.
		expect(PromptFormats.keys).not.toContain(PromptFormats.TEKKEN)
		expect(PromptFormats.options.map((o) => o.value)).not.toContain(
			PromptFormats.TEKKEN
		)
		expect(BUILTIN_COMPLETION_TEMPLATES.map((t) => t.key)).not.toContain(
			PromptFormats.TEKKEN
		)
	})
})
