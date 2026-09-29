import { PromptFormats } from "./PromptFormats"

/**
 * A completion template as DATA — the shape a `completion_templates` row takes
 * once it reaches the renderer, and the shape the built-ins are authored in.
 *
 * ## Why data and not code
 *
 * These are admin-authorable. A template that can *compute* is a template that
 * can be made to do something other than format, so the whole expressible set
 * is closed: a fixed prefix and a fixed suffix per role, a fallback pair, a
 * list of stop strings, and two booleans. There is no interpolation, no
 * escape hatch and no callback — the renderer is a concatenation.
 *
 * That closure is what makes `renderMode: "role_array"` safe to keep in the
 * same table as everything else (see `PromptBlockFormatter`): the ONE template
 * that emits parseable role markers emits them from hand-written code that no
 * row can influence, and every other template is structurally incapable of
 * producing one.
 */
export type RenderMode = "flat" | "role_array"

/** Every role a block can be emitted for. Kept in step with `BlockRole`. */
export const BLOCK_ROLES = [
	"system",
	"user",
	"assistant",
	"model",
	"tool",
	"function"
] as const

export type BlockRole = (typeof BLOCK_ROLES)[number]

export interface RoleFraming {
	prefix: string
	suffix: string
}

export interface CompletionTemplate {
	/**
	 * The stable identifier `connections.prompt_format` holds and the foreign
	 * key targets. Distinct from `seedKey`, which is NULL on every row a user
	 * made — a user's template still has to be referenceable by a connection,
	 * so the reference cannot ride on the seed identity.
	 */
	key: string
	name: string
	/**
	 * `flat` renders one completion string. `role_array` is the legacy
	 * split-chat bridge and is NOT admin-authorable — see `isSelectable`
	 * and the emitter in `PromptBlockFormatter`.
	 *
	 * ⚠ This column exists because the decision used to be
	 * `/split/i.test(promptFormat)`, a SUBSTRING test: a template named
	 * "Splitwise" or "my split format" silently switched the entire pipeline to
	 * role-array output, returning `rendered: undefined` and running the
	 * role-marker parser over a string that has no markers in it.
	 */
	renderMode: RenderMode
	/**
	 * What wraps a block, per role. Exhaustive over `BlockRole` so that the
	 * renderer never has to compute a label — the four role-templated formats
	 * (Vicuna, ChatML, Basic, OpenAI) have their six variants written out
	 * rather than derived, which is what lets the whole switch be data.
	 */
	roles: Record<BlockRole, RoleFraming>
	/**
	 * Used only for a role string outside `BlockRole`. Reachable solely through
	 * an untyped caller (`BaseConnectionAdapter` maps over `any[]` messages);
	 * every role the app actually emits is one of the six above.
	 */
	fallbackRole: RoleFraming
	/**
	 * A format's stop strings are a property OF THE FORMAT, so they live on the
	 * same row rather than in a second switch. The old `StopStrings` switch
	 * covered five of eight formats and let Claude, Instruct and split fall
	 * through to the generic list without saying so.
	 */
	stopStrings: string[]
	/** Whether a connection's format picker may offer it. */
	isSelectable: boolean
}

// ── The built-in markers ──────────────────────────────────────────────────
//
// Declared here rather than in `PromptBlockFormatter` so that the seed data and
// the renderer read the same bytes. `PromptBlockFormatter` re-exports them as
// static fields for the callers (and tests) that name them.

export const CHATML_OPEN = "<|im_start|>"
export const CHATML_CLOSE = "<|im_end|>\n"
export const BASIC_OPEN = "*** "
export const BASIC_CLOSE = "\n\n"
export const VICUNA_OPEN = "### "
export const VICUNA_CLOSE = "\n"
export const OPENAI_OPEN = "<|"
export const OPENAI_CLOSE = "\n"
export const LLAMA2_INST_OPEN = "<s>[INST] "
export const LLAMA2_INST_CLOSE = " [/INST]</s>\n"
export const CLAUDE_OPEN = "Human: "
export const CLAUDE_CLOSE = "\nAssistant: "
export const INSTRUCT_OPEN = "### Instruction:\n"
export const INSTRUCT_CLOSE = "\n### Response:\n"

/** `### User:\n` — Vicuna's one derived label, resolved at authoring time. */
const capitalize = (role: string) =>
	role.charAt(0).toUpperCase() + role.slice(1)

/** Same framing for every role, for the formats that ignore the role. */
const uniformRoles = (framing: RoleFraming): Record<BlockRole, RoleFraming> =>
	Object.fromEntries(BLOCK_ROLES.map((r) => [r, framing])) as Record<
		BlockRole,
		RoleFraming
	>

/** One framing per role, built from the role token the format interpolates. */
const perRole = (
	build: (role: BlockRole) => RoleFraming
): Record<BlockRole, RoleFraming> =>
	Object.fromEntries(BLOCK_ROLES.map((r) => [r, build(r)])) as Record<
		BlockRole,
		RoleFraming
	>

/**
 * The generic stop list — names in "Speaker:" shape, which is what most flat
 * formats leak when a model keeps writing past its turn.
 */
const SPEAKER_STOPS = [
	"system:",
	"System:",
	"user:",
	"User:",
	"assistant:",
	"Assistant:"
]

/**
 * The templates that ship, in picker order.
 *
 * ⚠ This is the SEED SOURCE. `db/defaults.ts` writes these rows on every boot
 * with `set({ ...data, id: undefined })`, which re-applies the full contents of
 * each one — safe only because every row here is `isImmutable`, and immutable
 * rows are refused server-side. A mutable seeded row would have a user's edits
 * reverted on every restart with nothing to catch it.
 */
export const BUILTIN_COMPLETION_TEMPLATES: readonly CompletionTemplate[] = [
	{
		key: PromptFormats.VICUNA,
		name: "Vicuna (Default)",
		renderMode: "flat",
		roles: perRole((role) => ({
			prefix: `${VICUNA_OPEN}${capitalize(role)}:\n`,
			suffix: VICUNA_CLOSE
		})),
		fallbackRole: { prefix: `${VICUNA_OPEN}User:\n`, suffix: VICUNA_CLOSE },
		// `</s>` leads: Vicuna finetunes are overwhelmingly Llama-family and
		// emit it, and it is the only one of these that is a real token rather
		// than a line a model might legitimately write.
		stopStrings: ["</s>", ...SPEAKER_STOPS],
		isSelectable: true
	},
	{
		key: PromptFormats.CHATML,
		name: "ChatML",
		renderMode: "flat",
		roles: perRole((role) => ({
			prefix: `${CHATML_OPEN}${role}\n`,
			suffix: CHATML_CLOSE
		})),
		fallbackRole: {
			prefix: `${CHATML_OPEN}user\n`,
			suffix: CHATML_CLOSE
		},
		stopStrings: [CHATML_OPEN, "<|im_end|>"],
		isSelectable: true
	},
	{
		key: PromptFormats.BASIC,
		name: "Basic / Legacy",
		renderMode: "flat",
		roles: perRole((role) => ({
			prefix: `${BASIC_OPEN}${role}\n`,
			suffix: BASIC_CLOSE
		})),
		fallbackRole: { prefix: `${BASIC_OPEN}user\n`, suffix: BASIC_CLOSE },
		stopStrings: [...SPEAKER_STOPS],
		isSelectable: true
	},
	{
		key: PromptFormats.OPENAI,
		name: "OpenAI",
		renderMode: "flat",
		roles: perRole((role) => ({
			prefix: `${OPENAI_OPEN}${role}|>\n`,
			suffix: OPENAI_CLOSE
		})),
		fallbackRole: {
			prefix: `${OPENAI_OPEN}user|>\n`,
			suffix: OPENAI_CLOSE
		},
		stopStrings: [...SPEAKER_STOPS],
		isSelectable: true
	},
	{
		key: PromptFormats.LLAMA2_INST,
		name: "LLaMA2/Mistral Instruct",
		renderMode: "flat",
		roles: {
			system: {
				prefix: "<s>[INST] <<SYS>>\n",
				suffix: "\n<</SYS>> [/INST]</s>\n"
			},
			user: { prefix: "<s>\n", suffix: "\n</s>\n" },
			assistant: { prefix: "<s>\n", suffix: "\n</s>\n" },
			// The three roles the old `llama2InstOpen` switch did not name fell
			// through to the bare `[INST]` pair; written out here so the
			// fall-through is visible rather than implied.
			model: { prefix: LLAMA2_INST_OPEN, suffix: LLAMA2_INST_CLOSE },
			tool: { prefix: LLAMA2_INST_OPEN, suffix: LLAMA2_INST_CLOSE },
			function: { prefix: LLAMA2_INST_OPEN, suffix: LLAMA2_INST_CLOSE }
		},
		fallbackRole: {
			prefix: LLAMA2_INST_OPEN,
			suffix: LLAMA2_INST_CLOSE
		},
		stopStrings: ["</s>", "User:", "Assistant:", "System:"],
		isSelectable: true
	},
	{
		key: PromptFormats.CLAUDE,
		name: "Claude (Human/Assistant)",
		renderMode: "flat",
		roles: {
			user: { prefix: CLAUDE_OPEN, suffix: "\n" },
			// Every non-user role opens with the "\nAssistant: " string. That
			// reads oddly and is deliberate: it is what the old
			// `claudeOpen(role)` ternary did, and `PromptBlockFormatter.test.ts`
			// pins it for `system` by name.
			system: { prefix: CLAUDE_CLOSE, suffix: "\n" },
			assistant: { prefix: CLAUDE_CLOSE, suffix: "\n" },
			model: { prefix: CLAUDE_CLOSE, suffix: "\n" },
			tool: { prefix: CLAUDE_CLOSE, suffix: "\n" },
			function: { prefix: CLAUDE_CLOSE, suffix: "\n" }
		},
		fallbackRole: { prefix: CLAUDE_CLOSE, suffix: "\n" },
		// Was falling through to the generic list unannounced.
		stopStrings: [...SPEAKER_STOPS],
		isSelectable: true
	},
	{
		key: PromptFormats.INSTRUCT,
		name: "Instruct (Alpaca)",
		renderMode: "flat",
		// Alpaca's markers do not vary by role at all.
		roles: uniformRoles({
			prefix: INSTRUCT_OPEN,
			suffix: INSTRUCT_CLOSE
		}),
		fallbackRole: { prefix: INSTRUCT_OPEN, suffix: INSTRUCT_CLOSE },
		// Was falling through to the generic list unannounced.
		stopStrings: [...SPEAKER_STOPS],
		isSelectable: true
	},
	{
		key: PromptFormats.SPLIT_CHAT,
		name: "Split Chat (internal)",
		renderMode: "role_array",
		/**
		 * ⚠ DELIBERATELY EMPTY, and this is the security property of the table.
		 *
		 * Split-session renders `<@role:user>` markers and then PARSES THEM BACK
		 * OUT into a messages array, neutralising any literal marker in
		 * user-controlled content on the way. That guard is a hand-maintained
		 * correspondence between an emitted template literal, a regex source and
		 * a parser. If the markers were read from these fields, an admin editing
		 * the row would define markers the neutraliser does not know about and
		 * the guard would silently have a hole.
		 *
		 * So the emitter is hand-written in `PromptBlockFormatter` and reads
		 * NOTHING from here. Empty rather than a copy of the real markers,
		 * because a copy would be a second place for them to live and would read
		 * as though editing it did something. `completionTemplates.test.ts`
		 * asserts this stays empty.
		 *
		 * The row exists so a connection can reference the format and a picker
		 * can name it. It is `isSelectable: false` — it is a transport bridge,
		 * not a text format a person chooses. Retired once chat wire mode builds
		 * `messages[]` structurally.
		 */
		roles: uniformRoles({ prefix: "", suffix: "" }),
		fallbackRole: { prefix: "", suffix: "" },
		stopStrings: [...SPEAKER_STOPS],
		isSelectable: false
	}
]

/**
 * The default template — ONE definition of "and if there isn't one".
 *
 * There used to be six copies of this operator and they did not agree.
 * `promptFormatOf` said Vicuna, `makeBlock`'s `default:` arm said ChatML,
 * `schema.ts` defaulted the column to `'vicuna'`, and five adapters wrote
 * `|| "chatml"` for their stop strings — one of them (`OllamaAdapter`) writing
 * both spellings in the same file for the same connection. The visible symptom
 * was a prompt rendered as Vicuna being sent ChatML stop strings, which does
 * not error: it runs on.
 */
export const DEFAULT_COMPLETION_TEMPLATE_KEY = PromptFormats.DEFAULT

const BY_KEY = new Map(BUILTIN_COMPLETION_TEMPLATES.map((t) => [t.key, t]))

export const DEFAULT_COMPLETION_TEMPLATE = BY_KEY.get(
	DEFAULT_COMPLETION_TEMPLATE_KEY
)!

/** A built-in by key, or undefined. Does not fall back — callers decide. */
export const builtinCompletionTemplate = (
	key: string
): CompletionTemplate | undefined => BY_KEY.get(key)

/**
 * The template to render with, from whatever value carried it.
 *
 * Handles all THREE absent states, which used to be two-and-a-silent-third:
 *
 *   1. absent — nothing supplied a format (`null`/`undefined`). The debug
 *      preview, the parity harness and the template editors are all legitimately
 *      here.
 *   2. cleared — the empty string. `connections.prompt_format` is nullable text
 *      with no check constraint, so a row can hold `""`; it used to reach
 *      `makeBlock`'s `default:` arm and render ChatML, a format nobody chose.
 *   3. **unresolved** — a key with no row. New with the table: a connection can
 *      name a template that has been deleted, or a payload can carry a key from
 *      a build that had one. The foreign key nulls the column on delete, so
 *      this is the in-flight and cross-version case rather than the common one.
 *
 * All three answer the same way, because they are the same question and three
 * different answers is how the old code got into trouble.
 *
 * Accepts a resolved row so a caller that HAS one (the admin editors, and the
 * connection-scoped render once a row is loaded) renders from it directly; a
 * bare key resolves against the built-ins.
 */
export function completionTemplateOf(
	format?: string | CompletionTemplate | null
): CompletionTemplate {
	if (format && typeof format === "object") return format
	if (!format) return DEFAULT_COMPLETION_TEMPLATE
	return BY_KEY.get(format) ?? DEFAULT_COMPLETION_TEMPLATE
}

/** The framing for a role, falling back for a role outside `BlockRole`. */
export function framingFor(
	template: CompletionTemplate,
	role: string
): RoleFraming {
	return template.roles[role as BlockRole] ?? template.fallbackRole
}
