/**
 * The net under the derivation: `ADAPTER_MANIFEST` must say exactly what the
 * adapter classes actually implement.
 *
 * `manifest.ts` is a CACHE — of "which named actions do this type's modules
 * define", the way `connections.capabilities.resolved` is a cache of the four
 * resolution layers. A cache with no check is a second source of truth, and this
 * one had already drifted in both directions before anybody wrote this file:
 * OPENAI_CHAT declared `text->image` with no image module registered for it at
 * all (an image slot bound the connection, then `getImageAdapter` threw minutes
 * later), and A1111 declared `text+image->image` and `image->image` while
 * `A1111Adapter` reported `img2img: false` and dropped `init` on the floor. Three
 * statements in two files, two of them contradicting the third, and nothing
 * noticed for a release.
 *
 * So this walks `ADAPTER_REGISTRY` — the SAME map both loaders use, which is why
 * it is a map rather than two `switch` statements — loads every module, reads
 * which actions each class defines, and asserts set equality against what the
 * manifest declares. A hand edit that disagrees fails `npm test` before merge,
 * naming the type, the method and the capability id.
 *
 * ## ⚠ THIS FILE IS THE ONE SANCTIONED PLACE THAT LOADS ADAPTER MODULES EAGERLY
 *
 * Awaiting every thunk pulls the whole adapter graph into the process —
 * `@lmstudio/sdk` included, which is the exact module the lazy `import()`
 * architecture exists to keep out of it. That SDK uses `\p{Lu}` regex property
 * escapes that fail to PARSE under nodejs-mobile's build of V8, so anything that
 * reaches it from a module in the startup or client graph crashes server boot on
 * Android — before a line of app code runs, whether or not the user has ever
 * configured LM Studio. A test process on Linux CI is the one context where
 * loading it is harmless, so the eager load lives here and nowhere else.
 *
 * Which means: **do not lift the loading loop below into a shared helper.** The
 * moment it is importable, something at runtime imports it, and the crash lands
 * on a platform CI does not run. `adapters/importBoundary.test.ts` enforces that
 * mechanically — it is the reason a second eager site cannot appear quietly — but
 * it can only fail a build, not explain why, which is what this paragraph is for.
 *
 * ## What is NOT asserted here, deliberately
 *
 * The GRADES. `supports` values are a band name, a grade, or
 * `{unproven: true, until}`, and no method carries which: `tools: "emulated"` is
 * a claim about what Serene Pub supplies over a backend that never heard of
 * tools, and `{unproven: true}` is a claim about what nobody has asked yet.
 * KoboldCPP is the case that proves both halves are load-bearing —
 * `generateImage` genuinely is implemented for it (the registry maps it to
 * `A1111Adapter` as well as `KoboldCppAdapter`, so the KEY is derived), while
 * whether that external process has an SD model loaded is per-instance, so the
 * VALUE stays unproven. A test that flattened the grade to a boolean would
 * delete real information and then enforce the deletion.
 *
 * What IS asserted about the values is only that they are SAYABLE: every one
 * resolves onto its own capability's band scale. `gradeOf` clamps silently
 * because it is pure and runs at boot, so without this a `tools: 3` or a
 * `"text->image": "emulated"` would be quietly rounded to something adjacent
 * rather than reported — a declaration that reads as one thing and resolves as
 * another, which is the entire failure class this file exists for.
 */

import { beforeAll, describe, expect, test } from "vitest"
import {
	ADAPTER_REGISTRY,
	REGISTERED_CONNECTION_TYPES
} from "$lib/server/adapters/registry"
import { actionsOf } from "$lib/server/adapters/actions"
import { BaseConnectionAdapter } from "$lib/server/connectionAdapters/BaseConnectionAdapter"
import { BaseImageAdapter } from "$lib/server/imageAdapters/BaseImageAdapter"
import {
	ADAPTER_MANIFEST,
	adapterCapabilities
} from "$lib/shared/connectionAdapters/manifest"
import {
	ACTION_FEATURES,
	ACTION_NAMES,
	ACTION_TRANSFORM,
	HOSTED_BY,
	isActionTransformId,
	type ActionName
} from "$lib/shared/connectionAdapters/actions"
import {
	bandsFor,
	gradeOf,
	isTransformId,
	topGrade,
	type CapabilityId,
	type Declared,
	type GradeSpec
} from "@serene-pub/sdk"

/** `text->image` → `generateImage`, for a failure message that names the method. */
const METHOD_FOR = Object.fromEntries(
	Object.entries(ACTION_TRANSFORM).map(([action, id]) => [id, action])
) as Record<string, ActionName>

/**
 * Which actions the modules registered for each type define, between them.
 *
 * A type's action set is the UNION across its modules, which is the whole reason
 * the two adapter families never had to be merged: KOBOLDCPP has a text module
 * and an image one, `KoboldCppAdapter.generateText` and `A1111Adapter.generateImage`
 * cannot collide, and the type derives `{text->text, text->image}` between them.
 *
 * ## Loaded once, in `beforeAll`, with an explicit timeout
 *
 * Not an optimisation — a correctness fix for the test itself. Loading these
 * transitively builds a database: `OpenAIChatAdapter` imports `tokenCrypto`,
 * which imports `$lib/server/db`, which migrates a fresh PGlite instance on
 * import. Inside a `test` that runs against the default 5s budget and fails as a
 * TIMEOUT — a red test that says nothing about the manifest and reads as a flake
 * under load rather than as the budget it actually is. Paying it once in a hook
 * with a stated timeout makes the per-type assertions pure comparisons that
 * cannot time out, and means the migration runs once rather than nine times.
 */
const IMPLEMENTED = new Map<string, Set<ActionName>>()

/** Generous on purpose: a cold PGlite migration under a loaded CI box is slow. */
const LOAD_TIMEOUT_MS = 60_000

beforeAll(async () => {
	for (const type of REGISTERED_CONNECTION_TYPES) {
		const modules = ADAPTER_REGISTRY[type]
		const found = new Set<ActionName>()
		// The stop class differs per family and matters: the walk halts BEFORE the
		// base prototype, so `KoboldCppManagedAdapter`'s INHERITED `generateText`
		// counts as real capability (it extends KoboldCppAdapter and genuinely
		// generates text) while an `abstract` or `declare`d base member — both of
		// which emit nothing — never does.
		if (modules?.text)
			for (const a of actionsOf(
				(await modules.text()).Adapter,
				BaseConnectionAdapter
			))
				found.add(a)
		if (modules?.image)
			for (const a of actionsOf(
				(await modules.image()).Adapter,
				BaseImageAdapter
			))
				found.add(a)
		IMPLEMENTED.set(type, found)
	}
}, LOAD_TIMEOUT_MS)

const implementedActions = (type: string): Set<ActionName> =>
	IMPLEMENTED.get(type) ?? new Set<ActionName>()

/** The transform ids a manifest entry declares that a METHOD is supposed to prove. */
const declaredActionIds = (type: string): Set<string> =>
	new Set(
		Object.keys(adapterCapabilities(type)?.supports ?? {}).filter(
			isActionTransformId
		)
	)

const sorted = (ids: Iterable<string>) => [...ids].sort()

describe("the manifest is a checked cache of what the adapters implement", () => {
	// One test per type rather than one over all nine: a failure names the
	// connection type in its own title, so the report says which backend drifted
	// without anybody reading the diff.
	for (const type of REGISTERED_CONNECTION_TYPES) {
		test(`${type} declares exactly the transforms its modules implement`, () => {
			const actions = implementedActions(type)
			const derived = new Set(
				[...actions].map((a) => ACTION_TRANSFORM[a] as string)
			)
			const declared = declaredActionIds(type)

			// Built as sentences rather than asserted as two sets, because the
			// useful part of this failure is WHICH DIRECTION it drifted in: a
			// missing key and a missing method are opposite bugs with opposite
			// fixes, and a set diff makes the reader work that out.
			const problems: string[] = []
			for (const id of derived)
				if (!declared.has(id))
					problems.push(
						`${type}: ${METHOD_FOR[id]}() is implemented, but ADAPTER_MANIFEST does not declare "${id}". ` +
							`Add the key with the grade this backend actually offers, or remove the method.`
					)
			for (const id of declared)
				if (!derived.has(id))
					problems.push(
						`${type}: ADAPTER_MANIFEST declares "${id}", but no module registered for this type implements ${METHOD_FOR[id]}(). ` +
							`That is a capability the picker will offer and the loader cannot serve — implement the action or drop the key.`
					)
			expect(problems).toEqual([])
			// The set comparison as well, so a diff is printed when the sentences
			// above are what a reader skims past.
			expect(sorted(declared)).toEqual(sorted(derived))
		})

		test(`${type}'s declared extensions have the action that carries them`, () => {
			// A hosted extension is the SAME wire route with richer parts —
			// `text+image->text` is `/v1/chat/completions` with image parts in the
			// message array, which is why it is declared rather than derived (it is
			// per-MODEL, not per-format). But it still rides inside a call, so
			// declaring one without the call is a capability with no method behind
			// it, which is the same undeliverable-key bug wearing a different hat.
			const actions = implementedActions(type)
			const supports = adapterCapabilities(type)?.supports ?? {}
			const problems: string[] = []
			for (const id of Object.keys(supports)) {
				if (!isTransformId(id) || isActionTransformId(id)) continue
				const host = (HOSTED_BY as Record<string, ActionName>)[id]
				if (!host)
					problems.push(
						`${type}: "${id}" is declared but is neither an action transform nor a hosted extension. ` +
							`File it in ACTION_TRANSFORM or HOSTED_BY (shared/connectionAdapters/actions.ts) — an id in neither can never be granted.`
					)
				else if (!actions.has(host))
					problems.push(
						`${type}: "${id}" is declared, but its host action ${host}() is not implemented for this type. ` +
							`An extension rides inside a call; without the call there is nothing to extend.`
					)
			}
			expect(problems).toEqual([])
		})

		test(`${type}'s declared features belong to an action it implements`, () => {
			// Features (`json_object`, `tools`, `streaming`, …) are qualifiers on a
			// request, not actions — `json_schema` is a FIELD on the request
			// `generateText` already takes, so no method presence can derive one and
			// they stay declared. The gate is what is new: nothing can declare
			// `tools` on an image-only adapter, where there is no request for it to
			// qualify and no code path that would ever read it.
			const actions = implementedActions(type)
			const carriable = new Set<string>()
			for (const action of actions)
				for (const feature of ACTION_FEATURES[action])
					carriable.add(feature)

			const supports = adapterCapabilities(type)?.supports ?? {}
			const orphans = Object.keys(supports).filter(
				(id) => !isTransformId(id) && !carriable.has(id)
			)
			expect(
				orphans,
				`${type} declares ${orphans.join(", ")}, which none of its implemented actions (${[...actions].join(", ") || "none"}) can carry.`
			).toEqual([])
		})

		test(`${type}'s declared grades are sayable on their own scales`, () => {
			// `gradeOf` is pure, total and clamping — it has to be, because it runs
			// during resolution at boot and throwing there would take the server
			// with it. The cost of that is silence: a declaration one band or one
			// integer out resolves to something ADJACENT instead of failing, so the
			// manifest would say one thing and every reader would see another.
			// Checking it here is what turns that silence into a build failure.
			//
			// Both halves matter. A number past the top is the typo grades invite
			// (`tools: 3`); a band the capability does not HAVE is the typo band
			// names invite (`"text->image": "emulated"` — an emulated picture,
			// which resolves to 0 and switches the capability off entirely).
			const supports = adapterCapabilities(type)?.supports ?? {}
			const problems: string[] = []
			const check = (
				id: CapabilityId,
				spec: GradeSpec,
				where: string
			) => {
				const top = topGrade(id)
				if (gradeOf(id, spec) === 0 && spec !== 0 && spec !== "none")
					problems.push(
						`${type}: ${where} "${id}" as ${JSON.stringify(spec)}, which resolves to 0 — off. ` +
							`Its bands are [${bandsFor(id).join(", ")}], so that is not something this capability can be.`
					)
				else if (typeof spec === "number" && (spec < 0 || spec > top))
					problems.push(
						`${type}: ${where} "${id}" as grade ${spec}, but its scale is 0..${top} ([${bandsFor(id).join(", ")}]). ` +
							`gradeOf clamps it, so the declaration and the resolution disagree.`
					)
			}
			for (const [key, declared] of Object.entries(supports)) {
				const id = key as CapabilityId
				const d = declared as Declared
				if (typeof d === "object" && d !== null)
					check(id, d.until, "declares unproven")
				else check(id, d, "declares")
			}
			expect(problems).toEqual([])
		})
	}
})

describe("the registry and the manifest describe the same set of types", () => {
	test("every type with an adapter module has a manifest entry", () => {
		// Without one, `adapterCapabilities` returns undefined, the capability
		// panel renders "nothing is declared for this connection type", and every
		// bind falls through to the transitional modality test. The adapter works
		// and the app cannot say what it does.
		const undeclared = REGISTERED_CONNECTION_TYPES.filter(
			(t) => !adapterCapabilities(t)
		)
		expect(undeclared).toEqual([])
	})

	test("every manifest entry has at least one adapter module", () => {
		// The other direction, and the sharper one: an entry with no module is a
		// list of capabilities nothing can deliver, which is exactly the OPENAI_CHAT
		// `text->image` failure generalised.
		const unbacked = Object.keys(ADAPTER_MANIFEST).filter(
			(t) => !ADAPTER_REGISTRY[t]
		)
		expect(unbacked).toEqual([])
	})
})

describe("the action vocabulary itself", () => {
	test("no two actions derive the same transform", () => {
		// `satisfies Record<ActionName, KnownTransformId>` pins one transform per
		// action but cannot see a DUPLICATE VALUE. Two actions mapping to one key
		// would make the derived set unable to say which method actually exists,
		// and every assertion above would keep passing while meaning less.
		const ids = Object.values(ACTION_TRANSFORM)
		expect(new Set(ids).size).toBe(ids.length)
	})

	test("no transform is both derived from a method and hosted by one", () => {
		// The runtime twin of `_NoTransformIsFiledTwice`. The compile-time version
		// is the real guard; this one survives a `// @ts-expect-error` and reads in
		// the failure output.
		const both = Object.keys(HOSTED_BY).filter(isActionTransformId)
		expect(both).toEqual([])
	})

	test("every action name maps to a transform and a feature list", () => {
		for (const name of ACTION_NAMES) {
			expect(ACTION_TRANSFORM[name]).toBeTruthy()
			expect(Array.isArray(ACTION_FEATURES[name])).toBe(true)
		}
	})
})

describe("the base classes stay empty of action bodies", () => {
	// Both guards below are for failures that are SILENT: the derivation still
	// runs, every test above still passes, and every answer it gives is wrong in
	// the same direction for every adapter at once.

	test("no base prototype carries an action — not even a throwing stub", () => {
		// A stub on a base prototype puts the method on EVERY subclass, so every
		// type would derive every transform. `actionsOf` stops before the base
		// prototype precisely so this cannot happen, but the stop is a belt to this
		// test's braces: with a body present the walk reports the action ABSENT
		// everywhere instead, which is the opposite wrong answer and just as quiet.
		for (const name of ACTION_NAMES) {
			expect(
				Object.prototype.hasOwnProperty.call(
					BaseConnectionAdapter.prototype,
					name
				),
				`BaseConnectionAdapter.prototype defines ${name}. Actions on a base class are declared (abstract or \`declare\`) and never defined.`
			).toBe(false)
			expect(
				Object.prototype.hasOwnProperty.call(
					BaseImageAdapter.prototype,
					name
				),
				`BaseImageAdapter.prototype defines ${name}. Actions on a base class are declared (abstract or \`declare\`) and never defined.`
			).toBe(false)
		}
	})

	test("a declared action emits no class field that would shadow a subclass method", () => {
		// ⚠ THE TRAP, reproduced through the real compiler rather than trusted.
		// `useDefineForClassFields` is unset with `target:"esnext"` in
		// `.svelte-kit/tsconfig.json`, so it DEFAULTS TO TRUE: writing
		// `editImage?: AdapterActions["editImage"]` instead of
		// `declare editImage?: ...` emits `editImage;` — an OWN property of
		// `undefined` on every instance, shadowing the prototype method of every
		// subclass that implements it. Type-checking stays perfectly clean and
		// every action reads as unimplemented at runtime.
		//
		// Instances rather than prototypes, because that is where a class field
		// lands. The subclasses are local and minimal so this tests the BASE
		// classes' declarations and nothing else.
		class ImageProbe extends BaseImageAdapter {
			async generateImage() {
				return null as any
			}
		}
		class TextProbe extends BaseConnectionAdapter {
			async generateText() {
				return null as any
			}
		}
		const image = new ImageProbe({} as any)
		const text = new TextProbe({ session: {}, promptConfig: {} } as any)

		for (const name of ACTION_NAMES) {
			const own = (o: object) =>
				Object.prototype.hasOwnProperty.call(o, name)
			const note = `${name} is an own property of an adapter instance. A base-class action must be declared with \`declare\` (or \`abstract\`), which emits nothing — a plain optional property emits a field that shadows every subclass's method.`
			if (name !== "generateImage") expect(own(image), note).toBe(false)
			if (name !== "generateText") expect(own(text), note).toBe(false)
		}
	})
})

describe("what a capability id means is fixed by the action, not the adapter", () => {
	test("every derived capability id is one the SDK names", () => {
		// The signatures are pinned at compile time (`AdapterActions` is the one
		// place any of them is written). What this adds is that the KEY a method
		// derives is a real capability id and not a string only this repo believes
		// in: an id the SDK does not name renders as its own raw address in the
		// capability panel — `text->embedding` where a person should read
		// "Embeddings" — which is the visible half of the same mistake.
		for (const type of REGISTERED_CONNECTION_TYPES) {
			for (const action of implementedActions(type)) {
				const id = ACTION_TRANSFORM[action] as CapabilityId
				expect(isTransformId(id)).toBe(true)
			}
		}
	})
})
