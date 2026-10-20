/**
 * Two small tools the assistant genres offer beside the web and the reads
 * (ruled 2026-10-19, Chat's `tools` kinds `clock` and `calculator`). Both are
 * pure: no session read, no proposal.
 */
import { ToolError, strArg, type CoreTool } from "./index"

export const clockNow: CoreTool = {
	name: "clock_now",
	description: "The current date and time on the server, with its time zone, as plain text and as ISO 8601.",
	parameters: { type: "object", properties: {}, additionalProperties: false },
	async run() {
		const now = new Date()
		return {
			iso: now.toISOString(),
			text: now.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" }),
			timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
		}
	}
}

/** Arithmetic only: digits, operators, parentheses, decimal points, a few functions and constants. */
const SAFE = /^[\d\s+\-*/%().,eE]*$/
const FUNCS: Record<string, (...a: number[]) => number> = {
	sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, min: Math.min, max: Math.max,
	sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log, log10: Math.log10, exp: Math.exp, pow: Math.pow
}

export function calculate(expression: string): number {
	let src = expression.trim().toLowerCase().replace(/\^/g, "**").replace(/\bpi\b/g, String(Math.PI)).replace(/\be\b/g, String(Math.E))
	const names: string[] = []
	src = src.replace(/[a-z_][a-z0-9_]*/g, (m) => {
		if (!(m in FUNCS)) throw new ToolError(`"${m}" is not something the calculator knows.`)
		names.push(m)
		return `__f.${m}`
	})
	if (!SAFE.test(src.replace(/__f\.[a-z0-9]+/g, ""))) throw new ToolError("Only arithmetic can be calculated.")
	if (src.length > 500) throw new ToolError("That expression is too long.")
	// eslint-disable-next-line no-new-func
	const value = new Function("__f", `"use strict"; return (${src});`)(FUNCS)
	if (typeof value !== "number" || !Number.isFinite(value)) throw new ToolError("That does not come to a number.")
	return value
}

export const calculator: CoreTool = {
	name: "calculate",
	description: "Work out an arithmetic expression exactly: + - * / % ^, parentheses, sqrt, abs, floor, ceil, round, min, max, sin, cos, tan, log, exp, pi, e.",
	parameters: {
		type: "object",
		properties: { expression: { type: "string", description: "The expression, such as (12.5 * 4) / 3 or sqrt(2)." } },
		required: ["expression"],
		additionalProperties: false
	},
	async run(args) {
		const expression = strArg(args, "expression", "expr", "text", "query")
		if (!expression) throw new ToolError("calculate needs an expression.")
		return { expression, value: calculate(expression) }
	}
}

export const ASSISTANT_TOOLS: CoreTool[] = [clockNow, calculator]

/**
 * Which tools each **kind** a session may switch on stands for (Chat's
 * `tools` field: `CHAT_TOOL_KINDS`). 🚧 `lorebook-write` and `image` have
 * their tools since lane 2 (2026-10-19, `writeTools.ts`); `remember` and
 * `forget` also come with the session's *Remember things* task on
 * (`MEMORY_TOOL_NAMES`, ★K), whatever the kinds.
 */
export const TOOL_KINDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
	web: ["web_search", "fetch_url"],
	lore: ["search_entries", "get_entry", "read_summary"],
	"lorebook-write": ["write_entry", "remember", "forget"],
	image: ["generate_image"],
	clock: ["clock_now"],
	calculator: ["calculate"],
	history: ["grep_transcript", "read_summary"]
})

/** The tool names the given kinds stand for; `undefined` kinds = no filter. */
export function toolsOfKinds(kinds: unknown): Set<string> | null {
	if (!Array.isArray(kinds)) return null
	const out = new Set<string>()
	for (const k of kinds) for (const n of TOOL_KINDS[String(k)] ?? []) out.add(n)
	return out
}
