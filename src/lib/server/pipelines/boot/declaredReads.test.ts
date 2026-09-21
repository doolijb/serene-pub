/**
 * **Every declared in-port, slot and parameter on a bound core definition is
 * read by the handler bound to it** — and everything a handler declares it
 * reads, the definition supplies (R-12).
 *
 * The header of `declaredReads.ts` says what is measured and why the reverse
 * direction needed a mechanism at all. This file is the assertion, in the
 * shape `paramsSlotWiring.test.ts` set: prove the walk asked something before
 * believing its silence, assert the allow-list in BOTH directions and by
 * count, print the allow-list so it cannot go quietly stale, and prove the
 * check fails against the real table with one declaration bent.
 *
 * ⚠ Both halves of the measurement come off the code. **Declared** is the
 * registry `@serene-pub/contracts` registers on import — the same map
 * `bootstrap.ts` snapshots — and **read** is the `reads<…>()` declaration on
 * every registration in `runtime/bindings*.ts`, typed against the same
 * contract. Neither is a list kept here: a port added to a definition arrives
 * with no edit to this file, and so does a read added to a handler.
 */

import { describe, it, expect } from "vitest"
import { getDefinition, reads, readsOf, ok } from "@serene-pub/sdk"
import type * as C from "@serene-pub/contracts"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import {
	UNREAD_ALLOW_LIST,
	allowKey,
	checkDeclaredReads,
	openFindings,
	renderAllowList,
	staleAllowances
} from "$lib/server/pipelines/boot/declaredReads"

const report = checkDeclaredReads()

describe("the walk is capable of the measurement it is used for", () => {
	/**
	 * ⚠ Every conclusion below is drawn from an absence, and a walk that
	 * visited nothing produces the same absence as a table with nothing wrong
	 * in it. So: it walked, every bound pin resolved, every handler carries a
	 * declaration, and the definitions it walked declare ports AND params.
	 */
	it("walked every bound handler and resolved its definition", () => {
		expect(report.walked.length).toBeGreaterThan(40)
		expect(
			report.unknownPins,
			"a bound id the registry cannot resolve — bindingCompat.ts point 1"
		).toEqual([])
	})

	it("every core handler declares what it reads", () => {
		expect(
			report.undeclaredHandlers,
			"a handler with no `reads<…>()` is a handler this file cannot ask " +
				"about — its declared ports and params are silently unchecked"
		).toEqual([])
	})

	it("saw in-ports, slots and parameters, and saw them read", () => {
		const ports = report.walked.flatMap((w) => w.ports)
		const slots = report.walked.flatMap((w) => w.slots)
		const params = report.walked.flatMap((w) => w.params)
		expect(
			ports.length,
			"no walked definition declares an in-port"
		).toBeGreaterThan(20)
		expect(
			slots.length,
			"no walked definition declares a slot"
		).toBeGreaterThan(10)
		expect(
			params.length,
			"no walked definition declares a parameter"
		).toBeGreaterThan(40)
		// The other half: a declaration the walk recognised as READ. The
		// vector mechanism's `topK` is named because it is the defect this
		// whole family of guards was written for.
		const search = readsOf(coreBindings()["core:query/vector-search@1"])
		expect(search?.params).toContain("topK")
		expect(
			report.unread.some(
				(f) =>
					f.key ===
					allowKey("core:query/vector-search@1", "params.topK")
			),
			"`topK` is declared AND read, so it must not be a finding"
		).toBe(false)
	})
})

describe("every declared name is read, and every read is declared", () => {
	it("no bound definition declares an in-port, slot or parameter its handler does not read", () => {
		expect(
			openFindings(report)
				.map((f) => f.sentence)
				.sort(),
			"a definition declares this, the panel renders it or a spec can wire " +
				"it, and the handler never looks. Read it, cull it from the " +
				"declaration, or — with a reason naming what closes it — add it to " +
				"UNREAD_ALLOW_LIST."
		).toEqual([])
	})

	it("no handler declares a read its definition does not supply", () => {
		expect(
			report.undeclared,
			"structuralCompat's own sentence: the handler says it reads a name " +
				"the definition declares nowhere. `reads<…>()` types the arrays, " +
				"so this can only happen when the definition moved under it."
		).toEqual([])
	})
})

describe("the allow-list", () => {
	it("is printed, so it cannot go quietly stale", () => {
		// eslint-disable-next-line no-console
		console.info(
			`\n[declaredReads] ${UNREAD_ALLOW_LIST.length} declared name(s) allowed ` +
				`to go unread, each with what closes it:\n${renderAllowList()}\n`
		)
		expect(renderAllowList().length).toBeGreaterThan(0)
	})

	it("has no entry that has quietly stopped applying", () => {
		expect(
			staleAllowances(report).map((a) => allowKey(a.definition, a.name)),
			"this name is read now (or the definition does not declare it). " +
				"Delete its line — a ledger that outlives its debt is an exemption " +
				"nobody decided to grant."
		).toEqual([])
	})

	it("carries a reason on every line", () => {
		for (const a of UNREAD_ALLOW_LIST)
			expect(
				a.reason.trim().length,
				`${allowKey(a.definition, a.name)} is allowed with no reason`
			).toBeGreaterThan(40)
	})

	/**
	 * The total, as a number this file has to be edited to move.
	 *
	 * ⚠ **Two.** `embed-text.connection` (embeddings-as-connections) and
	 * `build-keeper-context.afterWrite` (an ordering edge). It was three until
	 * 2026-09-16: `session-history.params.priority` left the list when U3b
	 * (R-7 P5) made it the conversation's band intent, read by the handler
	 * and honoured by the ranker's sweep. The number may only go DOWN without
	 * a ruling: every entry is a declared name no run consults.
	 */
	it("stands at two entries, and each is the one it says", () => {
		expect(UNREAD_ALLOW_LIST.length).toBeLessThanOrEqual(2)
		expect(
			UNREAD_ALLOW_LIST.map((a) => allowKey(a.definition, a.name)).sort()
		).toEqual(
			[
				"core:oracle/embed-text@1 connection",
				"core:task/build-keeper-context@1 afterWrite"
			].sort()
		)
		const kinds = new Map(report.unread.map((f) => [f.key, f.kind]))
		// The read that closed the third entry: not a finding at all now.
		expect(kinds.has("core:query/session-history@1 params.priority")).toBe(
			false
		)
		expect(kinds.get("core:oracle/embed-text@1 connection")).toBe("slot")
		expect(kinds.get("core:task/build-keeper-context@1 afterWrite")).toBe(
			"port"
		)
	})

	/**
	 * Each allowance says what KIND of name it forgives, and the walk agrees.
	 * `paramsSlotWiring.test.ts` filters on that field to build its own ledger,
	 * so an entry claiming `slot` for a parameter would derive a ledger line
	 * for a slot no spec names — a wrong allowance dressed as a right one.
	 */
	it("every allowance's kind is the kind the walk found", () => {
		const kinds = new Map(report.unread.map((f) => [f.key, f.kind]))
		for (const a of UNREAD_ALLOW_LIST)
			expect(
				kinds.get(allowKey(a.definition, a.name)),
				`${allowKey(a.definition, a.name)} is allowed as a ${a.kind}`
			).toBe(a.kind)
	})
})

describe("the §5f decisions are what the code says", () => {
	/**
	 * plans/29 §5f named nine declared-but-unread items. Each was wired,
	 * culled or allow-listed in U2, and the decision is pinned here so a later
	 * edit to a definition has to come through this file.
	 */
	const declared = (id: string) => {
		const d = getDefinition(id)!
		return {
			ports: Object.keys(d.ports?.in ?? {}),
			slots: Object.keys(d.slots ?? {}),
			params: Object.keys((d.slots as any)?.params?.schema ?? {})
		}
	}

	it("session-history: `budget` culled, `priority` allow-listed and still declared", () => {
		const d = declared("core:query/session-history@1")
		expect(d.ports).not.toContain("budget")
		expect(d.params).toContain("priority")
	})

	it("the lore scans: the `text` in-port is culled on all four", () => {
		for (const id of [
			"core:query/lorebook-triggers@1",
			"core:query/world-lore@1",
			"core:query/character-lore@1",
			"core:query/history-entries@1"
		])
			expect(declared(id).ports, id).not.toContain("text")
	})

	/**
	 * W1 (2026-09-17): the per-speaker visibility subject, on the two reads
	 * that produce the character-lore band and on neither of the others.
	 *
	 * Stated as its own decision rather than folded into the `text` cull
	 * above, because it is the opposite move: `text` went because nothing read
	 * it, and this arrived because the host now does. World lore and history
	 * are not gated by a lorebook binding, so a speaker on them would be
	 * exactly the dead control R-12 exists to refuse.
	 */
	it("the lore scans: `speaker` is on the two gated reads and no others", () => {
		for (const id of [
			"core:query/lorebook-triggers@1",
			"core:query/character-lore@1"
		])
			expect(declared(id).ports.sort(), id).toEqual(["scope", "speaker"])
		for (const id of [
			"core:query/world-lore@1",
			"core:query/history-entries@1",
			"core:query/lorebook-entries@1"
		])
			expect(declared(id).ports, id).toEqual(["scope"])
	})

	it("assemble@2: `truncation` culled — assemble drops nothing, the ranker does", () => {
		expect(declared("core:task/assemble@2").params).not.toContain(
			"truncation"
		)
	})

	it("batch-messages: `minBatchMessages` is read", () => {
		expect(
			readsOf(coreBindings()["core:task/batch-messages@1"])?.params
		).toContain("minBatchMessages")
	})

	it("the three generating oracles declare no `prompts` slot", () => {
		for (const id of [
			"core:oracle/generate-text@1",
			"core:oracle/generate-with-tools@1",
			"core:oracle/generate-json@1"
		])
			expect(declared(id).slots, id).not.toContain("prompts")
		// While the node that OWNS the pool still declares and reads it.
		expect(declared("core:task/assemble@2").slots).toContain("prompts")
		expect(
			readsOf(coreBindings()["core:task/assemble@2"])?.ports
		).toContain("prompts")
	})

	it("extract-cast: the `messages` in-port is culled; the extractor reads `content`", () => {
		expect(declared("core:oracle/extract-cast@1").ports).toEqual([
			"content",
			"request"
		])
	})

	it("rank-semantic: the two window sizes belong to query-windows alone", () => {
		expect(declared("core:task/rank-semantic@1").params).not.toContain(
			"currentWindow"
		)
		expect(declared("core:task/rank-semantic@1").params).not.toContain(
			"recentWindow"
		)
		expect(declared("core:task/query-windows@1").params).toEqual([
			"currentWindow",
			"recentWindow"
		])
	})
})

describe("the check fails when a declaration goes wrong", () => {
	/**
	 * **Fail-first, against the real table.** The real `session-history`
	 * handler is re-declared on a fresh function object — `reads` refuses a
	 * DIFFERENT redeclaration on the same object, which is itself the point —
	 * once reading less than the definition declares, once reading more.
	 */
	it("names a declared port and parameter nobody reads", () => {
		const real = coreBindings()
		const bent = {
			...real,
			"core:query/session-history@1": reads<typeof C.sessionHistory>(
				async () => ok({ main: [] }),
				{ ports: [], params: ["limit"] }
			)
		}
		const r = checkDeclaredReads(bent)
		const keys = openFindings(r).map((f) => f.key)
		expect(keys).toContain("core:query/session-history@1 scope")
		expect(keys).toContain("core:query/session-history@1 params.channel")
		// `priority` is an ordinary read since U3b: the bent table drops it,
		// and the walk says so like any other.
		expect(keys).toContain("core:query/session-history@1 params.priority")
		// And the sentence a person reads names the node and the field.
		expect(
			openFindings(r).find(
				(f) => f.key === "core:query/session-history@1 params.channel"
			)?.sentence
		).toMatch(
			/declares a parameter 'channel' that its handler does not read/
		)
	})

	it("names a read the definition does not supply", () => {
		const real = coreBindings()
		// `budget` WAS this node's in-port; the typed helper refuses it at
		// compile time now, so the untyped SDK primitive is the only way to
		// forge the declaration — which is what a stale plugin would ship.
		const forged = Object.assign(async () => ok({ main: [] }), {
			requires: { ports: ["scope", "budget"], params: ["limit"] }
		})
		const r = checkDeclaredReads({
			...real,
			"core:query/session-history@1": forged
		})
		expect(r.undeclared).toHaveLength(1)
		expect(r.undeclared[0]).toMatch(/reads 'budget' off its input/)
	})

	it("names a handler that declares nothing", () => {
		const real = coreBindings()
		const r = checkDeclaredReads({
			...real,
			"core:query/session-history@1": async () => ok({ main: [] })
		})
		expect(r.undeclaredHandlers).toHaveLength(1)
		expect(r.undeclaredHandlers[0]).toMatch(/core:query\/session-history@1/)
	})
})
