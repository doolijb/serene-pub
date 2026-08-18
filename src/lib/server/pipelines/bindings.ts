/**
 * Core's bindings — one per node type (U5).
 *
 * Each is a **wrapper around code that already exists**, not a rewrite. That is
 * the whole shape of step 3 in packages/INTEGRATING.md: the pipeline path runs
 * the same retrieval, the same prompt builder and the same adapters that the
 * current path does, so a difference in output is a bug in the wiring rather
 * than a difference in behaviour nobody can locate.
 *
 * A binding does no I/O of its own. It reads through `ctx.read` and describes
 * writes through `ctx.commit`, both of which land in `host.ts` — see the note
 * there for why the effect belongs to the substrate rather than to the handler.
 *
 * Types with no binding yet **halt with a reason** rather than being absent.
 * A missing binding is an `err` that reads like a crash; a halt says "this part
 * is not built yet" in the run inspector, which is the truth during a migration
 * that will run for two releases.
 */

import type { Bindings } from "@serene-pub/sdk"
import { ok, halt } from "@serene-pub/sdk"

/** Not built yet, and saying so plainly beats failing like a bug. */
const notYet = (what: string, where: string) => async () =>
	halt(`${what} is not bound yet — ${where}`)

export function coreBindings(): Bindings {
	return {
		// ── Inputs ──────────────────────────────────────────────────────────
		// An Input node does not fetch; it names what the trigger already
		// carried. Core hands the trigger payload in as the run's input, so the
		// binding is the identity — and that is not a placeholder, it is what an
		// Input *is* (01 §2).
		"core:input/user-message@1": async (input: any) => ok(input),
		"core:input/message-created@1": async (input: any) => ok(input),

		// ── Queries ─────────────────────────────────────────────────────────
		"core:query/chat-history@1": async (input: any, ctx: any) => {
			const messages = await ctx.read("chat_messages", {
				chatId: input?.scope?.chatId,
				limit: input?.limit ?? 100
			})
			// `main` and `messages` carry the same value on purpose: `main` is what
			// an unrefined `$.history` resolves to, and having it be the useful
			// thing rather than a wrapper is what makes the scope sugar read well.
			return ok({ main: messages, messages })
		},

		// ── Tasks ───────────────────────────────────────────────────────────
		"core:task/assemble@2": notYet(
			"assemble",
			"it wraps PromptBuilder, and its acceptance criterion is byte-identical output against the parity corpus (08 §5b)"
		),

		// ── Providers ───────────────────────────────────────────────────────
		"core:provider/generate-text@1": notYet(
			"generate-text",
			"it dispatches through the existing connection adapters, which need the connection resolver first (U5)"
		),

		// ── Consumers ───────────────────────────────────────────────────────
		// The binding describes the write; the host performs it. Returning the
		// payload unchanged is the correct implementation, not a stub.
		"core:consumer/create-message@1": async (input: any, ctx: any) =>
			ok(await ctx.commit(input)),
		"core:consumer/update-message@1": async (input: any, ctx: any) =>
			ok(await ctx.commit(input))
	}
}

/** Which type ids core can actually run today, for the diagnostics screen. */
export const boundTypeIds = () => Object.keys(coreBindings())
