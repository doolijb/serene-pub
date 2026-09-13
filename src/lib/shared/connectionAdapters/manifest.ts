/**
 * What each API format can express, declared as static data.
 *
 * ## Why this is a separate module from the adapters
 *
 * Two reasons, and the second is load-bearing.
 *
 * The picker needs to know what a connection type can do *before* anything is
 * chosen — it renders capability badges on types the user has not created a
 * connection for yet. Reaching into an adapter module for that would import
 * every backend's SDK at startup, which is exactly what the lazy `import()` in
 * `getConnectionAdapter` exists to avoid.
 *
 * And that lazy loading is not a performance nicety: `@lmstudio/sdk` uses
 * `\p{Lu}` regex property escapes that **fail to parse under nodejs-mobile's V8
 * on Android**, so a static import of it crashes server boot on that platform
 * regardless of configuration. Today the capability declaration lives inside
 * that un-importable module. Moving it here makes the declaration reachable
 * everywhere and leaves the implementation lazy — strictly better than before.
 *
 * ## The layering this participates in
 *
 *   THIS FILE (what the wire protocol can express)  ← a gate, not a default
 *     → preset  (what this named service does)
 *     → probe   (what the live backend answered)
 *     → user    (the final toggle)
 *
 * A capability absent from an entry's `supports` can never be switched on by any
 * of the three layers below it, because the protocol has no field for it. That
 * is the whole reason an adapter is scoped by API FORMAT rather than by vendor:
 * Claude reached through an OpenAI-compatible endpoint and Claude reached
 * through the native Anthropic API differ in precisely this.
 *
 * ## ⚠ What this file's relationship to the implementations now IS
 *
 * **Checked, not asserted.** This is a CACHE of a derivation, exactly the way
 * `connections.capabilities.resolved` is a cache of the four layers, and for the
 * same reason: the picker resolves capabilities for every connection row against
 * every slot, and deriving them there would import an adapter module per row —
 * which the Android paragraph above makes impossible.
 *
 * The two halves are split like this, and both are load-bearing:
 *
 *   - The KEY SPACE of every action transform is DERIVED. A key is here if and
 *     only if some module registered for that type in `ADAPTER_REGISTRY`
 *     implements the action `ACTION_TRANSFORM` maps it to
 *     (`$lib/shared/connectionAdapters/actions`). A conformance test asserts set
 *     equality, so a hand edit that disagrees with the implementations fails
 *     `npm test` — before merge, naming the type, the method and the id.
 *   - The GRADES, the `defaults`, and every hosted extension
 *     (`text+image->text`, `image->image`) and feature (`tools`, `json_schema`)
 *     stay DECLARED here, because no method can carry them. `tools: "emulated"`
 *     is a claim about what Serene Pub supplies over a backend that never heard
 *     of tools; `{unproven:true}` is a claim about what nobody has asked yet;
 *     and vision is per-MODEL, not per-format. A generator emitting this file
 *     would emit half of it and leave a human editing the other half — two
 *     sources of truth moved one level up.
 *
 * ## The values are grades, written as BAND NAMES
 *
 * A grade is a number (`Grade`), and what a number means depends on the
 * capability: `bandsFor("tools")` is `[none, emulated, native]` because Serene
 * Pub can format and parse tool calls itself, while `bandsFor("text->image")` is
 * `[none, native]` because nothing fakes a picture. So `tools: "native"` is grade
 * 2 and `"text->text": "native"` is grade 1, and both are that capability's best.
 *
 * The names are what gets written here rather than the numbers, and that is a
 * safety property, not a convenience: `tools: 1` is emulated tool calling and
 * `tools: 2` is native, one keystroke apart with nothing to catch it, while
 * `"nativ"` does not compile. `gradeOf` turns a name into that capability's own
 * number at the one place it is read. The manifest states MEANING; the SDK's
 * band table owns the arithmetic.
 *
 * So: **presence supplies the keys, this file supplies the values.** When the
 * two disagree, CI finds out, not a user minutes into a session — which is the
 * inverse of the failure this replaced, where an OpenAI connection resolved
 * `text->image: "native"`, cleared the bind guard, and then threw `No image
 * adapter for connection type` out of a loader.
 */

import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { AdapterCapabilities, WireMode } from "@serene-pub/sdk"
import { cap, mib, type AdapterIo } from "./io"

export interface AdapterManifestEntry {
	/** The `CONNECTION_TYPE` value this describes. */
	id: string
	/** What this wire protocol can express, and what is on by default. */
	capabilities: AdapterCapabilities
	/**
	 * HOW MANY files, HOW BIG, and in WHICH FORMATS — the cardinality half.
	 *
	 * A separate field from `capabilities` because it answers a separate
	 * question, and because the transform vocabulary above genuinely cannot
	 * carry it: `text+image->text` is a set of KINDS, and a set has no
	 * multiplicity — `[image, image] -> [text]` says nothing more than
	 * `[image] -> [text]` does. Counts and byte caps therefore ride alongside
	 * the grades rather than inside them. See `./io` for the shape and for the
	 * rule that matters most about it:
	 *
	 * ⚠ **absent means NO KNOWN LIMIT, never zero.** Which is why almost every
	 * entry below has no `io` block at all, and why that is the correct state
	 * rather than an unfinished one: a cap nobody published is a cap that must
	 * not be invented, because a guessed one refuses work the backend would have
	 * taken and does it with an authoritative-sounding message.
	 */
	io?: AdapterIo
	/**
	 * Which of this type's wire modes carry a CONTINUATION as a true prefill.
	 *
	 * A second field rather than a grade on `continue_reply`, because the two
	 * answer different questions and the capability vocabulary can only hold one
	 * of them. `supports.continue_reply` says whether this connection MAY be
	 * asked to continue — graded through the four layers like everything else,
	 * which is where a per-model fact such as "Claude 4.6 rejects a prefill"
	 * belongs. This says whether the CODE can, and it depends on the wire the
	 * request goes out on:
	 *
	 *   - `completion` prefills by construction. The assembled prompt ends with
	 *     an OPEN assistant block holding the partial, and the adapter sends that
	 *     string, so the model writes the next characters of it.
	 *   - `chat` prefills only where the protocol itself accepts a trailing
	 *     assistant turn as one. Anthropic's Messages API does; an
	 *     OpenAI-compatible endpoint hands it to a chat template instead, and
	 *     whether the model carries the turn on is that template's decision.
	 *
	 * A grade could not express "in this wire and not that one", and a resolver
	 * rule that hardcoded "completion always, chat never except Anthropic" would
	 * be the same table written as a conditional in a file that cannot see an
	 * adapter. `$lib/shared/connectionAdapters/continueReply` reads this, the
	 * capability panel and the verb both read that, and
	 * `BaseConnectionAdapter.continuationRoute` routes on it — one fact, four
	 * readers, no second spelling.
	 *
	 * ⚠ Absent means NO WIRE CARRIES IT, and the conformance test pins that
	 * against `supports`: a type declaring `continue_reply` with no
	 * `continuesIn` would offer a switch nothing could honour, and a type with
	 * `continuesIn` and no capability key would carry a continuation no layer
	 * could ever grant.
	 */
	continuesIn?: readonly WireMode[]
}

/**
 * Per-API-format declarations.
 *
 * `unproven` entries carry what to assume until something answers, and the two
 * fallbacks differ for a reason: tool calling degrades to `emulated` because the
 * app can format and parse it for a model that never heard of tools, while image
 * generation degrades to `none` because nothing fakes a picture. A single
 * hardcoded pessimism would have to be wrong for one of them, which is why
 * `unproven` is a flag carrying an `until` and not a grade of its own.
 *
 * ## Why exactly one entry has an `io` block
 *
 * Because exactly one of these nine backends publishes per-request file and byte
 * limits. That is not an omission to be tidied up later — it is the rule in
 * `./io` being followed: **absent means no known limit, and a guessed cap is
 * worse than none**, because it refuses work the backend would have accepted and
 * does so with a message that sounds like it came from the service.
 *
 * The three shapes of "nothing declared", so the next reader can tell them apart:
 *
 *   - **OPENAI** is twenty-four services behind one wire format. OpenAI's
 *     own numbers are published, and they are not OpenRouter's, Groq's, or a
 *     vLLM instance somebody is running on a workstation. A number here would be
 *     right for one preset and wrong for twenty-three; per-service limits belong
 *     to the preset layer (`PRESET_CAPABILITIES`) the day somebody sources them.
 *   - **OLLAMA, KOBOLDCPP, KOBOLDCPP_MANAGED, LLAMACPP, LM_STUDIO**
 *     point at a process on somebody's own machine. There is no published cap to
 *     find, and the real constraint is that machine's VRAM.
 *   - **A1111 and KOBOLDCPP_MANAGED_IMAGE** have no `out` block, and that one is
 *     a considered decision rather than a gap. KoboldCPP does return a single
 *     image whatever `n_iter` asks for — but `A1111Adapter` already declares
 *     `batch: true` on the grounds that whether a batch arrives "depends on the
 *     backend, and the result says which happened rather than this claiming to
 *     know in advance", and it reports `batch` as ignored when the count comes
 *     back short. Declaring `out.image.maxFiles = 1` would contradict that in the
 *     one file that cannot tell the two backends apart, and it would pre-refuse
 *     batching on AUTOMATIC1111, Forge and SD.Next, which genuinely honour it.
 */
export const ADAPTER_MANIFEST: Record<string, AdapterManifestEntry> = {
	/**
	 * OpenAI Chat Completions — and the twenty-four services behind it.
	 *
	 * The widest `supports` and the most `probed` entries, because "an
	 * OpenAI-compatible endpoint" says almost nothing about what is actually
	 * serving it. `json_object` is native while `json_schema` is probed
	 * deliberately: the compatible zoo supports the loose mode far more widely
	 * than the strict one, which is a difference presets exist to record.
	 *
	 * ⚠ No `text->image`, and its absence is now structural. This entry used to
	 * declare it `{unproven:true, until:"none"}` and the `openai-official` preset
	 * asserted it `true`, which resolved to `native` — so the bind guard passed,
	 * an image slot accepted the connection, and `getImageAdapter` then threw `No
	 * image adapter for connection type` minutes into the session. `OpenAIChatAdapter`
	 * speaks `/v1/chat/completions` and nothing else; no image module is registered
	 * for this type, so nothing implements `generateImage` and the key cannot come
	 * back without one. Image generation over an OpenAI-compatible endpoint would
	 * be `/v1/images/generations` — a different route, hence a different adapter.
	 */
	[CONNECTION_TYPE.OPENAI]: {
		id: CONNECTION_TYPE.OPENAI,
		capabilities: {
			supports: {
				"text->text": "native",
				"text+image->text": { unproven: true, until: "none" },
				"text+document->text": { unproven: true, until: "none" },
				json_object: "native",
				json_schema: { unproven: true, until: "none" },
				strict_schema: { unproven: true, until: "none" },
				tools: "native",
				streaming: "native",
				/**
				 * BOTH wire modes, and the second one needs saying out loud
				 * because it is not the endpoint you would guess.
				 *
				 * `OpenAIChatAdapter` speaks `/v1/chat/completions` and nothing
				 * else — there is no `/v1/completions` branch in it and this
				 * change adds none. What `wire_completion` means here is the
				 * behaviour `extraJson.prerenderPrompt` used to name: render the
				 * whole prompt flat through the connection's completion template,
				 * with that template's stop strings, and hand the model that one
				 * string (carried in a single user turn, because the envelope has
				 * nowhere else to put it). Which is precisely what the wire mode
				 * question asks — what the MODEL receives, one formatted prompt or
				 * role-tagged turns — rather than which route the POST goes to.
				 *
				 * So it is `native` unconditionally and never probed: it works
				 * against every one of the twenty-four services behind this
				 * format, because it is still an ordinary chat request. Services
				 * that should not be called that way say so at the PRESET layer,
				 * where `openai-official` switches it off.
				 */
				wire_chat: "native",
				wire_completion: "native",
				/**
				 * And it continues a reply — in ONE of those two wires.
				 *
				 * `native` rather than probed, because this is a claim about the
				 * FORMAT and not about the model behind it: pre-rendering the
				 * whole prompt flat leaves the assistant block open, whichever of
				 * the twenty-four services is answering. `continuesIn` below is
				 * what says the other wire cannot — in chat mode the partial goes
				 * as a trailing `{role:"assistant"}` message, which this format
				 * hands to a chat template rather than treating as a prefill.
				 */
				continue_reply: "native"
			},
			defaults: [
				"text->text",
				"json_object",
				"tools",
				"streaming",
				// Both on, so the tie-break decides — and it decides `chat`,
				// which is what `prerenderPrompt ?? false` has always meant.
				"wire_chat",
				"wire_completion",
				// On, and therefore in effect exactly when the resolved wire mode
				// is the one that carries it. Nothing to switch by hand for
				// somebody already sending completions.
				"continue_reply"
			]
		},
		continuesIn: ["completion"]
	},

	/**
	 * The Anthropic Messages API.
	 *
	 * Three deliberate absences: no `json_object`, no `json_schema`, no
	 * `grammar`. The adapter has never implemented any of them, and a
	 * `responseSchema` set on an Anthropic connection is silently ignored today.
	 * Declaring the gap turns that silence into a refusal at bind time with a
	 * sentence naming the capability.
	 *
	 * ⚠ The ONE entry with an `io` block, and its loneliness is the point: these
	 * are the only per-request file and byte limits any of the nine backends
	 * publishes in a form worth quoting back to a user. See the block itself for
	 * each number's source, and `./io` for why the other eight declare nothing.
	 */
	[CONNECTION_TYPE.ANTHROPIC]: {
		id: CONNECTION_TYPE.ANTHROPIC,
		capabilities: {
			supports: {
				"text->text": "native",
				"text+image->text": "native",
				"text+document->text": "native",
				tools: "native",
				streaming: "native",
				/**
				 * Chat and ONLY chat, and the absence is structural rather than a
				 * default that happens to be off.
				 *
				 * The Messages API has no completion form: there is no field on
				 * the request that takes one flat prompt, so there is nothing for
				 * a preset, a probe or a person to switch on. `resolveCapabilities`
				 * iterates `supports`, so leaving `wire_completion` out is what
				 * makes that unreachable rather than merely unset — the same
				 * asymmetry `text->image` uses two entries down.
				 *
				 * ⚠ This replaces `compilePrompt({useSessionFormat: true})`, which
				 * was the unconditional-true that hid the defect: the pipeline
				 * hands its payload over through `withCompiledPrompt` and never
				 * calls `compilePrompt`'s argument path at all, so the flag was
				 * never set on a pipeline run and this adapter received a payload
				 * built for text completion. The empty-messages floor in
				 * `buildAnthropicMessages` then filled in `"Hello"` and sent that
				 * instead of the assembled prompt. Do not reintroduce a
				 * derivation here; the connection answers this question now.
				 */
				wire_chat: "native",
				/**
				 * The one CHAT wire that genuinely prefills — and the one entry
				 * whose grade is a question rather than a statement.
				 *
				 * The Messages API takes a trailing assistant turn as a prefill:
				 * the model writes the next characters of that turn rather than
				 * opening a new one. That is a property of the FORMAT, which is
				 * what this layer grades, and it is why `continuesIn` below says
				 * `chat` where every other entry says `completion`.
				 *
				 * ⚠ **Whether the MODEL accepts one is per-model, and the answer
				 * changed.** Claude Opus 4.6, Sonnet 4.6 and everything after
				 * them REJECT a last-assistant-turn prefill with a 400; Claude
				 * 4.5 and earlier accept it. Both families are in this adapter's
				 * own `listModels` today. Per-model is precisely what
				 * `{unproven: true}` is for — the same reason vision is probed
				 * everywhere it is not asserted — and `until: "none"` is the only
				 * honest pessimism here: assuming yes turns every Continue on a
				 * current model into a 400 mid-session, while assuming no leaves
				 * the button disabled with a sentence saying which switch to
				 * flip.
				 *
				 * So it is deliberately NOT in `defaults` below. Somebody pointed
				 * at a 4.5-family model switches it on and it stays on; nothing
				 * probes it, because `testConnection` here answers with a key
				 * check rather than a capability report.
				 */
				continue_reply: { unproven: true, until: "none" }
			},
			defaults: [
				"text->text",
				"text+image->text",
				"text+document->text",
				"tools",
				"streaming",
				"wire_chat"
				// No `continue_reply` — see the note above. Switchable, not on.
			]
		},
		continuesIn: ["chat"],
		io: {
			in: {
				image: {
					/**
					 * Anthropic's vision documentation gives TWO numbers: up to
					 * 100 images per request on the 200k-context models, and up
					 * to 600 on the others. The tighter one is declared, because
					 * this layer is per API FORMAT and there is no per-model
					 * limit layer to hold the looser figure — the 200k models are
					 * the ones a connection is overwhelmingly pointed at, and a
					 * cap that is too generous fails at the service while one
					 * that is too tight refuses work here.
					 *
					 * ⚠ claude.ai's 20-images-per-message limit is deliberately
					 * NOT declared. This adapter speaks the Messages API; the web
					 * app's own limit is not a property of the wire format and
					 * declaring it would refuse 80 images the API accepts.
					 *
					 * ⚠ DIMENSIONS are not declared either, for want of anywhere
					 * to put them, and the gap is recorded here rather than
					 * papered over. The vision docs give two rules: no image may
					 * exceed 8000x8000 px, and once a request carries more than 20
					 * image or document blocks, every image in it must be within
					 * 2000x2000 px. Their own suggested workaround is to resize so
					 * neither dimension exceeds 2000 px, or to keep the request to
					 * 20 blocks or fewer. Dimensions are neither a count nor a byte
					 * size, `AdapterIo` has no field for them, and inventing one to
					 * hold a single service's rule would be worse than saying so.
					 */
					maxFiles: cap(
						100,
						"Anthropic vision docs: up to 100 images per API request on 200k-context models"
					),
					/**
					 * ⚠ On the BASE64-ENCODED size. The docs say it in those
					 * words — "10 MB (base64-encoded) when using the Claude API
					 * directly" — so this is not a limit on the file: base64 is
					 * four characters per three bytes, which puts the effective
					 * ceiling at 7.5MiB of actual image. The number is declared as
					 * published and `prepareAttachments` applies the adapter's
					 * `transport` to it, so the arithmetic lives in one place
					 * rather than being pre-multiplied into a figure that no
					 * longer matches its own citation.
					 *
					 * The 5MB figure on the same page is the Bedrock and Vertex
					 * row; this entry speaks to the API directly.
					 *
					 * Binary MB rather than 10,000,000, deliberately. The
					 * documentation says "10 MB" without saying which, and the two
					 * readings differ by 5%: reading it as the larger risks one
					 * request the service rejects with its own message naming the
					 * real limit, while reading it as the smaller refuses files
					 * the service would have accepted — which is the failure this
					 * whole file is arranged to avoid.
					 */
					maxBytesPerFile: cap(
						mib(10),
						"Anthropic vision docs: maximum 10MB per image, measured base64-encoded"
					),
					// The published list, as format-table entries rather than as
					// hand-spelled strings.
					//
					// ⚠ GIF and WebP are accepted but ANIMATION IS NOT: the docs
					// say "animations are unsupported, and only the first frame is
					// used". That is not a reason to refuse one — the request is
					// valid and the model does see the first frame — so it stays a
					// note rather than a rule. The format table already tracks
					// `animated`, so telling a user their clip will be read as a
					// still is a UI job whenever there is a picker to say it in.
					accepts: [
						"image/jpeg",
						"image/png",
						"image/gif",
						"image/webp"
					],
					// OURS, not Anthropic's — the order to convert TOWARD when a
					// file is in none of the accepted formats. WebP first because
					// it is the smallest at equal quality and the byte caps above
					// are the binding constraint; PNG next for a lossless source;
					// JPEG after it. GIF is accepted but never preferred: every
					// encoder in this build writes a single frame, so choosing GIF
					// as a target buys nothing and loses colour depth. An
					// already-accepted file passes through untouched regardless of
					// this order.
					prefers: ["image/webp", "image/png", "image/jpeg"]
				},
				document: {
					/**
					 * PDF and nothing else. The Messages API takes a `document`
					 * content block of `application/pdf`; the other document
					 * formats in the vocabulary (docx, epub, rtf, …) are not
					 * accepted and this build cannot convert them either, so a
					 * refusal here names the file rather than the API returning
					 * one about a base64 blob.
					 */
					accepts: ["application/pdf"],
					// Measured the same way every byte cap here is — on what is
					// sent, which for this API is base64. The per-PDF figure and
					// the whole-request figure are the same 32MB, so this cap can
					// never be the one that binds: a PDF large enough to reach it
					// has already broken the request limit it is encoded into.
					maxBytesPerFile: cap(
						mib(32),
						"Anthropic PDF support docs: maximum 32MB per PDF"
					)
					// No `maxFiles`: the documented limit on a PDF is 100 PAGES,
					// which is not a file count and cannot be checked without a
					// document engine this build does not carry. Left undeclared
					// rather than approximated — see `./io`.
				}
			},
			/**
			 * The whole-request cap, which binds where the per-file caps do not:
			 * four 9MB images each pass a 10MB per-image check and together break
			 * this one.
			 */
			maxRequestBytes: cap(
				mib(32),
				"Anthropic API docs: maximum 32MB total request size"
			)
			// No `out` block. Anthropic returns text; it renders nothing, so there
			// is no output file count to cap.
		}
	},

	/**
	 * Ollama's native API.
	 *
	 * Vision is probed and costs no extra request: `ollama.list()` already
	 * returns `details.families`, and a `clip`/`mmproj` family there is the
	 * answer. Tools degrade to `emulated` rather than `none` because the grammar
	 * path works regardless of the model.
	 *
	 * No `text->embedding`, though Ollama's `/api/embed` is real and this entry
	 * used to claim it: `OllamaAdapter` implements no `embedText`, so the
	 * capability was one nothing could deliver. It returns the day the method
	 * lands — and `src/lib/server/embedding/` already hand-rolls the client that
	 * would become it, which is why this is the named first follow-up.
	 */
	[CONNECTION_TYPE.OLLAMA]: {
		id: CONNECTION_TYPE.OLLAMA,
		capabilities: {
			supports: {
				"text->text": "native",
				"text+image->text": { unproven: true, until: "none" },
				json_object: "native",
				json_schema: "native",
				tools: { unproven: true, until: "emulated" },
				streaming: "native",
				// `ollama.chat()` and `ollama.generate()` — two real methods on
				// one client, both implemented in `OllamaAdapter`, so both are
				// declared. This replaces `extraJson.useSession`, which that file
				// read with two different defaults in two places (`!!x` at
				// `compilePrompt`, `x ?? true` at the send) and documented as a
				// bug against itself.
				wire_chat: "native",
				wire_completion: "native",
				// `ollama.generate()` is handed the flat prompt, open assistant
				// block and all, so completion wire prefills. `ollama.chat()`
				// takes messages and applies the model's own template to them.
				continue_reply: "native"
			},
			defaults: [
				"text->text",
				"json_object",
				"json_schema",
				"tools",
				"streaming",
				"wire_chat",
				"wire_completion",
				"continue_reply"
			]
		},
		continuesIn: ["completion"]
	},

	/**
	 * KoboldCPP, native API.
	 *
	 * The one backend that genuinely does everything from one process — and it
	 * already reports which of them over `/api/extra/version`. `grammar` is
	 * native (GBNF), so the schema forms come back as `emulated` through
	 * `EMULATABLE_VIA` without being declared here.
	 *
	 * `text->image` stays, and stays PROBED, and it is the clearest case for why
	 * the two halves of this file are split the way they are. The KEY is derived:
	 * `ADAPTER_REGISTRY` maps this type to `A1111Adapter` as well as
	 * `KoboldCppAdapter`, so `generateImage` is genuinely implemented for it and
	 * the type's action set is the UNION across both modules. The VALUE stays a
	 * question: this points at somebody else's process, and whether that process
	 * has an SD model loaded is per-instance, which no class can answer.
	 *
	 * ⚠ `text->audio`, `audio->text` and `text->embedding` are gone. The endpoint
	 * really does report all three over `/api/extra/version` and
	 * `capabilitiesFromFlags` really does still read them — but nothing
	 * implements `synthesizeSpeech`, `transcribeAudio` or `embedText` anywhere in
	 * the app, so those were three capabilities that could be switched on and
	 * never called. The probe's answers for them are now fetched, written to the
	 * durable `probe.found`, and discarded by resolution: correct, and worth
	 * knowing before it reads as a bug. Existing user overrides for them sit in
	 * the column doing nothing until the matching action lands, at which point
	 * the key returns with its probe answer already waiting.
	 */
	[CONNECTION_TYPE.KOBOLDCPP]: {
		id: CONNECTION_TYPE.KOBOLDCPP,
		capabilities: {
			supports: {
				"text->text": "native",
				"text+image->text": { unproven: true, until: "none" },
				"text->image": { unproven: true, until: "none" },
				grammar: "native",
				tools: "emulated",
				streaming: "native",
				// `/v1/chat/completions` and `/api/v1/generate`, both spoken by
				// `KoboldCppAdapter` today. Unconditional rather than probed:
				// `/api/extra/version` reports which MODELS are loaded (txt2img,
				// vision, tts) and says nothing about either endpoint, because
				// both are always there. A probe entry for these would be an
				// invention rather than a recording — see `probeCapabilities.ts`.
				wire_chat: "native",
				wire_completion: "native",
				// `/api/v1/generate` takes the prompt verbatim — no template is
				// applied — so the open assistant block reaches the model as
				// written. `/v1/chat/completions` does not.
				continue_reply: "native"
			},
			defaults: [
				"text->text",
				"grammar",
				"tools",
				"streaming",
				"wire_chat",
				"wire_completion",
				"continue_reply"
			]
		},
		continuesIn: ["completion"]
	},

	/**
	 * The same wire format, with the admin API assumed.
	 *
	 * The same three extras are gone for the same reason as on plain KOBOLDCPP:
	 * no `synthesizeSpeech`, no `transcribeAudio`, no `embedText` exists to call.
	 */
	[CONNECTION_TYPE.KOBOLDCPP_MANAGED]: {
		id: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
		capabilities: {
			supports: {
				"text->text": "native",
				"text+image->text": { unproven: true, until: "none" },
				// No text->image, and its absence is structural rather than a default.
				// resolveCapabilities iterates `supports` only, so a key that is not here
				// cannot be granted by a preset, a probe or an override — which is what makes
				// the reported bug (an LLM connection offered in the image picker)
				// unreproducible rather than merely un-triggered. A managed text connection
				// names a text model and cannot draw, whatever the process happens to hold.
				// Image generation through the Manager is KOBOLDCPP_MANAGED_IMAGE.
				//
				// ⚠ This absence is now DEFENDED BY CI rather than by this comment.
				// ADAPTER_REGISTRY registers no `image` thunk for this type — the entry
				// there carries the matching note — so the derivation and the declaration
				// agree by construction: restoring the key without a module, or adding a
				// module without the key, fails the conformance test. Do not "restore" it.
				grammar: "native",
				tools: "emulated",
				streaming: "native",
				// The same two endpoints as plain KOBOLDCPP: this type extends
				// that adapter and inherits its send path unchanged.
				wire_chat: "native",
				wire_completion: "native",
				// Inherited with the send path: this type extends KoboldCppAdapter.
				continue_reply: "native"
			},
			defaults: [
				"text->text",
				"grammar",
				"tools",
				"streaming",
				"wire_chat",
				"wire_completion",
				"continue_reply"
			]
		},
		continuesIn: ["completion"]
	},

	/** llama.cpp's llama-server. Grammar, and text, and no more. */
	[CONNECTION_TYPE.LLAMACPP]: {
		id: CONNECTION_TYPE.LLAMACPP,
		capabilities: {
			supports: {
				"text->text": "native",
				"text+image->text": { unproven: true, until: "none" },
				grammar: "native",
				tools: "emulated",
				streaming: "native",
				/**
				 * Both wires, and the day the key arrived is the day the branch
				 * did.
				 *
				 * This entry used to declare `wire_completion` alone, with a
				 * paragraph explaining that llama-server exposes
				 * `/v1/chat/completions` but this TYPE could not reach it — no
				 * chat branch in `LlamaCppAdapter`, so declaring the key would
				 * have been a key with no code behind it, which is the
				 * `text->image` failure this whole file was written to end. The
				 * branch exists now (`isChatWire`, the same `useSession` idiom
				 * `OllamaAdapter` and `KoboldCppAdapter` use), so the
				 * declaration follows it rather than anticipating it.
				 *
				 * ⚠ **`wire_chat` is SUPPORTED but not DEFAULTED, and the
				 * asymmetry is the whole point.** `supports` is a gate and
				 * `defaults` is a position (`declaredWireModes`): a mode
				 * declared and not defaulted resolves to 0 until a preset, a
				 * probe or a person switches it on. Completion is what every
				 * existing `llamacpp_completion` row was ACTUALLY being called
				 * by, and the rename in `drizzle/0105_llamacpp_service_type.sql`
				 * carries those rows over verbatim — so defaulting chat here
				 * would silently re-tune every install that upgrades, on the
				 * send path, which is precisely the class of change
				 * `0098_wire_mode_intent.sql` exists to have prevented.
				 */
				wire_chat: "native",
				wire_completion: "native",
				// `/completion` takes the raw prompt, so the seed block stays
				// open. And this type DEFAULTS to completion wire, which makes it
				// the one backend where Continue works out of the box.
				continue_reply: "native"
			},
			defaults: [
				"text->text",
				"grammar",
				"tools",
				"streaming",
				// No `wire_chat` — see the note above. Switchable, not on.
				"wire_completion",
				"continue_reply"
			]
		},
		continuesIn: ["completion"]
	},

	/** The LM Studio SDK. Native structured output, emulated tools. */
	[CONNECTION_TYPE.LM_STUDIO]: {
		id: CONNECTION_TYPE.LM_STUDIO,
		capabilities: {
			supports: {
				"text->text": "native",
				"text+image->text": { unproven: true, until: "none" },
				json_object: "native",
				json_schema: "native",
				tools: "emulated",
				streaming: "native",
				// `.respond()` takes messages, `.complete()` takes a prompt; the
				// adapter branches between them. Replaces `extraJson.useSession`.
				wire_chat: "native",
				wire_completion: "native",
				// `.complete()` is handed the prompt string; `.respond()` is
				// handed messages and templates them.
				continue_reply: "native"
			},
			defaults: [
				"text->text",
				"json_object",
				"json_schema",
				"tools",
				"streaming",
				"wire_chat",
				"wire_completion",
				"continue_reply"
			]
		},
		continuesIn: ["completion"]
	},

	/**
	 * The A1111-compatible image API — KoboldCPP with an image model, plus
	 * AUTOMATIC1111, Forge and SD.Next.
	 *
	 * Image only, and no text of any kind: `/sdapi/v1/txt2img` is the whole
	 * surface. A connection of this type pointed at a text node fails at bind
	 * rather than at the request, which is the point of declaring the absence.
	 *
	 * ⚠ txt2img and NOTHING ELSE — `text+image->image` and `image->image` are
	 * gone, and their removal is the plainest example of what this file was for.
	 * They were declared `"native"` here while `A1111Adapter` did
	 * `t.take("init", req.init, false)` and its own profile said
	 * `img2img: false`, and the comment eight entries below already admitted
	 * "A1111Adapter is txt2img-only (it declares `init` unsupported)". Three
	 * places in one file, two of them saying the opposite of the third, and
	 * nothing noticed. Both keys come back the day something implements
	 * `editImage` — `/sdapi/v1/img2img` is a different route, so it is a
	 * different method — and `image->image` is DECLARED against that method
	 * rather than derived, because it is the same route with the prompt left off.
	 */
	[CONNECTION_TYPE.A1111]: {
		id: CONNECTION_TYPE.A1111,
		capabilities: {
			supports: {
				"text->image": "native"
			},
			defaults: ["text->image"]
		}
	},

	/**
	 * An image connection by construction, which is why it needs no probe.
	 *
	 * KOBOLDCPP declares text->image as `probed`, because it points at somebody
	 * else's instance and whether that process can draw depends on what they
	 * loaded. KOBOLDCPP_MANAGED declares it NOWHERE AT ALL — see its entry above,
	 * where the key is absent from `supports` on purpose: a key the adapter does
	 * not declare can never appear, whatever any other layer says, and that
	 * asymmetry is the structural half of stopping a managed LLM connection from
	 * turning up in the image picker. Do not "restore" it. This type names an
	 * image model in `connection.model` and the Manager loads it on demand, so the
	 * answer is known before anything is running — which is what dissolves the
	 * refused→never-loaded→never-probed cycle that imageCapability.ts existed to
	 * break.
	 *
	 * One transform and no more, which is now the same set A1111 itself has: this
	 * type re-exports `A1111Adapter` unchanged, that class is txt2img-only, and
	 * both entries are derived from it rather than each maintained by hand. The
	 * older note here — that claiming `image->image` would refuse at request time
	 * instead of at bind time — was right, and is why the A1111 entry above lost
	 * the two keys it should never have had.
	 */
	[CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE]: {
		id: CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE,
		capabilities: {
			supports: {
				"text->image": "native"
			},
			defaults: ["text->image"]
		}
	},

	/**
	 * The three embedding formats, and the one key they each declare.
	 *
	 * ## Why entries exist for them at all now
	 *
	 * ⚠ **Every type a star can name needs an entry here.** The embedding star
	 * is a `connection_defaults` row like any other, so `connections:setDefault`
	 * judges the row with `capabilityRefusal`, and `capabilityRefusal` can grant
	 * nothing to a type the manifest does not describe. An embedding type with
	 * no entry is an endpoint nobody can register.
	 *
	 * ## `native` and nothing else
	 *
	 * One transform apiece, matching the one action each module implements. No
	 * features: `ACTION_FEATURES.embedText` is `[]` — an embedding request has no
	 * response format to constrain, no tools, and nothing to stream — and the
	 * conformance test refuses a feature declared against an action that cannot
	 * carry it.
	 *
	 * No `unproven` either, unlike KOBOLDCPP's image key. The question "can this
	 * wire format embed" is answered by the format itself in all three cases: an
	 * `/embeddings` route either exists or the connection test fails, and there
	 * is no per-instance state (a loaded checkpoint, an enabled module) the
	 * declaration would be guessing about.
	 */
	[CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS]: {
		id: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
		capabilities: {
			supports: {
				"text->embedding": "native"
			},
			defaults: ["text->embedding"]
		}
	},

	[CONNECTION_TYPE.OPENAI_EMBEDDINGS]: {
		id: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
		capabilities: {
			supports: {
				"text->embedding": "native"
			},
			defaults: ["text->embedding"]
		}
	},

	[CONNECTION_TYPE.OLLAMA_EMBEDDINGS]: {
		id: CONNECTION_TYPE.OLLAMA_EMBEDDINGS,
		capabilities: {
			supports: {
				"text->embedding": "native"
			},
			defaults: ["text->embedding"]
		}
	},

	/**
	 * The entity model runs in this process, so what it can do is a property of
	 * the build rather than of a host: `native`, unconditionally, with no probe
	 * to add anything. Whether `onnxruntime-node` loads on THIS machine is a
	 * different question and is the connection's Test button's, not this table's.
	 */
	[CONNECTION_TYPE.LOCAL_ONNX_NER]: {
		id: CONNECTION_TYPE.LOCAL_ONNX_NER,
		capabilities: {
			supports: {
				"text->entities": "native"
			},
			defaults: ["text->entities"]
		}
	}
}

/**
 * What a named service adds to, or takes away from, its API format.
 *
 * Keyed by preset slug. Absent means "the adapter's own defaults", which is the
 * right answer for a custom endpoint — and is why the `preset` column is left
 * NULL rather than guessed from a base URL.
 *
 * `true` is an assertion: the preset names a specific service and therefore
 * knows more than the generic protocol does, so it resolves at full strength
 * rather than inheriting the adapter's pessimistic `until`.
 */
export const PRESET_CAPABILITIES: Record<
	string,
	Partial<Record<string, boolean>>
> = {
	// Reaching Claude through an OpenAI-compatible endpoint: vision works, so the
	// preset asserts it rather than leaving it probed.
	//
	// This used to carry `"text->image": false` as the worked example of the
	// adapter-gate-versus-preset-default distinction — the toggle existing here
	// and being off, versus not existing at all on the native Anthropic type.
	// That key is gone because OPENAI no longer declares `text->image` for
	// anyone (see its entry: nothing implements `generateImage` for that type),
	// and a preset key the adapter does not declare is inert — `resolveCapabilities`
	// iterates `supports`, so it would have been a line that looked like it did
	// something. The distinction it illustrated is alive in `json_schema`, one
	// line down: OPENAI declares it probed and a preset may assert it, while
	// the native ANTHROPIC entry does not declare it at all and no preset can.
	anthropic: { "text+image->text": true },

	"openai-official": {
		"text+image->text": true,
		/**
		 * Chat only — a KNOWN TRUTH about the service, recorded at the layer that
		 * can hold one.
		 *
		 * The OPENAI entry declares `wire_completion` because the FORMAT can
		 * express it (see there: pre-rendering one flat prompt into a single user
		 * turn is an ordinary chat request and works against every compatible
		 * endpoint). Whether it is a sensible way to call a *particular* service is
		 * exactly what a preset knows and the generic protocol does not, and for
		 * OpenAI's own API it is not: the models are chat-tuned, the app's own
		 * default has always been off, and a Vicuna-wrapped blob in one user turn
		 * is a worse prompt than the turns it was built from.
		 *
		 * A DEFAULT and not a gate. Somebody who knows better switches it on by
		 * hand and that override outranks this line, which is the sentence the
		 * capability panel already promises. The gate — the thing no layer can
		 * reach past — is the native ANTHROPIC entry, which declares no
		 * `wire_completion` at all because the Messages API has no field for one.
		 */
		wire_completion: false,
		// No `"text->image": true`. This was the LAYER that turned OPENAI's
		// probed key into a resolved `native` — which cleared the bind guard and
		// let an image slot accept a connection with no image adapter behind it.
		// Removing the key from `supports` alone would have left this line inert
		// but still readable as an intent somebody would later try to honour.
		json_schema: true,
		strict_schema: true
	},
	openrouter: { "text+image->text": true, json_schema: true },
	"google-gemini": { "text+image->text": true, json_schema: true },
	groq: { json_schema: true },
	"together-ai": { json_schema: true },
	"mistral-ai": { json_schema: true },
	deepseek: { json_object: true },
	// The local OpenAI-compatible servers: schema support varies by build, so
	// the loose mode stays on and the strict one stays off until probed.
	"local-ai": { json_schema: false },
	vllm: { json_schema: true },
	sglang: { json_schema: true },
	"aphrodite-engine": { json_schema: true },
	"text-generation-webui": { json_schema: false }
}

/** What a connection type can express, or `undefined` for one nobody declared. */
export const adapterCapabilities = (
	type: string
): AdapterCapabilities | undefined => ADAPTER_MANIFEST[type]?.capabilities

/**
 * The declared file counts, byte caps and format lists for a connection type.
 *
 * `undefined` for a type with no block, which every reader must treat as "no
 * known limit" rather than as "no files allowed" — see `./io`, where that rule
 * is implemented once in `withinCap` so no call site has to remember it. Both
 * adapter base classes resolve their own limits through this, and
 * `$lib/server/adapters/attachments` is where they are enforced.
 */
export const adapterIo = (type: string): AdapterIo | undefined =>
	ADAPTER_MANIFEST[type]?.io
