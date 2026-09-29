/**
 * Which METHOD a connection is called by — chat or completion — as one answer.
 *
 * ## The defect this exists to close
 *
 * Wire mode used to be derived inside each adapter from its own local flags:
 * `extraJson.useChat` on KoboldCPP, Ollama and LM Studio,
 * `extraJson.prerenderPrompt` on OpenAI, and an unconditional `true` on
 * Anthropic. Those were read inside `compilePrompt(args)` — and the pipeline
 * hands its payload over through `withCompiledPrompt`, which bypasses
 * `compilePrompt` entirely. So on every pipeline run the flag was never set,
 * and an adapter that branches on it received a payload built for the other
 * shape: Anthropic sent `{system: "", messages: [{role: "user", content:
 * "Hello"}]}` off its empty-messages floor, and KoboldCPP posted to
 * `/v1/chat/completions` with no `messages` key at all. A user's lore, persona
 * and history replaced by a five-letter greeting, with nothing reporting it.
 *
 * So the question moved to where both halves can read the same answer: it is a
 * CONNECTION CAPABILITY, requested and graded like any other. The provider node
 * stays blind — it asks for `text->text` and the connection says how it wants to
 * be called. That is only possible while the mode lives on the connection;
 * **do not reintroduce an adapter-local derivation.**
 *
 * ## Client-safe, and why that matters here
 *
 * Only the SDK and the static manifest are imported. The connection forms need
 * this to decide whether to offer a completion-template picker at all (a
 * template has no effect in chat mode, where the roles carry the structure), and
 * they render in the browser — where `@lmstudio/sdk` cannot even be parsed. Same
 * reason `manifest.ts` exists at all.
 *
 * ⚠ Nothing here resolves the four layers. `resolveCapabilities` is importable
 * from client code and calling it here would be the one-line temptation
 * `capabilityRows.ts` warns about at length: a second reading of the layers is
 * how the screen comes to say one thing and the run to do another. This takes an
 * ALREADY-RESOLVED set. The server's own reading is
 * `connections/resolve.ts resolveWireMode`, which resolves live from the row and
 * is what every send path uses.
 */

import {
	WIRE_CAPABILITY,
	WIRE_MODE_ORDER,
	gradeOf,
	wireModeOf,
	type CapabilitySet,
	type WireMode
} from "@serene-pub/sdk"
import { adapterCapabilities } from "./manifest"

export type { WireMode }

/**
 * What a connection TYPE offers before any other layer speaks: its declared wire
 * modes that are also on by default.
 *
 * Both halves, because `supports` is a gate and `defaults` is a position — a
 * mode declared but not defaulted is one a preset or a person may switch on, not
 * one that is on. Read straight off the static manifest, so this costs nothing
 * and reaches the browser.
 */
export function declaredWireModes(
	type: string | null | undefined
): CapabilitySet {
	const adapter = type ? adapterCapabilities(type) : undefined
	if (!adapter) return {}
	const defaults = new Set<string>(adapter.defaults ?? [])
	const out: CapabilitySet = {}
	for (const mode of WIRE_MODE_ORDER) {
		const id = WIRE_CAPABILITY[mode]
		if (adapter.supports[id] === undefined) continue
		if (!defaults.has(id)) continue
		// The declaration is a band name, never a bare number, and `gradeOf`
		// is what turns one into this capability's own grade. Both wire modes
		// are binary, so this is 1 — written as a call rather than as a literal
		// so a future band on either scale cannot make this line quietly wrong.
		out[id] = gradeOf(id, "native")
	}
	return out
}

/**
 * The wire mode to call this connection by, with a total answer.
 *
 * Three steps, weakest last:
 *
 *  1. **What the four layers resolved**, if they named either mode. This is the
 *     authoritative answer and the only one a saved, resolved connection needs.
 *  2. **What the type declares**, for a set that names neither. Two real cases:
 *     a row whose `capabilities.resolved` cache was written by a build that
 *     predated these keys, and a connection literal in a unit test. Reading the
 *     adapter layer alone is not a re-resolution of the four — it is the same
 *     static read `capabilityRows.ts` already makes to build its rows.
 *  3. **`chat`**, which no registered text type reaches (each declares at least
 *     one wire mode, and `manifest.conformance.test.ts` pins that). The branch
 *     exists so no caller needs a second spelling of the absent case, and `chat`
 *     rather than `completion` for the same reason the tie-break prefers it: a
 *     flat prompt can always be rebuilt from messages (`promptTextFor` does
 *     exactly that), while a chat-only backend handed a flat payload has no
 *     messages to send and falls into the placeholder floor that started all
 *     this.
 */
export function wireModeFor(
	type: string | null | undefined,
	have: CapabilitySet | null | undefined
): WireMode {
	return (
		wireModeOf(have ?? {}) ?? wireModeOf(declaredWireModes(type)) ?? "chat"
	)
}

/**
 * Does a completion template have any effect on this connection?
 *
 * The one place that question is spelled, because it is asked on three surfaces
 * — the connection forms, Document View's edit page, and the admin template
 * picker — and a control that renders where it does nothing is the exact
 * "no control without an effect" failure a recent audit removed elsewhere. In
 * chat mode the roles carry the structure: no delimiters are emitted, no stop
 * strings from the template are sent, and the picker would be a saved
 * preference that changes no byte of any request.
 */
export const usesCompletionTemplate = (mode: WireMode): boolean =>
	mode === "completion"
