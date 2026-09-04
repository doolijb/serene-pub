/**
 * What a test's stand-in text adapter has to be, for the compiler.
 *
 * ## Why this exists rather than `implements AdapterActions`
 *
 * Every member of `AdapterActions` is OPTIONAL — deliberately, because absence
 * is the statement the whole capability derivation reads: a class without
 * `synthesizeSpeech` is saying its API cannot speak. The cost of that is that
 * `implements AdapterActions` checks almost nothing. A class with no actions at
 * all satisfies it; so does one whose only method is called `generate`. Every
 * fake in this repo would have passed such a clause on the day it was wrong.
 *
 * `Required<Pick<…>>` turns the one action a fake stands in for back into a
 * mandatory member at its real signature, so:
 *
 *   - a fake still spelling the old `generate()` fails to compile, instead of
 *     type-checking green while the code under test calls a method that is not
 *     there and dies at runtime in the middle of a turn;
 *   - a fake that widens the RETURN — `Promise<any>`, or an object missing
 *     `compiledPrompt` — fails here too, which matters more than it looks. The
 *     derivation says a method's presence pins what a backend accepts in and
 *     returns out; that is only true while nothing may decide locally what its
 *     own `generateText` returns, and a fake is still a class making that claim.
 *
 * ## The bug this is aimed at
 *
 * `dispatch.ts`'s own header records it: `spine.int.test.ts`'s fake adapter
 * "accepted whatever it was given", so the pipeline was handing a real adapter a
 * payload with neither `prompt` nor `messages` on it — which would have
 * generated from an empty string and read as a model fault. A fake loose enough
 * to accept anything cannot fail, and a test that cannot fail is not a test. So
 * fakes get TIGHTER as the contract does, never looser.
 *
 * Type-only, so importing it loads nothing: an adapter module must never be
 * reachable from anything the picker or the client touches, and `@lmstudio/sdk`
 * cannot even be PARSED under nodejs-mobile's V8 on Android.
 */

import type { AdapterActions } from "$lib/server/adapters/actions"

/**
 * A fake standing in for a text connection: `generateText` required, at the
 * action's own signature, and nothing else demanded of it.
 *
 * Fakes routinely also carry `withCompiledPrompt`, `abort` and `preflight`.
 * Those are lifecycle and payload plumbing rather than actions — they derive no
 * capability — so they are deliberately not pinned here; the code under test
 * calling one that is missing is an ordinary, loud failure.
 *
 * ⚠ A CLASS fake writes `implements FakeTextAdapter` and may carry whatever else
 * it likes. An object LITERAL must write `satisfies FakeTextAdapter & { … }`
 * naming those extras, because excess-property checking rejects a literal
 * carrying members the target has no room for. Reaching for `as any` instead is
 * how the check gets thrown away to silence one line — see
 * `runQueuedLLMCall.test.ts` for the shape that keeps it.
 */
export type FakeTextAdapter = Required<Pick<AdapterActions, "generateText">>
