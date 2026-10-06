/**
 * **Every slot a shipped node type declares is named by the spec that uses it.**
 * Both sides derived from the code; neither written down.
 *
 * ## The class of defect this closes
 *
 * Three node families have now shipped with a declared slot that no spec
 * *named* in the node's config — `narrate.ts:1.10.0`, `respond.ts:1.16.0`, and
 * `session-history`'s `limit` (`respond`/`narrate`/`narrate-character` called
 * `C.sessionHistory.v1({ scope })` with no `params: slot.params()`). Each time
 * the shape was identical and each time it was found by hand.
 *
 * The seam is one loop of the executor. `resolveInput`
 * (`sdk/src/executor.ts:767`) walks the config keys that are **present**,
 * verbatim:
 *
 *     const cfg: Record<string, unknown> = { ...node.config }
 *     for (const { path, ref } of collectDataRefs(node.config)) {
 *         setPath(cfg, path, readPort(scope.get(ref.node), ref.port))
 *     }
 *     for (const [k, v] of Object.entries(cfg)) {
 *         if (isSlotRef(v)) cfg[k] = resolveSlot(node, v as SlotRef)
 *     }
 *     return cfg
 *
 * A slot the spec never mentioned is not a key, so nothing resolves it and the
 * binding reads `input.params?.limit` off an `undefined`. Meanwhile
 * `config/panel/declarations.ts` generates one control per **declared** slot
 * from the registry row — it never consults the spec's config except to skip a
 * slot wired to *another* node. So the panel renders the control, the scope
 * chain stores what a person sets, and the run never reads it.
 *
 * ⚠ **Why the existing suites cannot catch it.** `nodeParams.test.ts` says so
 * in its own header: it hands a binding an input object it wrote itself, which
 * proves a binding reads `params.limit` and is structurally unable to ask
 * whether a *spec* supplies one. `registrySync.int.test.ts` and
 * `registryHashes.test.ts` pin the declaration side alone. `specHashes.test.ts`
 * pins the document byte-for-byte, so it locks an unwired node in place rather
 * than reporting it. And the parity corpus is blind by construction: a control
 * that does nothing produces the same bytes as a control at its default.
 *
 * ## How the two sides are derived
 *
 * **Declared** comes off the type registry the app itself syncs at boot —
 * `getDefinition()` over the descriptors `@serene-pub/contracts` registers on import,
 * which is the same map `bootstrap.ts` snapshots through `allDefinitions()`. Not a
 * list: a slot added to a contract arrives here without an edit to this file.
 *
 * **Wired** comes off the built documents — `CORE_SPECS[].build()`, the exact
 * call `seedCoreSpecs` makes in `seed.ts` — matched on the `SlotRef` shape
 * (`{ __ref: 'slot', slot }`) that `slot.params()` produces, never on a string
 * spelling of it.
 *
 * ⚠ **The walk is the one thing that could lie, so it is guarded.** An empty
 * catalog, a renamed descriptor field, or a `getDefinition` that returns nothing
 * would report zero unwired slots and go green on having asked nothing. So the
 * walk is asserted to have visited every shipped spec, to have resolved a
 * descriptor for every node, to have seen params slots, and to have found
 * correctly-wired ones — before anything is concluded from its silence.
 *
 * ## The debt is paid — and the ledger stays, at zero
 *
 * The first run of this walk found 17 declared-and-unwired slots across the
 * shipped specs, in three distinct shapes, and fixing them was spec work
 * rather than test work. Eleven closed as shapes 1 and 2, the last three by the
 * catalog's `params: slot.params()` on the three reply specs' `generate`
 * node. The last ten were shape 3 — `embed-text.connection`, a slot with no
 * reader — and they closed on 2026-10-05 by owner ruling D-c ("remove
 * `embed-text`'s inert connection control"), which deleted the declaration.
 * So the ledger stands at **zero**. It is still derived, asserted in **both**
 * directions plus by count, so a new instance cannot hide behind a line and
 * the total cannot drift without an edit here. Read `LEDGER`'s own comment
 * before reading a green tick here as more than "the number cannot grow
 * silently".
 */

import { describe, it, expect } from "vitest"
import { CORE_SPECS } from "$lib/server/pipelines/specs"
import { getDefinition, isSlotRef, type SlotDecl } from "@serene-pub/sdk"
import { UNREAD_ALLOW_LIST } from "$lib/server/pipelines/boot/unreadAllowList"

/**
 * Slot kinds the **host** supplies, so a spec that never names one is correct.
 *
 * Both are read by the executor straight out of the scope chain at
 * `config[node.key][slotName]`, never through `resolveInput` — which is exactly
 * why they are exempt and every other kind is not.
 *
 *   · `scripts` — `applyChainsAt` reads `config[node.key]?.[slotName]?.['']`,
 *     and the interior points read `config[node.key]?.['scripts']?.[point]`.
 *     A spec cannot name one: `SlotRef['slot']` has no `'scripts'` member, and
 *     the one scripts slot with a non-default name (`castScripts`) proves the
 *     point — the executor finds it by iterating the *declarations*.
 *   · `wire` — `config[node.key]?.['wire']`, falling back to the payload and
 *     then to the declaration's own `format`. No shipped type declares one
 *     today; classified here so the day one does, it does not land in the
 *     enforced set by accident.
 *
 * Every other kind (`connection`, `sampling`, `prompts`, `template`,
 * `parameters`, `variables`) reaches its binding only as a resolved config key,
 * so it must be named. `connection` and `sampling` have host-side *fallbacks*
 * — `capabilityTarget.ts`'s `capabilityDefault` tier and `resolveSlot`'s
 * `world.activeConnection` — but a fallback is not a supply: the tier the
 * fallback replaces is `pipelineConfig`, fed by `refId(p.connection)` in
 * `host.ts`, and `p` is `resolveInput`'s output. An unnamed connection slot
 * means the run still happens and the panel's picker for that node does not.
 */
const HOST_SUPPLIED = new Set(["scripts", "wire"])

interface Finding {
	/** Version-free, so an unrelated semver bump does not churn the ledger. */
	key: string
	sentence: string
	slotKind: string
}

interface Walk {
	findings: Finding[]
	specsWalked: string[]
	nodesWalked: number
	/** Nodes whose pin resolved to no descriptor — a walk that asked nothing. */
	unknownPins: string[]
	/** Every slot kind actually observed on a shipped type. */
	kindsSeen: Set<string>
	/** Declared-and-named, per kind: the half that proves the match works. */
	wired: Finding[]
}

/** The document shape the walk needs — a subset of the SDK's `SpecDocument`. */
interface WalkableDoc {
	id: string
	version: string
	nodes: Array<{
		key: string
		definitionId: string
		definitionVersion: number
		config?: Record<string, unknown>
	}>
}

/**
 * A slot is **named** when the node's config carries the slot's own key holding
 * a `SlotRef` for that slot — `params: slot.params()`, or the shared form
 * `params: slot.params({ node: 'rank' })`, which resolves against the owner's
 * config and is equally wired.
 *
 * Two halves, and both are load-bearing.
 *
 * **The key must *be* the slot name**, because the executor writes the resolved
 * value back at the **config key** (`cfg[k] = resolveSlot(...)`) and every
 * binding reads it at the slot's name (`input.params`, `input.prompts`). A ref
 * parked under some other key would resolve and land where nothing looks — the
 * same defect, one step along.
 *
 * **The value must be a `SlotRef`**, because a literal (`params: { limit: 5 }`)
 * is passed through untouched: the binding gets a number, but `resolveSlot`
 * never runs, so `config[node.key]['params']` — the only place the panel and
 * the scope chain can write — is never read. The control still renders and
 * still does nothing, which is this file's whole subject.
 *
 * ⚠ **Why the ref's own `slot` must match too.** `resolveSlot`'s params branch
 * reads `config[targetKey]?.[slotName]` where `slotName` is `ref.slot`
 * (`sdk/src/executor.ts:879`), and the generic branch ends
 * `return config[targetKey]?.[slotName] ?? {}` — so a `parameters` slot
 * declared under any key but `params` cannot resolve at all. Holding the two
 * together here is what makes that unrepresentable rather than merely unused.
 *
 * Nothing in the shipped catalog trips either half today (every declared slot's
 * config is a matching ref or absent outright), so the strict reading costs
 * nothing and closes both variants.
 */
const isNamed = (
	config: Record<string, unknown> | undefined,
	slotName: string
) => {
	const at = config?.[slotName]
	return isSlotRef(at) && at.slot === slotName
}

const walk = (docs: WalkableDoc[]): Walk => {
	const out: Walk = {
		findings: [],
		specsWalked: [],
		nodesWalked: 0,
		unknownPins: [],
		kindsSeen: new Set(),
		wired: []
	}

	for (const doc of docs) {
		out.specsWalked.push(doc.id)
		for (const node of doc.nodes) {
			out.nodesWalked++
			const pin = `${node.definitionId}@${node.definitionVersion}`
			const descriptor = getDefinition(pin)
			if (!descriptor) {
				out.unknownPins.push(`${doc.id} node "${node.key}" (${pin})`)
				continue
			}
			const slots = (descriptor.slots ?? {}) as Record<string, SlotDecl>
			for (const [slotName, decl] of Object.entries(slots)) {
				out.kindsSeen.add(decl.kind)
				if (HOST_SUPPLIED.has(decl.kind)) continue
				const finding: Finding = {
					key: `${doc.id} node "${node.key}" slot "${slotName}"`,
					sentence:
						`${doc.id}@${doc.version} node "${node.key}" (${pin}) declares a ` +
						`${slotName} slot the spec never wires — the control renders ` +
						`and does nothing.`,
					slotKind: decl.kind
				}
				if (isNamed(node.config, slotName)) out.wired.push(finding)
				else out.findings.push(finding)
			}
		}
	}
	return out
}

/** The shipped catalog, built the way `seedCoreSpecs` builds it. */
const shipped = (): WalkableDoc[] =>
	CORE_SPECS.map((s) => s.build() as WalkableDoc)

/**
 * The slots that are declared, rendered as controls, and wired by nobody —
 * **today**, on this branch, each one measured rather than assumed.
 *
 * ⚠ **Derived, not written** (R-12, 2026-09-16). Every remaining entry is shape
 * 3 — a slot with no reader — and "no reader" is exactly what
 * `boot/declaredReads.ts` measures from the handlers' own `reads`
 * declarations. So the ledger here is computed from that file's ONE allow-list:
 * a slot a definition is allowed to declare unread is, on every shipped node of
 * that definition, a slot the spec is correctly not naming. One reason, written
 * once, read by both guards. Empty today: the allow-list holds no slot line.
 *
 * Three distinct shapes were in here. **Shapes 1 and 2 are closed** — eleven
 * entries, deleted rather than annotated, because a ledger that outlives its
 * debt is an exemption nobody decided to grant:
 *
 *  1. **`params` on the two relationship queries** — `respond`'s
 *     `gather.relationshipsPerspectives.read` and `gather.relationshipsKnown.read`
 *     wire `params: slot.params()`. `bindings.ts` reads
 *     `input?.params?.maxEntries` on both, and neither spec named the slot, so
 *     `capRelationships` was always called with `undefined` — which it reads as
 *     *no ceiling* and returns the section whole. Behaviour-preserving to close:
 *     `maxEntries` carries no declared default now (uncapped is not a number
 *     `min: 0` can hold), so an untouched install still resolves `undefined`.
 *  2. **`connection`/`sampling` on `generate`** — all three reply specs name
 *     both. `host.ts` forwards
 *     `connectionId: refId(p.connection)` and `samplingId: refId(p.sampling)`,
 *     and its own comment says omitting that forwarding "was why the panel's
 *     Connection and Sampling pickers on the reply step did nothing"; the host
 *     half was fixed and the spec half was not, so `p.connection` was
 *     `undefined`, the `pipelineConfig` tier of `capabilityTarget.ts` said
 *     nothing, and the run fell back to the instance default while
 *     `contextBudget` and `prompt` — which read the same slots by reference —
 *     followed the pick. `runtime/samplingSlotDispatch.int.test.ts` is where
 *     that is asserted end to end.
 *  3. **Slots with no reader at all** — closed 2026-10-05, ten entries, the
 *     only shape naming the slot could not fix. `core:oracle/embed-text@1`'s
 *     `connection` was never consulted — `host.ts` embeds through the active
 *     embedding connection (`embeddingApi()`) — so its fix was a reader or a
 *     deleted declaration, and owner ruling D-c chose the deletion: a pipeline
 *     never chooses its embedding connection. The one embedding slot that IS
 *     read, `core:task/query-windows@1`'s, is wired (`slot.connection()`) and
 *     held at the active connection by policy (`config/heldSlots.ts`), so it
 *     renders no control and adds no line here.
 *
 * ⚠ **`generate-text`'s `params.stopSequences` was the third shape-1 group and
 * it is closed.** It is worth keeping the sequence, because the halves landed
 * months apart and the gap between them is the whole subject of this file. The
 * ruling of 2026-09-10 settled the open question — an author's EXPLICIT
 * sequence rides either wire, while the completion template's delimiters and the
 * scene's speaker labels ride the completion wire only — and with it: the five
 * local compositions became one (`connections/stops.ts`), `DispatchRequest`
 * carries `stopSequences`, `BaseConnectionAdapter` gained a `withStops` seam
 * beside `withCompiledPrompt`/`withAttachments`, and the binding reads
 * `input?.params?.stopSequences`. Every piece existed except the spec half,
 * which is not in this repo: the three reply specs live in
 * `@serene-pub/core-catalog` and called `C.generateText.v1({…})` with no
 * `params: slot.params()`, so `resolveInput` never formed the key and the reader
 * saw `undefined` on every turn. They name it now (content addressing carries
 * the rewritten documents to an install that has already booted) — see
 * the wired-side assertion below, which is what tells a fix apart from a
 * deleted ledger line.
 */
const ledgerFrom = (docs: WalkableDoc[]): Map<string, string> => {
	const out = new Map<string, string>()
	// Only SLOT entries of the allow-list apply here: a parameter field
	// (`params.priority`) is a control inside a slot the spec does name, and
	// an in-port is not a slot at all. Filtered on the entry's declared
	// `kind`, which `declaredReads.test.ts` holds to the walk's own finding.
	const allowedSlots = UNREAD_ALLOW_LIST.filter((a) => a.kind === "slot")
	for (const doc of docs)
		for (const node of doc.nodes) {
			const pin = `${node.definitionId}@${node.definitionVersion}`
			const descriptor = getDefinition(pin)
			const slots = (descriptor?.slots ?? {}) as Record<string, SlotDecl>
			for (const a of allowedSlots)
				if (a.definition === pin && slots[a.name])
					out.set(
						`${doc.id} node "${node.key}" slot "${a.name}"`,
						`shape 3 — ${a.reason}`
					)
		}
	return out
}

const LEDGER = ledgerFrom(shipped())

const result = walk(shipped())

describe("the walk is capable of the measurement it is used for", () => {
	/**
	 * ⚠ Read this before believing anything below it. Every conclusion in this
	 * file is drawn from an *absence*, and a walk that visited nothing produces
	 * the same absence as a catalog with nothing wrong in it.
	 */
	it("built every shipped spec and resolved a descriptor for every node", () => {
		expect(CORE_SPECS.length).toBeGreaterThan(0)
		expect(result.specsWalked.sort()).toEqual(
			CORE_SPECS.map((s) => s.slug).sort()
		)
		expect(result.nodesWalked).toBeGreaterThan(0)
		// A pin the registry cannot resolve is a node this file silently skipped
		// — declared slots and all.
		expect(
			result.unknownPins,
			"these nodes were walked past without asking about their slots"
		).toEqual([])
	})

	it("saw declared params slots, and saw specs that wire them", () => {
		const params = [...result.findings, ...result.wired].filter(
			(f) => f.slotKind === "parameters"
		)
		expect(
			params.length,
			"no node in the whole catalog declares a parameters slot — the " +
				"descriptor field this file reads has moved"
		).toBeGreaterThan(0)
		// The other half: a matcher that recognised nothing would report every
		// slot unwired, which reads as a catastrophe rather than as a broken
		// test. `session-history` is named because it is today's instance.
		expect(
			result.wired.some(
				(f) =>
					f.key ===
					'core:spec/chat-respond node "gather.history.read" slot "params"'
			),
			"`respond`'s history node must show up as wired. Either the " +
				"matcher stopped recognising the SlotRef shape, or the history " +
				"node's params wiring has regressed and it is genuinely unwired — " +
				"the failure below says which."
		).toBe(true)
		expect(
			result.wired.filter((f) => f.slotKind === "parameters").length
		).toBeGreaterThan(1)
	})

	it("classified every slot kind the shipped types declare", () => {
		// A kind that is neither enforced nor exempt would be silently enforced
		// by falling through — or silently skipped, if the fall-through went the
		// other way. Either is a decision nobody made.
		const enforced = [...result.kindsSeen].filter(
			(k) => !HOST_SUPPLIED.has(k)
		)
		expect(enforced.sort()).toEqual([
			"connection",
			"parameters",
			"prompts",
			"sampling",
			"template",
			"variables"
		])
		// `parameters` by name, so renaming the kind value out from under this
		// file fails here rather than quietly emptying the enforced set.
		expect(result.kindsSeen.has("parameters")).toBe(true)
		expect(result.kindsSeen.has("scripts")).toBe(true)
	})
})

describe("every declared slot is named by the spec that uses it", () => {
	it("no shipped spec leaves a declared slot unwired", () => {
		const open = result.findings.filter((f) => !LEDGER.has(f.key))
		expect(
			open.map((f) => f.sentence).sort(),
			"a node type declares this slot, `config/panel/declarations.ts` " +
				"renders a control for it, and `resolveInput` resolves only the " +
				"config keys a spec named — so the value a person sets is stored " +
				"and never read. Wire it (`" +
				"params: slot.params()`), or delete the declaration."
		).toEqual([])
	})

	it("no ledger entry has quietly stopped applying", () => {
		const found = new Set(result.findings.map((f) => f.key))
		const stale = [...LEDGER.keys()].filter((k) => !found.has(k))
		expect(
			stale.sort(),
			"this slot is wired now (or the node is gone). Delete its ledger " +
				"line — a ledger that outlives its debt is an exemption nobody " +
				"decided to grant."
		).toEqual([])
	})

	/**
	 * The total, as a number this file has to be edited to move.
	 *
	 * The two assertions above are each satisfiable by editing the ledger in one
	 * direction: a new finding is absorbed by adding a line, and a fixed one by
	 * deleting it. Neither notices that the ledger as a whole grew. This does,
	 * and it is the assertion that made closing shapes 1 and 2 a visible event
	 * rather than eight quiet deletions.
	 *
	 * ⚠ **0** (owner ruling 2026-10-05, D-c: "remove `embed-text`'s inert
	 * connection control"). The number may only go DOWN without a ruling, and
	 * it is at the floor: a new entry is a slot with no reader anywhere in the
	 * app, so adding one means shipping a control that is inert by
	 * construction.
	 *
	 * It was 10 — `embed-text.connection` on the two retrieval arms
	 * (`semantic.arm.embed`, `names.arm.embed`) of each of the five specs that
	 * retrieve — held at the star so no person ever saw the control. The
	 * ruling deleted the slot rather than reading it, so all ten closed at
	 * once. ⚠ The hold did not go with it: `query-windows` declares its own
	 * embedding connection now and reads it, held at the active embedding
	 * connection by policy (`isHeldConnectionSlot`) — read, so no ledger line,
	 * and held, so no control.
	 *
	 * Derived, so the two ways it can move are both visible: a new allow-list
	 * SLOT line in `unreadAllowList.ts` (a ruling), or a spec gaining a node of
	 * an allow-listed definition (a spec edit).
	 */
	it("stands at zero open entries", () => {
		expect(
			LEDGER.size,
			"the ledger's size moved. It is at zero; up is a new inert control, " +
				"and needs the ruling that decided to ship one."
		).toBe(0)
		const kindOf = new Map(result.findings.map((f) => [f.key, f.slotKind]))
		// By kind as well, so a regression cannot be absorbed by a line that
		// merely looks plausible — `connection` is where the last ten were,
		// and `parameters` is the group the reply specs' wiring emptied.
		expect(
			[...LEDGER.keys()].filter((k) => kindOf.get(k) === "connection")
				.length
		).toBe(0)
		expect(
			[...LEDGER.keys()].filter((k) => kindOf.get(k) === "parameters")
				.length
		).toBe(0)
	})

	/**
	 * The hold that replaced the ten (2026-10-05): the retrieval specs' one
	 * embedding connection is `query-windows`' own, NAMED by the spec — so it
	 * is read and not inert — and the embed steps declare none at all.
	 */
	it("the semantic arm's queries step wires its own embedding connection", () => {
		const wired = new Set(result.wired.map((f) => f.key))
		for (const slug of [
			"core:spec/chat-respond",
			"core:spec/chat-narrate",
			"core:spec/chat-side-character"
		])
			expect(
				wired.has(
					`${slug} node "semantic.arm.queries" slot "connection"`
				),
				`${slug}'s queries step does not name its connection slot — ` +
					`Automatic would read no connection and never search by meaning`
			).toBe(true)
		expect(
			[...result.findings, ...result.wired].filter((f) =>
				/node "(semantic|names)\.arm\.embed" slot "connection"/.test(
					f.key
				)
			)
		).toEqual([])
	})

	/**
	 * The half that proves the wiring landed in the documents rather than
	 * only in the ledger. A deleted ledger line and a wired slot look identical
	 * to the two assertions above — both leave `findings` short — so the nine
	 * slots shapes 1 and 2 closed on this node are named here on the WIRED side.
	 */
	it("all three reply specs wire the generate node's connection, sampling and params", () => {
		const wired = new Set(result.wired.map((f) => f.key))
		const missing = [
			"core:spec/chat-respond",
			"core:spec/chat-narrate",
			"core:spec/chat-side-character"
		]
			.flatMap((slug) =>
				["connection", "sampling", "params"].map(
					(s) => `${slug} node "generate" slot "${s}"`
				)
			)
			.filter((k) => !wired.has(k))
		expect(
			missing,
			"the reply step's own Connection/Sampling pick reaches `dispatch` " +
				"only through these — without them `refId(p.connection)` is null " +
				"and `resolveCapabilityTarget` falls to the instance default, " +
				"while `contextBudget` and `prompt` follow the pick. `params` is " +
				"the same shape one slot along: without it the stop sequences a " +
				"person typed reach `input?.params?.stopSequences` as `undefined`."
		).toEqual([])
	})

	/** The same, for the two relationship reads shape 1 closed. */
	it("respond wires the params slot on both relationship reads", () => {
		const wired = new Set(result.wired.map((f) => f.key))
		for (const node of [
			"gather.relationshipsPerspectives.read",
			"gather.relationshipsKnown.read"
		])
			expect(
				wired.has(`core:spec/chat-respond node "${node}" slot "params"`),
				`${node} does not name its params slot — capRelationships is ` +
					`back to being called with undefined on every turn`
			).toBe(true)
	})

	/**
	 * The image render's `params`, which arrived with the slot itself.
	 *
	 * `core:oracle/generate-image@1` declared no parameters slot at all, so
	 * `streaming` is the first thing a person can set on this node — and the
	 * spec naming it is the whole of what makes the control live. Unnamed, the
	 * panel would draw the picker, the scope chain would store `off`, and
	 * `input?.params` would be `undefined` on every render.
	 */
	it("the image spec wires the render node's params slot", () => {
		const wired = new Set(result.wired.map((f) => f.key))
		expect(
			wired.has('core:spec/chat-generate-image node "render" slot "params"'),
			"the render node does not name its params slot — `streaming` is a " +
				"control that stores and is never read"
		).toBe(true)
	})
})

describe("the check fails when a slot goes unwired", () => {
	/**
	 * **Fail-first, against the real document.**
	 *
	 * The `params` key is stripped off `respond`'s own history node — the exact
	 * node, the exact slot, the exact defect that shipped — rather than a
	 * hand-built fixture, so the check is proven against the shape the catalog
	 * actually produces. A hand-built document would still pass if the real
	 * `SlotRef` serialisation moved.
	 */
	it("names the node when `params: slot.params()` is removed", () => {
		// Copied down to the config object before anything is removed.
		// `CoreSpec.build` compiles fresh today, but a memoising build would
		// make a `delete` here corrupt the module-level walk above — a
		// fail-first fixture that breaks the tests it exists to justify.
		const docs: WalkableDoc[] = shipped().map((d) => ({
			...d,
			nodes: d.nodes.map((n) => ({ ...n, config: { ...n.config } }))
		}))
		const respond = docs.find((d) => d.id === "core:spec/chat-respond")!
		const history = respond.nodes.find(
			(n) => n.key === "gather.history.read"
		)!
		expect(
			isNamed(history.config, "params"),
			"the fixture cannot demonstrate a removal of something absent"
		).toBe(true)
		delete history.config!.params

		const broken = walk(docs)
		const sentences = broken.findings.map((f) => f.sentence)
		expect(sentences).toContain(
			`core:spec/chat-respond@${respond.version} node "gather.history.read" ` +
				`(core:query/session-history@1) declares a params slot the spec ` +
				`never wires — the control renders and does nothing.`
		)
		// And it is a *new* finding, not one the ledger already absorbs.
		expect(
			broken.findings.filter((f) => !LEDGER.has(f.key)).map((f) => f.key)
		).toEqual([
			'core:spec/chat-respond node "gather.history.read" slot "params"'
		])
	})
})
