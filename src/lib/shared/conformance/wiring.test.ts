/**
 * Every declared thing has both ends.
 *
 * This codebase declares a great deal — ports, capability slugs, executor
 * options, socket events — and its recurring failure is not a *wrong*
 * declaration. Types catch those. It is a declaration with **nothing on the
 * other end**: something that reads as a working feature at every site that
 * forwards it, and is dead because nobody ever produces into it, offers it, or
 * passes it. Nothing fails. The branch is simply never taken.
 *
 * Three instances, all live in this repo within one week, none caught by types,
 * tests or runtime:
 *
 *   1. **`attachments`** — the `generate-text` in-port is declared in contracts,
 *      forwarded by `bindings.ts`, forwarded by `host.ts`, resolved with an
 *      access check by `dispatch.ts`, enforced by the limits engine and consumed
 *      by `AnthropicAdapter`. Six modules of correct plumbing, and no pipeline
 *      core ships ever puts a value in it.
 *   2. **`cancelSignal`** — the SDK executor reads it between nodes and the app
 *      passed it nowhere; zero occurrences in `src/`. Cancelling a run never
 *      stopped the graph. (It is wired now. This file is what makes sure it
 *      stays wired, and it needs no allowlist entry to pass.)
 *   3. **`PRESET_CAPABILITIES.anthropic`** — a real capability assertion keyed
 *      to a preset slug no preset offers, so nothing can ever set it.
 *   4. **`ExtensionStorage`** (§5, the largest of them) — the SDK typed every
 *      hook's `ctx.storage` as a quota-reporting row store with a `files`
 *      namespace, and the runtime endowed a file store with six different
 *      methods. Zero occurrences in `src/`. Eighteen of the twenty-one members
 *      the hook surfaces declare were endowed by nothing, and two of them were
 *      `@deprecated` in favour of members that did not exist either — an SDK
 *      directing authors away from what works and towards what is not there.
 *      (Fourteen of the eighteen are wired now: rows live in `plugin_rows`,
 *      `files.*` is the same transactional store under the SDK's spelling, and
 *      the deprecation tags point somewhere real. A fifteenth, `readEvent`, was
 *      closed the other way — deleted, because the payload had always arrived
 *      as argument 0 and the SDK moved to the `(input, ctx)` convention both
 *      backends actually call. `readCore` and the two deprecated `*OwnRows`
 *      members are still declared and still endowed by nothing, and their
 *      entries below say so.)
 *
 * ## The allowlist is the point, not the escape hatch
 *
 * A declaration may legitimately arrive before its other end — an `img2img`
 * port waiting for a spec that uses it, a slug held for a planned
 * normalization. That is fine. **The fix is that it says so.** So every
 * allowlist entry below carries a reason, and the reason is part of what this
 * file asserts: "declared, deliberately not wired yet, because X."
 *
 * And every list is checked in BOTH directions. An entry whose subject has
 * since been wired **fails**, naming the entry to delete. Without that, the
 * first person to finish the wiring leaves the excuse behind, the next reader
 * believes it, and the file decays into decoration that passes forever.
 *
 * This follows the pattern `ADAPTER_MANIFEST` already uses for a deliberate
 * absence — `KOBOLDCPP_MANAGED`'s missing `text->image` is defended by
 * `manifest.conformance.test.ts` rather than by the comment beside it, because
 * a comment cannot fail a build. The comments at the declaration sites stay;
 * this is what makes them true.
 *
 * ## What is NOT checked, and why
 *
 * Stated here rather than left as a silence, because an unstated exclusion is
 * indistinguishable from an oversight:
 *
 *   - **Out-ports, at the level of shipped specs.** A terminal Consumer's
 *     `main` is consumed by nothing, correctly — it is the last node. Roughly
 *     forty of the fifty-odd unconsumed out-ports are that, so the check would
 *     be noise with three real findings hidden in it. The out-port direction is
 *     covered at the SHAPE level instead (§1a), where "nothing can consume
 *     this" is a fact about the vocabulary rather than about one pipeline.
 *   - **Node types no core spec uses at all.** `attach-image`, `roll`,
 *     `summarize-request` and thirty others are a vocabulary offered to
 *     whoever builds a pipeline in the editor. Unused by core is their normal
 *     state, not a defect. (Unused AND unbound is one — `bindingCompat.ts`
 *     holds that line at boot, plans/29 R-2.)
 *   - **Socket emitters, as distinct from handlers.** See §4: emit sites go
 *     through named helpers (`emitToUser`, `broadcastToSessionUsers`) and every
 *     `*:error` event is emitted from a template literal inside `register()`,
 *     so "who emits this" is not decidable from the source text. That family
 *     is scoped to what is decidable and says so.
 *   - **Hook ctx SIGNATURES, as distinct from membership.** §5 asks whether a
 *     declared member is on the object, not whether it takes what the type
 *     says. `log` was such a divergence for as long as it went unread; see §5's
 *     docblock for what it cost and why nothing here would have caught it.
 */

import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, relative, resolve } from "node:path"
import { describe, expect, test } from "vitest"
import ts from "typescript"
// Importing the contracts is what registers them — the same fact-about-the-code
// route `bootstrapPipelines` and `registryHashes.test.ts` take, rather than a
// list maintained beside them. Note this resolves to the package's **dist**, so
// editing a descriptor in `serene-pub-sdk/contracts/src` changes nothing here
// until that package is rebuilt.
import "@serene-pub/contracts"
import {
	allDefinitions,
	assignable,
	JSON_SHAPE,
	type Descriptor,
	type SpecDocument
} from "@serene-pub/sdk"
import { CORE_SPECS } from "@serene-pub/core-catalog"
import { PRESET_CAPABILITIES } from "$lib/shared/connectionAdapters/manifest"
import { presetHomeType } from "$lib/shared/connectionAdapters/presetSlug"

// ── The allowlist machinery ─────────────────────────────────────────────────

/**
 * A declaration that is knowingly ahead of its other end.
 *
 * `reason` is not a comment. It is the assertion: this file says the subject is
 * unwired *on purpose*, and a reader who disagrees has one sentence to argue
 * with rather than a silence to interpret.
 */
interface Deliberate {
	/** The exact string the check produces, so the two can be compared. */
	readonly subject: string
	/** Declared, deliberately not wired yet, because… */
	readonly reason: string
}

/**
 * Both directions of one family, in one place.
 *
 * The second assertion is the one that keeps this file honest over time. A
 * subject that has since been wired — or that has vanished from the
 * declarations entirely — leaves an entry behind that excuses nothing, and the
 * next reader has no way to tell a live exemption from a dead one.
 */
function expectExactlyExcused(
	found: readonly string[],
	allowed: readonly Deliberate[],
	{ list, unwired, fix }: { list: string; unwired: string; fix: string }
): void {
	const excused = new Set(allowed.map((a) => a.subject))
	const unexplained = found.filter((s) => !excused.has(s))
	expect(
		unexplained,
		unexplained.length
			? `${unexplained.length} ${unwired}:\n` +
					unexplained.map((s) => `  • ${s}`).join("\n") +
					`\n\n${fix} — or add it to ${list} with the reason it is ` +
					`declared ahead of its other end. Do not weaken the check.`
			: undefined
	).toEqual([])

	const seen = new Set(found)
	const stale = allowed.filter((a) => !seen.has(a.subject))
	expect(
		stale.map((a) => a.subject),
		stale.length
			? `${stale.length} entr${stale.length === 1 ? "y" : "ies"} in ` +
					`${list} no longer excuse${stale.length === 1 ? "s" : ""} ` +
					`anything:\n` +
					stale
						.map(
							(a) =>
								`  • ${a.subject}\n      claimed: ${a.reason}`
						)
						.join("\n") +
					`\n\nEither it is wired now, or the declaration is gone. ` +
					`Delete the entry — a stale excuse is how this test rots ` +
					`into decoration.`
			: undefined
	).toEqual([])
}

// ── The source corpus, read once ────────────────────────────────────────────

const ROOT = resolve(__dirname, "../../../..")
const SRC = join(ROOT, "src")

/**
 * Shipped source only. A reference from a test file is not wiring: a test that
 * emits an event nobody else emits is the definition of a dead declaration
 * being kept alive by its own test.
 */
const isTestFile = (p: string) => /\.(?:test|spec)\.ts$/.test(p)

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name)
		if (entry.isDirectory()) {
			if (entry.name !== "node_modules") walk(p, out)
		} else if (/\.(?:ts|svelte)$/.test(entry.name) && !isTestFile(p)) {
			out.push(p)
		}
	}
	return out
}

/** `[absolute path, text]`, for the two families that read the source. */
const SOURCES: ReadonlyArray<readonly [string, string]> = walk(SRC).map(
	(p) => [p, readFileSync(p, "utf8")] as const
)

const rel = (p: string) => relative(ROOT, p)

// ── §1 Node ports ───────────────────────────────────────────────────────────

const TYPES = allDefinitions() as Descriptor[]
const TYPE_BY_ID = new Map(TYPES.map((t) => [t.id, t]))

interface Port {
	readonly type: string
	readonly port: string
	readonly shape: string
}

const portsOf = (side: "in" | "out"): Port[] =>
	TYPES.flatMap((t) =>
		Object.entries((t.ports?.[side] ?? {}) as Record<string, string>).map(
			([port, shape]) => ({ type: t.id, port, shape })
		)
	)

const IN_PORTS = portsOf("in")
const OUT_PORTS = portsOf("out")

/**
 * ⚠ `json@1` is excluded from the out-port direction, and only from that
 * direction.
 *
 * `assignable(anything, json@1)` is true by design — json is the permissive
 * sink. So "is there an in-port that can take this?" is answered yes for every
 * out-port in the registry the moment one json in-port exists anywhere, which
 * makes the question worth nothing. Excluding the sink asks the question that
 * has content: is there a port that understands this SHAPE. A json out-port is
 * excluded from being asked at all, because "a bag of json goes into a bag of
 * json" is the whole meaning of that shape rather than a gap in it.
 */
const nonJson = (p: Port) => p.shape !== JSON_SHAPE

/** `write-result@1 :: core:outlet/create-message@1.main, …` */
const shapeSubject = (shape: string, ports: readonly Port[]) =>
	`${shape} :: ${ports.map((p) => `${p.type}.${p.port}`).join(", ")}`

/**
 * Shapes some port declares it accepts, that nothing in the registry emits.
 *
 * Clean today, and kept for the direction rather than for the findings: a new
 * in-port typed to a shape no node produces is a feature wired to nothing, and
 * it is the cheapest possible thing to notice at the moment it is written.
 */
const UNPRODUCED_IN_SHAPES: Deliberate[] = []

/**
 * Shapes some port emits, that no port anywhere declares it accepts.
 *
 * Each entry below is deliberate, documented at the declaration site in the
 * SDK's `shapes.ts`, and not a mistake — which is exactly why they need to be
 * *said*. One more appearing quietly beside them is the case this list exists
 * for. (`rendered-blocks@1` left the list with `render-entries`, culled
 * unbound under plans/29 R-2 — nothing publishes the shape now.)
 */
const UNCONSUMED_OUT_SHAPES: Deliberate[] = [
	{
		subject: shapeSubject(
			"core:shape/turn-order@1",
			OUT_PORTS.filter((p) => p.shape === "core:shape/turn-order@1")
		),
		reason:
			"What was written, published back for a receipt to carry " +
			"(PLAN-turn-order §4.4). `core:outlet/set-turn-order@1.turnOrder` " +
			"is the document as stored — or the stored one when the write was " +
			"stale — so a person reading the run can see the order it produced " +
			"without a second read. Nothing consumes it, and nothing should: " +
			"the order is STATE, read from `sessions.metadata` by whoever " +
			"needs it, not passed down a graph. Delete this entry if a spec " +
			"ever wires a second write from the first.\n\n" +
			"⏳ Replaces the `speaker-selection@1` entry, which excused the " +
			"same thing one vocabulary earlier: a shape that was a membership " +
			"test rather than a wire. `turn-entries@1` is that test now — a " +
			"task publishing it IS a turn strategy — and it IS consumed, by " +
			"`set-turn-order@1.order`, so it needs no excusing."
	},
	{
		subject: shapeSubject(
			"core:shape/form-addressed@1",
			OUT_PORTS.filter((p) => p.shape === "core:shape/form-addressed@1")
		),
		reason:
			"An event's payload, whole (R-15 *Forms*, U5d). `core:inlet/" +
			"form-addressed@1.main` republishes what `core:event/form-addressed@1` " +
			"carried, the way `session-created@1.main` does its request; the " +
			"answer pipeline reads the parts beside it — `form`, `addressee`, " +
			"`messageId`, `blockId` — port by port, and nothing wants the " +
			"envelope as one value. The shape exists so the event registry's " +
			"`payload_shape` names it, not as a wire."
	},
	{
		subject: shapeSubject(
			"core:shape/session-settings@1",
			OUT_PORTS.filter((p) => p.shape === "core:shape/session-settings@1")
		),
		reason:
			"The settings document, whole (PLAN-turn-order §4.12, R13; A3). " +
			"Every session inlet publishes it as `session` and " +
			"`core:query/session-settings@1` re-reads it, and a spec reads " +
			"INTO it — `$.input.session.fields.tone`, `$.event.session.cast` " +
			"into `turn-pool@1`'s `cast: sessionCast` (A6) — path by path. " +
			"Nothing wants the envelope as one value: the shape exists so the " +
			"port is typed and the document has a name, not as a wire."
	},
]

/**
 * Every pipeline core ships, as a set of `definitionId@version.port` addresses that
 * something actually puts a value in.
 *
 * Both routes count as filling a port, and both have to: a `$ref` becomes an
 * EDGE at compile, while a literal (`{ text: "…" }`) stays in the node's
 * config. A port supplied by a constant is still supplied.
 *
 * The config route reads generously — a config key counts when the type
 * declares an in-port of that name — so a type that named a SLOT and an IN-PORT
 * the same thing would have the slot excuse the port. None does today, and the
 * edge route covers every case that matters here; this is written down because
 * a silent generosity is the kind of thing that makes a check say less than its
 * reader thinks.
 */
function shippedWiring(): {
	pins: Set<string>
	filled: Set<string>
	unknownPins: string[]
} {
	const pins = new Set<string>()
	const filled = new Set<string>()
	const unknownPins = new Set<string>()

	for (const entry of CORE_SPECS) {
		const doc = entry.build() as SpecDocument
		const byKey = new Map(doc.nodes.map((n) => [n.key, n]))
		for (const node of doc.nodes) {
			const pin = `${node.definitionId}@${node.definitionVersion}`
			pins.add(pin)
			const descriptor = TYPE_BY_ID.get(pin)
			if (!descriptor) {
				unknownPins.add(`${entry.slug} pins ${pin}`)
				continue
			}
			for (const key of Object.keys(node.config ?? {}))
				if (descriptor.ports?.in?.[key]) filled.add(`${pin}.${key}`)
		}
		for (const edge of doc.edges) {
			const to = byKey.get(edge.to)
			if (!to) continue
			// A ref into a nested config path compiles to `sources.0`; the port
			// is the first segment.
			const port = String(edge.toPort).split(".")[0]
			filled.add(`${to.definitionId}@${to.definitionVersion}.${port}`)
		}
	}
	return { pins, filled, unknownPins: [...unknownPins].sort() }
}

const WIRING = shippedWiring()

/** In-ports of node types core ships in a pipeline that no spec ever fills. */
const unfilledInPorts = (): string[] => {
	const out: string[] = []
	for (const pin of [...WIRING.pins].sort()) {
		const descriptor = TYPE_BY_ID.get(pin)
		for (const port of Object.keys(descriptor?.ports?.in ?? {}))
			if (!WIRING.filled.has(`${pin}.${port}`)) out.push(`${pin}.${port}`)
	}
	return out
}

/**
 * Declared in-ports on nodes core ships, that no core pipeline supplies.
 *
 * ⚠ The scope is deliberate: **node types a shipped spec actually uses.** A
 * port on a node core never runs is unwired for an uninteresting reason (the
 * node is unused), while a port on a node that runs in every single turn and is
 * never filled is the `attachments` shape of bug — a whole runtime path that no
 * shipped run can reach.
 */
const UNFILLED_IN_PORTS: Deliberate[] = [
	{
		subject: "core:outlet/update-message@1.blocks",
		reason:
			"A reply may end with a question put to the cast (R-15 *Forms*, " +
			"U5d): the port is the same list `create-message@1.blocks` takes, " +
			"appended once the text lands. The shipped reply pipelines end in " +
			"prose alone — the Adventure genre's Ask writes its question through " +
			"`create-message` on a narration row — and the port is read by the " +
			"host's `writeBlocks` on both writes. Delete this entry when a " +
			"shipped reply wires it."
	},
	{
		subject: "core:task/make-choices@1.addressee",
		reason:
			"The override: a spec that already knows whom it is asking wires a " +
			"participant reference here and it wins over the oracle's document. " +
			"The Adventure genre's Ask lets the oracle choose the addressee by " +
			"name and resolves it against the cast instead, so no shipped spec " +
			"fills the port; the binding reads it (`wired ?? resolveAddresseeName`)."
	},
	{
		subject: "core:oracle/generate-text@1.attachments",
		reason:
			"⚠ THE INSTANCE THIS FILE WAS BUILT FOR. Media travelling with a " +
			"request: declared in contracts, forwarded by bindings.ts and " +
			"host.ts, resolved with an ownership check by dispatch.ts, limited " +
			"by the attachments engine and sent by AnthropicAdapter — with no " +
			"producer in any shipped pipeline, so every one of those is dead " +
			"code today. `generate-image` publishes `media-refs@1` and could " +
			"feed it; nothing does. Delete this entry the day a spec wires it."
	},
	{
		subject: "core:oracle/generate-image@1.init",
		reason:
			"img2img. Declared for backends that report it, read by the " +
			"binding (`init: input?.init`), and no shipped spec offers an " +
			"input image — the generate-image spec renders from text only."
	},
	{
		subject: "core:oracle/generate-image@1.negative",
		reason:
			"Supplied through the node's `prompts` slot (`negative` field), " +
			"which is where a person writes it, rather than through the port. " +
			"The port stays for a spec that wants to COMPUTE a negative prompt " +
			"upstream; the binding reads whichever arrives."
	},
	{
		subject: "core:outlet/create-message@1.channel",
		reason:
			"Declared 2026-09-16 (U2 residual): the host read `channel` off " +
			"the payload while no declaration supplied it. The create specs " +
			"wire it on `seed-greetings` (the genre's greeting channel); the " +
			"reply specs write to `main` and say nothing, which is the " +
			"declared default — a spec that redirects a reply to another " +
			"channel is what fills it. Delete this entry the day one does."
	},
	{
		subject: "core:oracle/embed-text@1.text",
		reason:
			"The singular half of a pair — `text` embeds one string, `texts` " +
			"embeds a batch and returns one vector each, in order. The host " +
			"reads whichever arrives and a spec supplies exactly one of them; " +
			"filling both would ask for two answers on one call. `respond` " +
			"1.19.0's semantic mechanism wires `texts`, which is what made this " +
			"reachable at all — the node was in no shipped spec before it, so " +
			"neither port had an excuse and neither needed one."
	},
	// ⚠ Five entries were here and are gone rather than annotated (R-12,
	// 2026-09-16): `session-history@1.budget` and the `text` in-port on the
	// three lore lanes and `lorebook-triggers`. Each was "filled by nothing and
	// read by nothing" — the shape `boot/declaredReads.ts` now refuses at the
	// declaration — and each was culled from its definition, so there is no
	// port left to excuse.
	{
		subject: "core:task/build-narrator-context@1.currentCharacterId",
		reason:
			"A narrator turn has no speaker, which is the whole reason this " +
			"type exists beside `build-template-context@1` — they share one " +
			"binding. The port comes with the shared shape; narrate correctly " +
			"leaves it empty."
	},
	{
		subject: "core:task/build-template-context@1.speakerName",
		reason:
			"⚠ **Filled by a sibling BINDING rather than by a document**, which " +
			"is a supplier this check cannot see and the reason the port was " +
			"undeclared until D-I. `core:task/build-side-character-context@1` " +
			"is not a second implementation: its binding unwraps its own " +
			"`speaker` in-port and calls THIS type's handler with the name and " +
			"the card spread onto the input, because `resolveContextInput` owns " +
			"the card rules and a side character's card and a cast member's must " +
			"compile through one function. So the value arrives on every " +
			"side-character turn and no spec wires it — the exact combination " +
			"that made it a phantom read for a release. Declaring it is what " +
			"puts the fact somewhere; this entry is what stops the declaration " +
			"reading as a port nothing fills."
	},
	{
		subject: "core:task/build-template-context@1.speakerCharacter",
		reason:
			"The card half of the pair above — `null` for a free-form name, " +
			"which is a normal turn rather than a degraded one. Same supplier, " +
			"same terms."
	}
]

describe("§1 node ports — every port has something on the other end", () => {
	test("every spec core ships pins a type the registry declares", () => {
		// The floor under both checks below: an unresolvable pin means the
		// ports of that node are unknown, and an unknown port set is silently
		// excused from everything else in this section.
		expect(
			WIRING.unknownPins,
			WIRING.unknownPins.length
				? "A shipped spec pins a node type nothing declares. Either " +
						"the contract was removed without re-pinning the spec, " +
						"or @serene-pub/contracts has not been rebuilt."
				: undefined
		).toEqual([])
	})

	test("every in-port shape is one some node can produce", () => {
		const unproduced = [...new Set(IN_PORTS.map((p) => p.shape))]
			.filter(
				(shape) => !OUT_PORTS.some((o) => assignable(o.shape, shape))
			)
			.map((shape) =>
				shapeSubject(
					shape,
					IN_PORTS.filter((p) => p.shape === shape)
				)
			)
		expectExactlyExcused(unproduced, UNPRODUCED_IN_SHAPES, {
			list: "UNPRODUCED_IN_SHAPES",
			unwired:
				"in-port shape(s) no node in the registry emits — a port " +
				"nothing can ever fill",
			fix: "Give some node an out-port of that shape"
		})
	})

	test("every out-port shape is one some node can consume", () => {
		const unconsumed = [
			...new Set(OUT_PORTS.filter(nonJson).map((p) => p.shape))
		]
			.filter(
				(shape) =>
					!IN_PORTS.some(
						(i) => nonJson(i) && assignable(shape, i.shape)
					)
			)
			.map((shape) =>
				shapeSubject(
					shape,
					OUT_PORTS.filter((p) => p.shape === shape)
				)
			)
		expectExactlyExcused(unconsumed, UNCONSUMED_OUT_SHAPES, {
			list: "UNCONSUMED_OUT_SHAPES",
			unwired:
				"out-port shape(s) no port anywhere accepts — a value with " +
				"nowhere to go",
			fix: "Declare an in-port that takes it"
		})
	})

	test("every in-port on a node core ships is filled by some core spec", () => {
		expectExactlyExcused(unfilledInPorts(), UNFILLED_IN_PORTS, {
			list: "UNFILLED_IN_PORTS",
			unwired:
				"in-port(s) on node types core ships in a pipeline that no " +
				"shipped pipeline ever supplies",
			fix: "Wire it in the spec that needs it"
		})
	})
})

// ── §2 Preset capability slugs ──────────────────────────────────────────────

/**
 * Slugs keyed in `PRESET_CAPABILITIES` that no preset offers.
 *
 * `presetSlug.ts` already models this exactly: `presetHomeType` returns `null`
 * for "keyed but not offered", and its docblock calls that a legitimate state
 * rather than an error. This reuses that answer instead of recomputing the
 * membership test — the union of the two lists lives there, in the one module
 * that has to get it right at runtime.
 *
 * The other direction — a preset slug with no capability entry — is NOT checked
 * here, because the preset list's own docblock rules it harmless: absent means
 * "the adapter's own defaults", which is the right answer for a service nobody
 * has sourced numbers for.
 */
const UNOFFERED_PRESET_SLUGS: Deliberate[] = [
	{
		subject: "anthropic",
		reason:
			"⚠ Dead data ON PURPOSE, and `presetSlug.ts` says so at length: " +
			"held for the planned normalization in which every connection, " +
			"first parties included, is a preset for a specific API. Until a " +
			"preset offers the slug, `{ 'text+image->text': true }` is an " +
			"assertion nothing can reach — `resolveConnectionCapabilities` " +
			"finds no preset layer for a slug no row can hold."
	}
]

describe("§2 preset capabilities — every keyed slug is one a preset offers", () => {
	test("a capability keyed to a slug is a capability something can set", () => {
		const unoffered = Object.keys(PRESET_CAPABILITIES)
			.filter((slug) => presetHomeType(slug) === null)
			.sort()
		expectExactlyExcused(unoffered, UNOFFERED_PRESET_SLUGS, {
			list: "UNOFFERED_PRESET_SLUGS",
			unwired:
				"PRESET_CAPABILITIES key(s) that no OPENAI_COMPATIBLE_PRESETS entry " +
				"offers, so nothing can ever store the slug they are keyed to",
			fix: "Add the preset that offers the slug"
		})
	})
})

// ── §3 SDK executor options ─────────────────────────────────────────────────

const require_ = createRequire(join(ROOT, "package.json"))

/**
 * `RunOptions`, read off the **built** SDK — the declaration the app actually
 * compiles and runs against, not the source beside it.
 *
 * Parsed rather than reflected because an interface has no runtime form. This
 * is the same trade `importBoundary.test.ts` and `defaults.seedIdSequence.test.ts`
 * make: the invariant lives in the text, so read the text.
 */
function runOptionMembers(): string[] {
	const pkg = require_.resolve("@serene-pub/sdk/package.json")
	const dts = join(dirname(pkg), "dist", "executor.d.ts")
	const source = ts.createSourceFile(
		dts,
		readFileSync(dts, "utf8"),
		ts.ScriptTarget.Latest,
		true
	)
	const members: string[] = []
	const visit = (node: ts.Node) => {
		if (
			ts.isInterfaceDeclaration(node) &&
			node.name.text === "RunOptions"
		) {
			for (const m of node.members)
				if (
					ts.isPropertySignature(m) &&
					m.name &&
					ts.isIdentifier(m.name)
				)
					members.push(m.name.text)
		}
		ts.forEachChild(node, visit)
	}
	visit(source)
	return members
}

/**
 * Which options the app hands the executor, and where.
 *
 * Found by locating `run` imported from `@serene-pub/sdk` in each shipped
 * module and reading the keys of the object literal passed to it — so this
 * keeps working when the call site moves, and notices when a new one appears.
 *
 * A spread is followed only through parentheses and conditionals
 * (`...(on ? { applyScripts } : {})`), never into a call's arguments. The
 * greedy version of this walked into `makeScriptApplier(db, { … })` and
 * reported that helper's parameters as executor options.
 *
 * ⚠ A NAMED import is what it looks for. A call reached through a namespace
 * (`import * as sdk` … `sdk.run(doc, {…})`) or through an options object built
 * elsewhere and spread in whole would be invisible, and the options it passes
 * would read here as unsupplied. The "readable at all" test below is the floor
 * under that — it fails if no call site is found at all — but a SECOND call
 * site written that way would go uncounted. Import `run` by name.
 */
function suppliedRunOptions(): Map<string, Set<string>> {
	const supplied = new Map<string, Set<string>>()
	for (const [path, text] of SOURCES) {
		if (!path.endsWith(".ts")) continue
		if (!text.includes("@serene-pub/sdk")) continue
		const source = ts.createSourceFile(
			path,
			text,
			ts.ScriptTarget.Latest,
			true
		)

		let local: string | undefined
		const findImport = (node: ts.Node) => {
			if (
				ts.isImportDeclaration(node) &&
				ts.isStringLiteral(node.moduleSpecifier) &&
				node.moduleSpecifier.text === "@serene-pub/sdk"
			) {
				const bindings = node.importClause?.namedBindings
				if (bindings && ts.isNamedImports(bindings))
					for (const el of bindings.elements)
						if ((el.propertyName ?? el.name).text === "run")
							local = el.name.text
			}
			ts.forEachChild(node, findImport)
		}
		findImport(source)
		if (!local) continue

		const collect = (
			obj: ts.ObjectLiteralExpression,
			into: Set<string>
		) => {
			for (const prop of obj.properties) {
				if (ts.isSpreadAssignment(prop)) {
					const follow = (e: ts.Expression) => {
						if (ts.isParenthesizedExpression(e))
							follow(e.expression)
						else if (ts.isConditionalExpression(e)) {
							follow(e.whenTrue)
							follow(e.whenFalse)
						} else if (ts.isObjectLiteralExpression(e))
							collect(e, into)
					}
					follow(prop.expression)
					continue
				}
				const name = (prop as ts.PropertyAssignment).name
				if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name)))
					into.add(name.text)
			}
		}

		const findCalls = (node: ts.Node) => {
			const arg = ts.isCallExpression(node)
				? node.arguments[1]
				: undefined
			if (
				ts.isCallExpression(node) &&
				ts.isIdentifier(node.expression) &&
				node.expression.text === local &&
				arg &&
				ts.isObjectLiteralExpression(arg)
			) {
				const keys = supplied.get(rel(path)) ?? new Set<string>()
				collect(arg, keys)
				supplied.set(rel(path), keys)
			}
			ts.forEachChild(node, findCalls)
		}
		findCalls(source)
	}
	return supplied
}

/**
 * Every option the SDK's `RunOptions` declares, and whether the app is expected
 * to pass it.
 *
 * ⚠ **This map is asserted COMPLETE against the SDK type**, in both directions.
 * A new option added to the SDK fails this test until somebody rules on it,
 * which is the property `cancelSignal` needed and did not have: it sat in
 * `RunOptions` for as long as it took to notice, with every reader assuming a
 * host that ignored it had ignored it on purpose.
 *
 * `true` means the app must pass it at some shipped call site; a string is the
 * reason it deliberately does not. Both are checked — an option marked with a
 * reason that the app has since started passing fails, naming the line to
 * change to `true`.
 *
 * Every "not supplied" below has a working default in the executor, so none is
 * a crash. They are features the app has not taken up — which is a fine state
 * to be in, and a state worth being able to read.
 */
const RUN_OPTIONS: Record<string, true | string> = {
	input: true,
	bindings: true,
	world: true,
	seed: true,
	runId: true,
	triggerSource: true,
	host: true,
	reviewer: true,
	applyScripts: true,
	onNode: true,
	preview: true,
	// The second one this file caught. The app HAD a real counter
	// (`TokenCounterManager`) and the executor was falling back to
	// `roughTokens`, so a person who chose GPT-4o on their connection got a
	// flat four-characters-per-token estimate for every budget and every
	// receipt — a parity regression against 0.5, where `generateResponse`
	// reads that same column. The excuse that used to sit here was accurate
	// about the obstacle (the option was synchronous and the counter async)
	// and wrong about the conclusion: the async part is LOADING, so the SDK
	// resolves an id to a loaded, synchronous counter before the run starts
	// and the fit loop never had to change. `runSpec` passes the id.
	tokenizer: true,
	// The one that motivated this file. Wired now (runTurn passes the
	// registry's cancellation probe through), and this line is what keeps it
	// wired: unwiring it fails here rather than in a cancelled run that
	// quietly finishes.
	cancelSignal: true,
	// The run-level guarantee (09-B B4, R-17): the executor tells the host
	// once when a run ends, with the live row, and `runSpec` finalises the
	// row there — stopped with the partial, failed with the reason. The one
	// seam Stop has; unwiring it leaves a placeholder generating forever.
	onRunEnd: true,
	// Who portrays whom (R-21 (4), U5a): `runSpec` resolves it before the
	// first node and hands it in here, so the receipt pins the answer at
	// construction. Unwiring it leaves every receipt without `portrayals`
	// and the inspector's line empty — loudly, here.
	portrayals: true,
	// A node's status (R-19, U5h): the executor hands each change here and
	// `runSpec` routes it — `{speaker}` filled, the live row, the session
	// list, the caller's frame (`runtime/runStatus.ts`). Unwiring it leaves
	// every reply row saying *working* and the receipt's `lastStatus` still
	// present but never shown — quietly, which is why this line exists.
	onStatus: true,
	// Where a run stands in a tree of runs (01 §8, R-21 (5), U5d): a
	// `form-addressed` child and the action its answer fires carry their
	// parent, root and depth here, and the receipt pins them. `runSpec`
	// passes `request.lineage` through; unwiring it leaves every child
	// receipt claiming to be a root and the cycle caps counting nothing.
	lineage: true,
	dry:
		"Defaults to the preview flag inside the executor, and every preview " +
		"the app runs (`sessions:promptTokenCount`, the retrieval previews, " +
		"the prompt-diff tool) is a dry run through that default — outlets " +
		"commit nothing and the receipt says `dry`. Nothing in the app wants " +
		"a dry run that is NOT a preview yet, so nothing passes it explicitly; " +
		"the option exists for a host that wants to run a document to the end " +
		"and write nothing.",

	triggerRef:
		"Recorded on the receipt only. The app links a run to its cause " +
		"through its own rows — `saveReceipt` writes sessionId, userId and a " +
		"`pipeline_run_artifacts` row per thing the run made — so the " +
		"receipt's free-text ref has no reader here.",
	actorUserId:
		"Same: who ran it is a column on the app's run row, written by " +
		"`saveReceipt` from `request.userId`, not a field it reads back off " +
		"the receipt.",
	timeoutCeilingMs:
		"There is no instance-wide timeout ceiling setting to pass. Per-node " +
		"timeouts come from the descriptors; the admin surface for a ceiling " +
		"over them does not exist yet.",
	forceSequential:
		"The admin control for 'run every block sequentially' is not built. " +
		"Block mode is the spec author's `async` mode today.",
	budget:
		"No token or node-execution ceiling is configurable, so there is " +
		"nothing to pass. The executor's default is Infinity for both.",
	subscribers:
		"How many pipelines core would have dispatched an emitted event to, " +
		"for the record. There is no fan-out to count: " +
		"`resolveSessionEventSpec` finds the ONE published spec whose input " +
		"lock matches (genre, event) and dispatch runs that. The number would " +
		"be 0 or 1 and says nothing the receipt does not already.",
	now:
		"A simulated clock, so a test's wait costs no real seconds. A running " +
		"host must not pass it — `Date.now` is the correct clock here, and " +
		"the executor already defaults to it.",
	queuedMs:
		"Time spent in an admin-visible queue before dequeue. There is no " +
		"such queue in front of `runSpec`: a turn runs when it is asked for.",
	compactHaltReceipts:
		"Deliberately left to the executor's own default, which is already " +
		"the behaviour the app wants — compact for event-triggered runs, full " +
		"detail for a run somebody clicked.",
	countTokens:
		"Superseded by `tokenizer`, and deliberately NOT passed beside it. " +
		"The function still exists for hosts and for the SDK's own suite, and " +
		"it WINS when both are given — so passing it here would silently " +
		"override the id and put the connection's setting back out of reach, " +
		"which is the exact bug the entry above records fixing. An id is also " +
		"the form that lands in the receipt; a closure is not."
}

describe("§3 executor options — the app supplies what the SDK expects", () => {
	const members = runOptionMembers()
	const supplied = suppliedRunOptions()
	const anywhere = new Set([...supplied.values()].flatMap((s) => [...s]))
	const sites =
		[...supplied.keys()].map((f) => `  • ${f}`).join("\n") || "  (none)"

	test("the SDK's RunOptions is readable at all", () => {
		// A silent empty read would make every assertion below vacuously pass.
		// If this fails, the SDK has not been built — `npm run sdk:build`.
		expect(members.length).toBeGreaterThan(0)
		expect(members).toContain("cancelSignal")
		expect(supplied.size).toBeGreaterThan(0)
	})

	test("every RunOptions member has been ruled on", () => {
		const unruled = members.filter((m) => !(m in RUN_OPTIONS))
		expect(
			unruled,
			unruled.length
				? `The SDK declares executor option(s) this app has not ruled ` +
						`on:\n${unruled.map((m) => `  • ${m}`).join("\n")}\n\n` +
						`Add each to RUN_OPTIONS: \`true\` if the app must pass ` +
						`it (then pass it), or the reason it deliberately does ` +
						`not. An option nobody rules on is how \`cancelSignal\` ` +
						`stayed unwired.`
				: undefined
		).toEqual([])

		const gone = Object.keys(RUN_OPTIONS).filter(
			(m) => !members.includes(m)
		)
		expect(
			gone,
			gone.length
				? `RUN_OPTIONS names option(s) the SDK no longer declares:\n` +
						`${gone.map((m) => `  • ${m}`).join("\n")}\n\n` +
						`Delete them.`
				: undefined
		).toEqual([])
	})

	test("every option the app must supply is supplied at a call site", () => {
		const missing = members.filter(
			(m) => RUN_OPTIONS[m] === true && !anywhere.has(m)
		)
		expect(
			missing,
			missing.length
				? `The app is expected to pass these executor options and ` +
						`passes them nowhere:\n` +
						missing.map((m) => `  • ${m}`).join("\n") +
						`\n\nCall sites found:\n${sites}\n\nThis is the ` +
						`\`cancelSignal\` failure exactly: the executor reads ` +
						`the option, the app never sets it, and the feature is ` +
						`silently absent. Pass it, or change its RUN_OPTIONS ` +
						`entry to the reason it must not be passed.`
				: undefined
		).toEqual([])
	})

	test("no option excused as unsupplied is being supplied", () => {
		const wired = members.filter(
			(m) => typeof RUN_OPTIONS[m] === "string" && anywhere.has(m)
		)
		expect(
			wired,
			wired.length
				? `RUN_OPTIONS excuses these as deliberately unsupplied, and ` +
						`the app supplies them:\n` +
						wired.map((m) => `  • ${m}`).join("\n") +
						`\n\nChange each entry to \`true\`. A stale excuse is ` +
						`worse than none — the next reader believes it.`
				: undefined
		).toEqual([])
	})

	test("no key at a call site is an option the SDK does not declare", () => {
		// TypeScript's excess-property check does not survive an object
		// spread, which every call site here uses.
		const foreign = [...anywhere].filter((k) => !members.includes(k))
		expect(
			foreign,
			foreign.length
				? `Key(s) passed to the executor that RunOptions does not ` +
						`declare: ${foreign.join(", ")}. They are ignored.`
				: undefined
		).toEqual([])
	})
})

// ── §4 Socket events ────────────────────────────────────────────────────────

/**
 * The declared event vocabulary: the keys of `SocketEventMap`.
 *
 * ⚠ Not `shared/sockets/types.ts`, which is where one would expect to find it.
 * That file declares the `Sockets.*` PARAM AND RESPONSE SHAPES — it never names
 * an event. The event names exist in exactly one place, as the keys of the map
 * that binds a name to those shapes, so that is what is read here.
 */
function declaredSocketEvents(): string[] {
	const path = join(SRC, "lib/client/sockets/typedSocket.ts")
	const source = ts.createSourceFile(
		path,
		readFileSync(path, "utf8"),
		ts.ScriptTarget.Latest,
		true
	)
	const events: string[] = []
	const visit = (node: ts.Node) => {
		if (
			ts.isTypeAliasDeclaration(node) &&
			node.name.text === "SocketEventMap" &&
			ts.isTypeLiteralNode(node.type)
		) {
			for (const m of node.type.members) {
				if (!ts.isPropertySignature(m) || !m.name) continue
				// Both spellings are real events: the colon-namespaced ones are
				// quoted, and the legacy colon-less ones (`ollamaPullProgress`)
				// are bare identifiers.
				if (ts.isStringLiteral(m.name) || ts.isIdentifier(m.name))
					events.push(m.name.text)
			}
		}
		ts.forEachChild(node, visit)
	}
	visit(source)
	return events
}

/**
 * Where an event name is written as a string, and where it is written as a
 * handler's `event:` — the two facts the source text can actually settle.
 */
function socketReferences(): {
	referenced: Map<string, string[]>
	handled: Set<string>
} {
	const referenced = new Map<string, string[]>()
	const handled = new Set<string>()
	const declaration = join(SRC, "lib/client/sockets/typedSocket.ts")
	// Any quoted string that could be an event name. Cheap on purpose: this
	// runs over ~1000 files and the answer is only ever "does this name appear".
	const literal = /(["'`])([A-Za-z0-9_:*-]+)\1/g
	for (const [path, text] of SOURCES) {
		if (path === declaration) continue
		for (const match of text.matchAll(literal)) {
			const name = match[2]!
			const before = text.slice(
				Math.max(0, match.index - 40),
				match.index
			)
			const seen = referenced.get(name) ?? []
			if (!seen.includes(path)) seen.push(path)
			referenced.set(name, seen)
			if (/\bevent\s*:\s*$/.test(before)) handled.add(name)
		}
	}
	return { referenced, handled }
}

/**
 * Declared socket events nothing in the shipped source mentions.
 *
 * ⚠ **Scope.** The brief for this family was "every declared event has both a
 * handler and an emitter", and the emitter half is not decidable from the text:
 * emits go through named helpers (`emitToUser`, `broadcastToSessionUsers`,
 * `socket.server.to(room).emit`), and every `*:error` event is emitted from
 * `` `${handler.event}:error` `` inside `register()` — a template literal, so
 * the name never appears anywhere as a string. Asserting on it would report
 * ~50 events whose emitter is that one line, and the useful findings would
 * drown.
 *
 * So this asserts the weaker, decidable thing: a declared event is REFERENCED
 * by shipped code somewhere. That is enough to catch the whole class it was
 * asked to catch — an event name that exists only in the map that declares it.
 * `*:error` events are exempted only when their base event has a registered
 * handler, because that is precisely when `register()` synthesises them.
 *
 * ⚠ One known blind spot, stated rather than special-cased. A quoted name in a
 * TYPE position — `Sockets.HistoryEntries.List.Response["historyEntryList"]` —
 * is the same text as one in a call, so an event whose name survives only as a
 * PAYLOAD FIELD reads here as referenced. `historyEntryList` is exactly that
 * today: declared as an event, emitted by nobody, and kept out of the list
 * below by two index accesses. Narrowing the scan to call positions would mean
 * parsing every `.svelte` file, which is a bundler's job.
 */
const UNREFERENCED_SOCKET_EVENTS: Deliberate[] = [
	{
		subject: "auth:login",
		reason:
			"Login is not a socket round trip. Credentials go over HTTP and " +
			"the socket authenticates from the handshake token — " +
			"`authMiddleware` disconnects an unauthenticated socket before " +
			"`connect` fires, so there is no point in the lifecycle where a " +
			"client could send this. Declared before that moved; kept as a " +
			"group with its four siblings below."
	},
	{
		subject: "auth:login:success",
		reason: "The ack half of `auth:login`. Same reason."
	},
	{
		subject: "auth:login:error",
		reason:
			"The error half of `auth:login`. Not exempted by the `register()` " +
			"rule, because there is no `auth:login` handler to synthesise it."
	},
	{
		subject: "auth:logout:success",
		reason:
			"The ack half of `auth:logout`, which itself survives only as an " +
			"entry in the setup gate's allowlist — a name in a list, not a " +
			"handler. Logout is `users:current:logout`."
	},
	{
		subject: "auth:logout:error",
		reason: "The error half of `auth:logout`. As above."
	},
	{
		subject: "sessionMessages:sendCharacterMessage",
		reason:
			"No handler and no caller. `sessionMessages:sendPersonaMessage` is " +
			"the live half; a character's turn is produced by the pipeline " +
			"that message triggers, not by a client asking for one directly."
	},
	{
		subject: "narrativeGraph:build:progress",
		reason:
			"The build reports through `narrativeGraph:buildLog` and " +
			"`narrativeGraph:build:error`, which are handled and emitted. This " +
			"pair was declared for a progress stream that was never built."
	},
	{
		subject: "narrativeGraph:build:complete",
		reason: "The terminal half of `narrativeGraph:build:progress`."
	},
	{
		subject: "ollamaModelsList",
		reason:
			"One of the block `typedSocket.ts` itself labels 'Legacy events " +
			"(should be migrated)'. The handler that exists is the CONST of " +
			"that name in sockets/ollama.ts, whose declared event is " +
			"`ollama:modelsList` — an identifier collision, not a wiring. " +
			"(`worldLoreEntryList` and `characterLoreEntryList` sat here for " +
			"the same reason and are gone: the entry collapse deleted the " +
			"three namespaces they were the pre-namespace form of.)"
	},
	{
		subject: "ollamaListRunningModels",
		reason:
			"Legacy, as `ollamaModelsList`, and with the same const-name " +
			"collision (`ollamaListRunningModelsHandler`)."
	}
]

describe("§4 socket events — every declared event is one some code uses", () => {
	test("a declared event name appears somewhere in the shipped source", () => {
		const events = declaredSocketEvents()
		const { referenced, handled } = socketReferences()

		expect(events.length).toBeGreaterThan(100)

		const orphans = events.filter((event) => {
			// `register()` emits `${handler.event}:error` for every handler it
			// registers, so an error event whose base is handled has an emitter
			// that no text search can see.
			if (
				event.endsWith(":error") &&
				handled.has(event.slice(0, -":error".length))
			)
				return false
			return !referenced.has(event)
		})

		expectExactlyExcused(orphans, UNREFERENCED_SOCKET_EVENTS, {
			list: "UNREFERENCED_SOCKET_EVENTS",
			unwired:
				"declared socket event(s) that no shipped file mentions — " +
				"neither a handler nor an emitter nor a listener",
			fix: "Wire the event, or delete it from SocketEventMap"
		})
	})
})

// ── §5 Hook context surfaces ────────────────────────────────────────────────

/**
 * Every member the SDK declares on a hook's `ctx`, against what the two sandbox
 * backends actually put in that object.
 *
 * This family exists because the four above it had a blind spot, and the blind
 * spot produced the largest instance of the bug this file is for. `hooks.ts`
 * types every hook's `ctx.storage` as `ExtensionStorage` — a quota-reporting
 * ROW store with a `files` namespace beside it — and for as long as that type
 * existed, what the runtime endowed under that name was a transactional FILE
 * store with a different six methods, so every call an author wrote from the
 * type threw. An earlier instance from the same blind spot was `signal:
 * AbortSignal`, declared on both surfaces while the runtime provided none.
 *
 * Both are endowed now, and this section is what keeps them endowed. The row
 * store is a shared, plugin-scoped table (`plugin_rows`) the host loads before
 * a call and commits after it, because the sandbox is synchronous on both
 * backends and QuickJS — the default — has no asynchronous capability bridge;
 * `files.*` is the store that was already there, under the spelling the SDK
 * declares. The older six survive beside it and are listed in
 * `UNDECLARED_HOOK_CTX`, which is the same finding read from the other end.
 *
 * ## Both sides are read, neither is listed
 *
 * **Declared** is parsed off the built `dist/*.d.ts` — the same trade §3 makes
 * for `RunOptions`, and for the same reason: an interface has no runtime form.
 * Every interface in `hooks.d.ts` whose name ends `Surface` — the
 * `EventListenerSurface` and `LifecycleCallbackSurface` since R-1 renamed the
 * three callables (2026-09-16) — is a subject, so a third kind becomes one by
 * existing rather than by being added here.
 *
 * **Endowed** is parsed off the guest program each backend BUILDS, not off the
 * concatenation that builds it — `buildProgram` is lifted out of the worker
 * source, called, and the program it returns is parsed for `ctx`. Reading the
 * concatenation would be reading the wrong artifact: a member assigned on a
 * later line (`ctx.signal` is exactly that) is not in the object literal at all.
 *
 * ## Depth
 *
 * The declared side is followed to the bottom: a member typed as another
 * interface the SDK declares is expanded, so `storage.files.stat` is a subject
 * in its own right. That is the whole point — `storage` being present says
 * nothing about whether `storage.query` is.
 *
 * The endowed side reaches two levels below the program, and it has to:
 * `ctx.storage` is an identifier (`__storage` / `__storageHost`), so its members
 * come from `storageHost.ts`, the module that builds that object — and one of
 * those members, `files`, is itself an object whose members the SDK declares in
 * their own right.
 *
 * ⚠ **That link is hand-written, and it is this section's real limit.** A
 * THIRD level, or a second ctx member given a nested object, would be compared
 * at its own name only and everything under it would read as endowed.
 * `storage` is the only nested one today — the other five ctx members are a
 * function expression each, or an AbortSignal — and `endowedNested` /
 * `storageHostMembers` are where the next one gets taught. `storageHostMembers`
 * throws rather than reads empty if `files` grows a shape it cannot follow,
 * which is the loud failure that keeps this from rotting quietly.
 *
 * ## The union across surfaces, and across backends
 *
 * The runtime builds ONE ctx for every hook kind, so the question it can answer
 * is the union: is this member endowed for anybody at all. `readCore` is
 * declared on the lifecycle surface only and is unendowed for every kind at
 * once, which is the honest reading rather than a scoping trick.
 *
 * The two backends are required to agree (the floor test below), so "endowed"
 * needs no qualifier. They diverge in what a member DOES — QuickJS's `fetch`
 * throws where SES's works — and that is a capability question, not a wiring
 * one; this section asks only whether the member is there to call.
 *
 * ## What is NOT checked here
 *
 * **Signatures.** This is a membership test, so a member endowed with the wrong
 * arity or the wrong argument order passes. `log` was exactly that: the SDK
 * declares `log(level, message, detail?)` and both backends endowed
 * `log(m) { __logs.push(String(m)) }`, so `ctx.log("warn", "disk full")`
 * recorded `"warn"` and dropped the message and the detail — silent loss in the
 * one facility an author has for debugging. The runtimes now take all three
 * (see `plugins/prelude.ts`, where the shared formatter lives, and the parity
 * test beside it), but nothing in this file would have said so: checking it
 * means comparing a `.d.ts` signature against a JS function expression, which
 * is a type checker's job and not this file's. No other divergence is known
 * today, which is a statement about who has looked, not about what is checked.
 */

/**
 * Every `String.raw` block in a file, as its RAW text.
 *
 * `.text` on the node is the COOKED value, which turns the `\n` a worker source
 * writes into an actual newline and makes the block unparseable as the program
 * it is. The source slice between the backticks is what `String.raw` produces.
 */
function rawTemplates(path: string): string[] {
	const sf = ts.createSourceFile(
		path,
		readFileSync(path, "utf8"),
		ts.ScriptTarget.Latest,
		true
	)
	const out: string[] = []
	const visit = (n: ts.Node) => {
		if (ts.isNoSubstitutionTemplateLiteral(n))
			out.push(n.getText(sf).slice(1, -1))
		ts.forEachChild(n, visit)
	}
	visit(sf)
	return out
}

/** One member of a hook surface, at its full dotted path. */
interface DeclaredMember {
	readonly path: string
	/** `readOwnRows?()` — absent is a state the author is told to expect. */
	readonly optional: boolean
	/** Declared members this one's `@deprecated` tag names as its replacement. */
	readonly deprecatedFor: readonly string[]
}

/**
 * Every interface the built SDK declares, by name.
 *
 * Flat across files on purpose: `hooks.d.ts` names `ExtensionStorage` and the
 * declaration lives in `storage.d.ts`, and following the import would mean
 * resolving module specifiers to answer a question the name already answers.
 * First declaration of a name wins; the SDK has no duplicates today.
 */
function sdkInterfaces(): Map<
	string,
	{ node: ts.InterfaceDeclaration; sf: ts.SourceFile; file: string }
> {
	const dist = join(
		dirname(require_.resolve("@serene-pub/sdk/package.json")),
		"dist"
	)
	const out = new Map<
		string,
		{ node: ts.InterfaceDeclaration; sf: ts.SourceFile; file: string }
	>()
	for (const file of readdirSync(dist).sort()) {
		if (!file.endsWith(".d.ts")) continue
		const full = join(dist, file)
		const sf = ts.createSourceFile(
			full,
			readFileSync(full, "utf8"),
			ts.ScriptTarget.Latest,
			true
		)
		const visit = (n: ts.Node) => {
			if (ts.isInterfaceDeclaration(n) && !out.has(n.name.text))
				out.set(n.name.text, { node: n, sf, file })
			ts.forEachChild(n, visit)
		}
		visit(sf)
	}
	return out
}

/** The backtick-quoted names inside a member's `@deprecated` tag, if it has one. */
function deprecationTargets(m: ts.TypeElement): string[] {
	for (const tag of ts.getJSDocTags(m)) {
		if (tag.tagName.text !== "deprecated") continue
		const c = tag.comment
		const text =
			typeof c === "string"
				? c
				: Array.isArray(c)
					? c.map((p) => p.text ?? "").join("")
					: ""
		return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.trim())
	}
	return []
}

/** The union of every `*Surface` in `hooks.d.ts`, expanded to the bottom. */
function declaredHookCtx(): DeclaredMember[] {
	const ifaces = sdkInterfaces()
	const raw: {
		path: string
		optional: boolean
		targets: string[]
	}[] = []

	const walk = (iface: string, prefix: string, seen: ReadonlySet<string>) => {
		const rec = ifaces.get(iface)
		if (!rec) return
		for (const m of rec.node.members) {
			if (!ts.isPropertySignature(m) && !ts.isMethodSignature(m)) continue
			if (
				!m.name ||
				!(ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))
			)
				continue
			const path = prefix ? `${prefix}.${m.name.text}` : m.name.text
			raw.push({
				path,
				optional: !!m.questionToken,
				targets: deprecationTargets(m)
			})
			// Followed only through a PROPERTY typed as another SDK interface —
			// that is a member an author reaches through this one, so the
			// runtime owes it too. A return type (`Promise<Result<WriteReceipt>>`)
			// is a question about shape, not about endowment, and is not
			// followed; `seen` stops a self-referential type from recurring.
			if (
				ts.isPropertySignature(m) &&
				m.type &&
				ts.isTypeReferenceNode(m.type) &&
				ts.isIdentifier(m.type.typeName)
			) {
				const next = m.type.typeName.text
				if (ifaces.has(next) && !seen.has(next))
					walk(next, path, new Set([...seen, next]))
			}
		}
	}

	for (const [name, rec] of ifaces)
		if (rec.file === "hooks.d.ts" && /Surface$/.test(name))
			walk(name, "", new Set([name]))

	// A replacement only counts once it is itself a declared member, which is
	// what makes "deprecated in favour of nothing" decidable without guessing
	// at prose.
	const paths = new Set(raw.map((r) => r.path))
	const byPath = new Map<string, DeclaredMember>()
	for (const r of raw) {
		const prev = byPath.get(r.path)
		byPath.set(r.path, {
			path: r.path,
			// Declared on two surfaces, optional on both, is optional.
			optional: (prev?.optional ?? true) && r.optional,
			deprecatedFor: [
				...new Set([
					...(prev?.deprecatedFor ?? []),
					...r.targets.filter((t) => paths.has(t))
				])
			]
		})
	}
	return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/** The two sandbox backends, which must endow the same ctx. */
const SANDBOX_SOURCES = [
	"lib/server/plugins/SesWorkerSandbox.ts",
	"lib/server/plugins/QuickJsSandbox.ts"
] as const

/**
 * The ctx object one backend hands a hook, read off the program it builds.
 *
 * The worker source is a `String.raw` block, so the file text IS that program's
 * source: lift `buildProgram` out of it, call it, and parse what comes back.
 * Anything that stops this working throws with what to do about it — a silent
 * empty read would make every assertion in this section vacuously pass.
 */
function endowedCtx(relPath: string): string[] {
	const path = join(SRC, relPath)
	const blocks = rawTemplates(path).filter((t) =>
		t.includes("function buildProgram")
	)
	if (blocks.length !== 1)
		throw new Error(
			`§5 expected exactly one String.raw worker block declaring ` +
				`buildProgram in ${relPath}; found ${blocks.length}. If the ` +
				`worker source moved or gained a \${…} substitution, teach ` +
				`rawTemplates about it — do not let this read empty.`
		)
	const worker = ts.createSourceFile(
		relPath,
		blocks[0]!,
		ts.ScriptTarget.Latest,
		true
	)
	let fn: ts.FunctionDeclaration | undefined
	const find = (n: ts.Node) => {
		if (ts.isFunctionDeclaration(n) && n.name?.text === "buildProgram")
			fn = n
		ts.forEachChild(n, find)
	}
	find(worker)
	if (!fn)
		throw new Error(`§5 found no buildProgram declaration in ${relPath}`)

	let program: string
	try {
		// `__PRELUDE` is the only free name buildProgram closes over. A new one
		// arrives here as a ReferenceError, which is the loud failure this
		// wants — not a program missing the lines that referenced it.
		//
		// `grants` is the sixth argument (plans/29 R-3): what the hook's kind
		// lets its ctx carry, derived host-side by `plugins/hookCtx.ts`. Read
		// at its WIDEST — an oracle's, both members — because this section
		// asks whether every declared member is one a backend can endow at
		// all; which kind gets which is that table's, proven by the sandbox
		// tests (`Object.keys(ctx)` per kind) and the boot's probe.
		program = (
			new Function(
				"__PRELUDE",
				`${fn.getText(worker)}\nreturn buildProgram`
			)("") as (
				source: string,
				hookName: string,
				inputJson: string,
				seedLabel: string,
				nowMs: number,
				grants: { storage: boolean; fetch: boolean }
			) => string
		)("", "conformanceProbe", "{}", "conformance", 0, {
			storage: true,
			fetch: true
		})
	} catch (e) {
		throw new Error(
			`§5 could not build ${relPath}'s guest program: ${String(e)}. ` +
				`buildProgram has grown a dependency this reader does not ` +
				`supply — pass it at the call above.`
		)
	}

	const sf = ts.createSourceFile(
		`${relPath}.program.js`,
		program,
		ts.ScriptTarget.Latest,
		true
	)
	const members: string[] = []
	const visit = (n: ts.Node) => {
		if (
			ts.isVariableDeclaration(n) &&
			ts.isIdentifier(n.name) &&
			n.name.text === "ctx" &&
			n.initializer &&
			ts.isObjectLiteralExpression(n.initializer)
		) {
			for (const p of n.initializer.properties) {
				// A spread would hide members behind a name this reader cannot
				// follow, so it is refused rather than skipped. (The core
				// scripts host builds its ctx with `Object.assign` — if a
				// backend ever does, that is invisible here too, and this
				// guard is where to notice it.)
				if (ts.isSpreadAssignment(p))
					throw new Error(
						`§5: ${relPath}'s ctx literal spreads a value this ` +
							`reader cannot expand. Endowments must be named.`
					)
				if (
					p.name &&
					(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
				)
					members.push(p.name.text)
			}
		}
		if (
			ts.isBinaryExpression(n) &&
			n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			ts.isPropertyAccessExpression(n.left) &&
			ts.isIdentifier(n.left.expression) &&
			n.left.expression.text === "ctx"
		)
			members.push(n.left.name.text)
		ts.forEachChild(n, visit)
	}
	visit(sf)
	return [...new Set(members)].sort()
}

/**
 * The object `ctx.storage` resolves to, from its one builder — its own members,
 * and the members of the one namespace nested inside it.
 *
 * Two levels, not one, because `storage.files` is an object rather than a
 * function and the SDK declares every member under it as a subject in its own
 * right. A reader that stopped at `files` would report `storage.files.stat` as
 * unendowed forever, or (worse, once `files` landed) let a half-built namespace
 * excuse the members it does not have.
 */
function storageHostMembers(): { top: string[]; files: string[] } {
	const path = join(SRC, "lib/server/plugins/storageHost.ts")
	const block = rawTemplates(path).find((t) =>
		t.includes("function makeStorageHost")
	)
	if (!block) throw new Error("§5 found no STORAGE_HOST_SOURCE to read")
	const sf = ts.createSourceFile(path, block, ts.ScriptTarget.Latest, true)
	const top: string[] = []
	const files: string[] = []
	const visit = (n: ts.Node) => {
		if (
			ts.isPropertyAssignment(n) &&
			ts.isIdentifier(n.name) &&
			n.name.text === "api" &&
			ts.isObjectLiteralExpression(n.initializer)
		)
			for (const p of n.initializer.properties) {
				if (!p.name || !ts.isIdentifier(p.name)) continue
				top.push(p.name.text)
				if (
					p.name.text === "files" &&
					ts.isPropertyAssignment(p) &&
					ts.isObjectLiteralExpression(p.initializer)
				)
					for (const q of p.initializer.properties)
						if (q.name && ts.isIdentifier(q.name))
							files.push(q.name.text)
			}
		ts.forEachChild(n, visit)
	}
	visit(sf)
	if (top.includes("files") && !files.length)
		throw new Error(
			"§5 read a `files` member on storageHost's api but could not read " +
				"its contents — teach storageHostMembers about its new shape " +
				"rather than letting the namespace excuse everything under it."
		)
	return { top: top.sort(), files: files.sort() }
}

/** The methods on the object `ctx.storage` resolves to, from its one builder. */
function storageHostApi(): string[] {
	return storageHostMembers().top
}

/** The stub endowed when the grant is absent — same methods, all refusing. */
function deniedStorageApi(relPath: string): string[] {
	const block = rawTemplates(join(SRC, relPath)).find((t) =>
		t.includes("__DENIED_STORAGE")
	)
	if (!block) throw new Error(`§5 found no __DENIED_STORAGE in ${relPath}`)
	const m = /__DENIED_STORAGE[\s\S]*?return \{([^}]*)\}/.exec(block)
	if (!m) throw new Error(`§5 could not read __DENIED_STORAGE in ${relPath}`)
	return m[1]!
		.split(",")
		.map((s) => s.split(":")[0]!.trim())
		.filter(Boolean)
		.sort()
}

/**
 * The one hand-written link between a ctx member and the module that builds it.
 *
 * See the section docblock: this is the limit. Add an entry the day a second
 * endowment becomes an object rather than a function.
 */
const endowedNested = (): Record<string, string[]> => ({
	storage: [
		...storageHostMembers().top,
		...storageHostMembers().files.map((k) => `files.${k}`)
	]
})

/**
 * Members a hook surface declares that no backend puts on `ctx`.
 *
 * Nothing below is fixed. Every one is a live gap, listed so the size of the
 * class is readable before anybody decides how to close it — and so that
 * closing one is a deletion here rather than a silent improvement.
 */
const UNENDOWED_HOOK_CTX: Deliberate[] = [
	{
		subject: "readOwnRows",
		reason:
			"Optional, and endowed by neither backend — which is honest, since " +
			"an optional member tells an author to feature-test it, and its " +
			"`@deprecated` tag now points somewhere real: `storage.get` and " +
			"`storage.query` are both endowed, so the migration it names is one " +
			"an author can actually make. Removing the pair is the SDK's call, " +
			"not the runtime's; endowing a member the SDK has already retired " +
			"would be the wrong direction."
	},
	{
		subject: "writeOwnRows",
		reason:
			"As `readOwnRows`: optional, unendowed, and deprecated in favour " +
			"of `storage.put` — which is endowed now, so the tag is a working " +
			"signpost rather than one pointing at nothing."
	},
	{
		subject: "readCore",
		reason:
			"⚠ `LifecycleCallbackSurface`'s whole reason to exist beside the event " +
			"surface — 'scoped core reads' is the first line of its docblock — " +
			"and no backend endows it. `CoreQuery` and `CorePage` beside it " +
			"are types with no producer. Declared ahead of a host-side reader " +
			"that would have to make the table allowlist and the pagination " +
			"real, and nothing in `src/` mentions any of the three."
	}
]

/**
 * Members a backend puts on `ctx` that no hook surface declares.
 *
 * The mirror of the list above and the same defect from the other end: a
 * capability an author cannot discover from the types is one only a reader of
 * this repo's worker sources knows about.
 */
const UNDECLARED_HOOK_CTX: Deliberate[] = [
	{
		subject: "random",
		reason:
			"The per-call deterministic RNG, and load-bearing rather than a " +
			"convenience: SES freezes `Math.random`, so `ctx.random` is the " +
			"ONLY stream a hook has on that backend. Named on no surface, so " +
			"an author reading the SDK cannot know it is there."
	},
	{
		subject: "now",
		reason:
			"The pinned clock, same story as `random` — `Date.now` is frozen " +
			"or overwritten and `ctx.now()` is the replay-safe replacement. " +
			"Undeclared."
	},
	{
		subject: "storage.read",
		reason:
			"The older file spelling, still endowed and described by no type. " +
			"It predates `ExtensionStorage` — which the runtime now endows " +
			"beside it, `files.*` included — and is kept because hooks call it " +
			"synchronously and unawaited, which a promise-returning `files." +
			"read` cannot replace without breaking every one of them. Declaring " +
			"the six on the SDK's surfaces, or migrating the callers and " +
			"dropping them, is the follow-up; until one of those happens they " +
			"are a capability only a reader of the worker sources can find."
	},
	{
		subject: "storage.write",
		reason: "As `storage.read`."
	},
	{
		subject: "storage.exists",
		reason: "As `storage.read`."
	},
	{
		subject: "storage.remove",
		reason: "As `storage.read`."
	},
	{
		subject: "storage.list",
		reason: "As `storage.read`."
	},
	{
		subject: "storage.size",
		reason: "As `storage.read`."
	}
]

/**
 * `@deprecated` tags that send an author to a member nothing endows.
 *
 * A distinct and worse condition than a plain gap, which is why it is its own
 * list. A missing member fails at the call and the author goes looking. A
 * member marked deprecated in favour of a missing one is the SDK actively
 * directing traffic away from what works and towards what does not — and both
 * of these do exactly that, since the deprecated member is unendowed too, so
 * the tag is a signpost from nothing to nothing.
 */
const MISDIRECTING_DEPRECATIONS: Deliberate[] = [
	// `readOwnRows → storage.get`, `readOwnRows → storage.query` and
	// `writeOwnRows → storage.put` lived here for as long as the replacements
	// did not exist. They do now (`plugins/storageHost.ts`, endowed on both
	// backends and adapted to the SDK's shape by `plugins/prelude.ts`), so the
	// tags point somewhere real and the entries are gone rather than reworded.
]

describe("§5 hook context — every declared member is one the runtime endows", () => {
	const declared = declaredHookCtx()
	const declaredPaths = declared.map((d) => d.path)
	const perBackend = SANDBOX_SOURCES.map((f) => [f, endowedCtx(f)] as const)
	const nested = endowedNested()
	// The UNION across backends, not one of them: the floor test is what
	// reports a divergence, and until it is settled a member endowed on only
	// one backend must still be visible to the undeclared-endowment check
	// rather than vanish because the other backend was read first.
	const endowed = [
		...new Set(
			perBackend.flatMap(([, ms]) =>
				ms.flatMap((m) => [
					m,
					...(nested[m] ?? []).map((k) => `${m}.${k}`)
				])
			)
		)
	].sort()

	test("both sides are readable, and the backends agree on what they endow", () => {
		// A silent empty read on either side would make every assertion below
		// vacuously pass. If the declared side is empty the SDK has not been
		// built — `npm run sdk:build`.
		expect(declaredPaths.length).toBeGreaterThan(0)
		expect(declaredPaths).toContain("signal")
		expect(declaredPaths).toContain("storage.query")
		expect(endowed.length).toBeGreaterThan(0)
		expect(endowed).toContain("storage")

		const [ses, quickjs] = perBackend
		expect(
			quickjs![1],
			`The two sandbox backends endow different ctx members:\n` +
				`  • ${ses![0]}: ${ses![1].join(", ")}\n` +
				`  • ${quickjs![0]}: ${quickjs![1].join(", ")}\n\n` +
				`A capability on one backend and not the other is a plugin that ` +
				`works until it is run on the other one. Endow both, or make the ` +
				`absent side a stub that refuses by name the way __DENIED_FETCH ` +
				`does.`
		).toEqual(ses![1])

		// The refusing stub has to carry the same methods as the real store,
		// or a plugin without the grant gets "is not a function" instead of
		// "permission not granted" — an author debugging the wrong problem.
		for (const f of SANDBOX_SOURCES)
			expect(
				deniedStorageApi(f),
				`${f}'s __DENIED_STORAGE does not mirror storageHost's api`
			).toEqual(storageHostApi())
	})

	test("every member a hook surface declares is one the runtime endows", () => {
		const missing = declaredPaths.filter((p) => !endowed.includes(p))
		expectExactlyExcused(missing, UNENDOWED_HOOK_CTX, {
			list: "UNENDOWED_HOOK_CTX",
			unwired:
				"member(s) the SDK declares on a hook's ctx that neither " +
				"backend puts in it — a capability an author is typed into " +
				"calling and cannot",
			fix: "Endow it in both runtimes' buildProgram"
		})
	})

	test("every member the runtime endows is one a hook surface declares", () => {
		const foreign = endowed.filter((m) => !declaredPaths.includes(m))
		expectExactlyExcused(foreign, UNDECLARED_HOOK_CTX, {
			list: "UNDECLARED_HOOK_CTX",
			unwired:
				"member(s) the runtime puts on ctx that no hook surface " +
				"declares — a capability only a reader of the worker sources " +
				"can find",
			fix: "Declare it on the hook surfaces in the SDK's hooks.ts"
		})
	})

	test("no member is deprecated in favour of one nothing endows", () => {
		const misdirecting = declared
			.flatMap((d) =>
				d.deprecatedFor
					.filter((t) => !endowed.includes(t))
					.map((t) => `${d.path} → ${t}`)
			)
			.sort()
		expectExactlyExcused(misdirecting, MISDIRECTING_DEPRECATIONS, {
			list: "MISDIRECTING_DEPRECATIONS",
			unwired:
				"@deprecated tag(s) naming a replacement the runtime does not " +
				"endow — the SDK telling an author to migrate to something " +
				"that is not there",
			fix: "Endow the replacement, or drop the tag until it exists"
		})
	})
})
