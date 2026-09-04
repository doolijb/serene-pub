/**
 * The ACTION vocabulary — the closed list of things an adapter can be asked to
 * do, and the one capability each of them proves.
 *
 * ## Why this file exists
 *
 * What an API accepts in and returns out should be readable off the code that
 * expresses it, not asserted separately in a table that is free to disagree with
 * it. Before this, `BaseConnectionAdapter` declared a single
 * `abstract generate()` whose meaning was whatever the subclass made of it —
 * one name, seven contracts — and `manifest.ts` declared the transforms by hand
 * beside it. Two spellings of one fact, and they had drifted: OPENAI_CHAT
 * claimed `text->image` with no image adapter behind it at all.
 *
 * So the actions are named and individually typed, and this table says which
 * capability each name proves. **A method's PRESENCE supplies the key; the
 * manifest supplies the VALUE.** Both halves are load-bearing and neither
 * replaces the other — see "What presence does and does not say" below.
 *
 * ## The rule that makes the derivation sound
 *
 * ⚠ **An action's signature belongs to the ACTION, not to the adapter.**
 * `generateImage` takes the same request and returns the same result on every
 * adapter that implements it; no subclass may repurpose it to deliver a
 * different kind. That is not style — it is the entire justification for reading
 * capabilities off method presence. If a subclass could decide what its method
 * returned, "implements `generateText`" would say nothing about in and out and
 * the inference would be unsound. The signatures therefore live in exactly one
 * place, `$lib/server/adapters/actions.ts`, and every base class takes its
 * members from there.
 *
 * A corollary worth stating because it is the shape people reach for: the list
 * below is a set of DISTINCT methods, not one method with a `kind` parameter and
 * not a generic `run(kind, payload)`. A mode parameter would put the in/out
 * kinds back inside the call, where nothing can read them off the class.
 *
 * ## What presence does and does not say
 *
 * Presence answers "can this API express this at all" — the KEY SPACE, which
 * `AdapterCapabilities.supports` gates absolutely. It cannot answer at what
 * GRADE: `tools: "emulated"` is a claim about what Serene Pub supplies over a
 * backend that never heard of tools, and `{unproven: true, until: "none"}` is a
 * claim about what nobody has asked yet. No method carries either. KoboldCPP is
 * the proof both halves matter: it maps to `A1111Adapter` for images, so
 * `generateImage` is present and the key is derived — while whether that
 * particular external process has an SD model loaded is a per-instance question,
 * so the value stays unproven.
 *
 * ## Client-safe, deliberately
 *
 * Only the SDK is imported here, and no adapter module is reachable from this
 * file. `capabilityRows.ts` renders in the browser, and `@lmstudio/sdk` uses
 * `\p{Lu}` regex property escapes that fail to PARSE under nodejs-mobile's V8 —
 * a static import of it crashes server boot on Android. The manifest, the
 * capability panel and the conformance test all read THIS table; only the
 * conformance test ever reads an adapter class.
 */

import {
	FEATURES,
	type FeatureId,
	type KnownTransformId
} from "@serene-pub/sdk"

/**
 * Every action an adapter may implement.
 *
 * Closed on purpose, and defined ahead of the implementations. Naming
 * `synthesizeSpeech` before anything speaks costs nothing and is what stops the
 * next backend arriving with `doTts()` beside somebody else's `textToSpeech()`
 * — at which point neither name means anything derivable.
 */
export type ActionName =
	| "generateText"
	| "generateImage"
	| "editImage"
	| "embedText"
	| "transcribeAudio"
	| "synthesizeSpeech"

/**
 * The ONE transform each action's presence derives. Exactly one per action.
 *
 * Read it in both directions:
 *
 *   - `generateText` present  ⇒ `text->text` is in the key space.
 *   - `text->text` in the key space ⇒ some module for that type implements
 *     `generateText`, or CI fails.
 *
 * An action a class does NOT implement is a STATEMENT, not an omission: the
 * capability panel renders no row for it, the picker never offers the
 * connection for a slot needing it, and a bind that asks for it is refused with
 * a sentence naming the capability. That is why a stub — even a throwing one —
 * must never be added to a base class: it would put the method on every
 * prototype and turn every statement back into a lie.
 *
 * ⚠ The map must stay INJECTIVE (no two actions deriving the same transform).
 * `Record<ActionName, KnownTransformId>` pins one transform per action but
 * cannot see a duplicate value; the conformance test checks it, because two
 * actions deriving one key would make the derived set unable to distinguish
 * which method actually exists.
 */
export const ACTION_TRANSFORM = {
	/** Write a reply. The only action any text adapter is required to have. */
	generateText: "text->text",
	/** Draw from a description. `/sdapi/v1/txt2img` and its equivalents. */
	generateImage: "text->image",
	/** Change a picture that was handed in. A DIFFERENT endpoint (`img2img`). */
	editImage: "text+image->image",
	/** Turn text into vectors. Batched in, batched out — every backend batches. */
	embedText: "text->embedding",
	/** Speech in, text out. */
	transcribeAudio: "audio->text",
	/** Text in, speech out. */
	synthesizeSpeech: "text->audio"
} as const satisfies Record<ActionName, KnownTransformId>

/**
 * Transforms that are NOT actions: the same wire route, a richer request.
 *
 * Declared in the manifest as they always were, and gated on their HOST action
 * being implemented — a type cannot claim vision without implementing the text
 * generation the image parts ride inside.
 *
 * ## The rule, so the next backend can be judged without arguing
 *
 * **A different ROUTE is a different method; the same route with richer parts is
 * a declaration.**
 *
 * Vision is `/v1/chat/completions` with image parts in the message array — the
 * same `generateText` call, the same return type, one extra kind of content. It
 * is also per-MODEL rather than per-format (OLLAMA probes it off
 * `details.families` from a `list()` it already makes), so deriving it from a
 * class would not merely be unavailable, it would be actively WRONG: the class
 * is the same whichever model is loaded. img2img is `/sdapi/v1/img2img` — a
 * different endpoint, a different request body, and declared `native` wherever
 * it is declared at all, because a server either has that route or does not.
 *
 * `image->image` is the odd one: same route as `editImage`, prompt simply
 * omitted. Same method, so it is hosted rather than an action of its own.
 */
export const HOSTED_BY = {
	/** Images in the message array. Per-model, so probed, never derived. */
	"text+image->text": "generateText",
	/** Documents in the message array. Same call, same shape. */
	"text+document->text": "generateText",
	/** img2img with the prompt left off. `editImage`'s route, minus a field. */
	"image->image": "editImage"
} as const satisfies Partial<Record<KnownTransformId, ActionName>>

/**
 * Which FEATURES an action may be declared to qualify.
 *
 * Features (`json_object`, `json_schema`, `strict_schema`, `grammar`, `tools`,
 * `streaming`) are qualifiers on a request, not separate actions — `json_schema`
 * is a FIELD on the request `generateText` already takes, so there is no method
 * whose presence could derive it and none should be invented. They stay
 * declared, and they already have their own one-fact derivation from data: the
 * SDK's `closure()` grows them out of `EMULATABLE_VIA` and `IMPLIES` rather than
 * from seven adapters each remembering to list the weaker forms.
 *
 * What is new is only the GATE: a feature may be declared for a type only if
 * that type implements an action which can carry it. Nothing can declare `tools`
 * on an image-only adapter any more, which is the same structural protection the
 * transform half gets.
 */
export const ACTION_FEATURES = {
	/** All six. Every feature in the SDK's vocabulary constrains a text reply. */
	generateText: FEATURES,
	// The rest carry none — and this is a statement, not a stub. A render has no
	// response format to constrain and no tool loop to run; a feature declared
	// against one would have nowhere to be applied.
	generateImage: [],
	editImage: [],
	embedText: [],
	transcribeAudio: [],
	synthesizeSpeech: []
} as const satisfies Record<ActionName, readonly FeatureId[]>

/** Every action name, in declaration order. */
export const ACTION_NAMES = Object.keys(ACTION_TRANSFORM) as ActionName[]

/**
 * The transform ids that are DERIVED from a method, as a set.
 *
 * The conformance test compares only these against a manifest entry: a hosted
 * extension (`text+image->text`) and a feature (`tools`) are declared, so
 * including them in the comparison would demand a method that must not exist.
 */
export const ACTION_TRANSFORM_IDS: ReadonlySet<string> = new Set<string>(
	Object.values(ACTION_TRANSFORM)
)

/** Is this id one a method derives, as opposed to one the manifest asserts? */
export const isActionTransformId = (id: string): boolean =>
	ACTION_TRANSFORM_IDS.has(id)

// ── Compile-time exhaustiveness ─────────────────────────────────────────────

/**
 * Every transform the SDK names is filed as exactly one of the two: an ACTION
 * (a method derives it) or an EXTENSION (a host action carries it).
 *
 * Adding a transform to the SDK without filing it here is then a type error
 * rather than a capability that silently exists in `TRANSFORMS`, renders a label
 * in the panel, and can never be granted because nothing derives or hosts it.
 * The failure names the unfiled id, which is the whole point of writing it this
 * way rather than as a boolean.
 */
type AssertNever<T extends never> = T
type DerivedTransformId = (typeof ACTION_TRANSFORM)[ActionName]
type HostedTransformId = keyof typeof HOSTED_BY

/** Fails naming any `TRANSFORMS` id that is neither an action nor an extension. */
type _EveryTransformIsFiled = AssertNever<
	Exclude<KnownTransformId, DerivedTransformId | HostedTransformId>
>
/** Fails naming any id filed as BOTH — one fact, one spelling. */
type _NoTransformIsFiledTwice = AssertNever<
	Extract<DerivedTransformId, HostedTransformId>
>

// Both aliases are unreferenced on purpose: a type alias whose CONSTRAINT is
// violated is an error at its declaration, so it needs no use site. Deleting
// either one as "dead code" removes a check, not a line.
export type { _EveryTransformIsFiled, _NoTransformIsFiledTwice }
