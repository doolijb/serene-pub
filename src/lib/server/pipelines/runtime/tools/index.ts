/**
 * The tool substrate a model calls into (20 §9).
 *
 * A **tool** is a named, read-only function a model may ask for by name, and
 * the three tasks around it are pure: `advertise-tools` says what exists,
 * `parse-tool-call` reads the model's answer back as data, and
 * `core:oracle/run-tool@1` is the one node that actually runs one. This
 * module is what that node dispatches through.
 *
 * ## The resolution order, and why it is this way round
 *
 *  1. **An enabled extension's tool hook**, through the sandboxed hook
 *     dispatch that already exists — permissions, deadline, seeded RNG and
 *     the invocation log all apply, because nothing here reimplements any of
 *     them. This is the canonical tool: a plugin's, running in its sandbox.
 *  2. **A core tool** from the registry below — the four an install has with
 *     no extensions at all.
 *  3. **Refused by name.** Not "no result": a model asking for a tool nobody
 *     provides must read that it does not exist, or it will ask again.
 *
 * Extensions come first deliberately. A tool name is part of an install's
 * vocabulary, and an extension shipping `get_entry` has plainly written a
 * better one for its own world model than core's; the alternative — core
 * silently winning — would make a plugin's tool unreachable with nothing to
 * report it. Shadowing is visible in the advertisement, where the description
 * the model reads is the plugin's own.
 *
 * ## What a tool may not be
 *
 * Read-only, all of them, and that is a rule rather than a coincidence of what
 * has been written so far. A document declares its writes — each an outlet
 * with its own review gate, receipt line and caused event — and a tool is
 * chosen by the model at run time, so a writing tool would be a write no
 * document declared. What a run changes, it changes through an outlet.
 */

import type { HostTable } from "$lib/server/pipelines/runtime/bindingTypes"

/**
 * How a tool is described to a model — the shape `advertise-tools` takes on
 * its `tools` port, and the shape every native tool API wants.
 */
export interface ToolDeclaration {
	name: string
	description: string
	/** JSON Schema for the arguments. Always an object schema. */
	parameters: Record<string, unknown>
}

/**
 * What a tool implementation is handed.
 *
 * `read` is **the host's own read**, not a database handle: a tool sees the
 * session through the same enumerated seam every Query does, so the hidden and
 * still-generating message conventions, the character-lore privacy gate and
 * the session scoping all apply to a tool without it knowing they exist. A
 * tool with its own queries would be a second read path nobody reviewed for
 * scope — which is the thing `host.ts`'s switch is arranged to prevent.
 */
export interface ToolContext {
	read(table: HostTable, query?: unknown): Promise<any>
	sessionId?: number
	/** Whose turn it is — the character-lore visibility rule reads it. */
	currentCharacterId?: number | null
	signal?: AbortSignal
	/**
	 * Ask for a change to the session's state, held for a person to accept.
	 *
	 * ⚠ **The one thing a tool may do besides read, and it is not a write.** A
	 * proposal is a request with no effect until somebody decides it, which is
	 * exactly the distinction the read-only rule above is protecting: nothing
	 * a model says changes the world inside a loop. The row it creates is
	 * anchored to the message that asked for it, so a rejected turn takes its
	 * requests with it.
	 *
	 * Optional, like `read`, and for the same reason: a host may implement
	 * none, and a tool asking one of those must refuse in a sentence rather
	 * than crash.
	 */
	propose?(change: unknown): Promise<number>
}

export interface CoreTool extends ToolDeclaration {
	run(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>
}

/**
 * A tool that failed, as a value.
 *
 * Thrown out of a tool and caught at the node, because the node's contract is
 * that a tool error is a *result* the model reads and recovers from. This
 * class only marks the sentence as one that may be shown to a model — an
 * unexpected throw carries an internal message and is reported as such.
 */
export class ToolError extends Error {}

/** Every string this tool call is willing to read as its argument. */
export const strArg = (
	args: Record<string, unknown>,
	...names: string[]
): string => {
	for (const n of names) {
		const v = args?.[n]
		if (typeof v === "string" && v.length) return v
		if (typeof v === "number") return String(v)
	}
	return ""
}

export const intArg = (
	args: Record<string, unknown>,
	name: string,
	fallback: number,
	max: number
): number => {
	const v = args?.[name]
	const n =
		typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
	if (!Number.isFinite(n) || n <= 0) return fallback
	return Math.min(Math.floor(n), max)
}
