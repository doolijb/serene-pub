/**
 * `/contracts` generation (04 §2, §4b).
 *
 * Every SP release publishes frozen, generated type declarations. This is the generator:
 * descriptors in, a TypeScript module out. In core the input is `type_registry` rows; here
 * it is the in-memory registry, which is the same data.
 *
 * **The binding name is derived, never chosen.** It is the camelCase of the id's name
 * segment, and nothing else. That rule exists because the alternative was discovered by
 * writing it out: eleven of thirty-five hand-written names did not match their ids —
 * `generateText` for `text-gen`, `speak` for `tts`, `savePluginData` for `plugin-data`.
 * A generator with a hand-maintained alias table is a generator that drifts, and the drift
 * lands on plugin authors who imported a name that no longer exists.
 *
 * So the naming convention is enforced here rather than documented:
 *
 * - **Shapes are nouns** — what a thing *is*. They double as connection kinds (F17), so
 *   they read as categories: `text-gen`, `embeddings`, `row-ids`, `allocated-context`.
 * - **Task / Provider / Consumer types are verb phrases** — they *do* something:
 *   `generate-text`, `embed-text`, `render-image`, `create-message`, `assemble`.
 * - **Query types name their source** — a Query is chosen by what it returns, which is
 *   what a user tuning "how much should lore matter" is looking at: `chat-history`,
 *   `persona-card`, `lorebook-triggers`.
 *
 * Renaming `core:provider/text-gen@1` to `core:provider/generate-text@1` also removed a
 * collision worth naming: it was the same string as `core:shape/text-gen@1`, the operation
 * and the category spelled identically in different namespaces.
 */

import type { Descriptor } from "@serene-pub/sdk"

/** `'core:query/chat-history@2'` → `{ ns: 'core', kind: 'query', name: 'chat-history', version: 2 }` */
export function parseTypeId(id: string): {
	ns: string
	kind?: string
	name: string
	version: number
} {
	const at = /@(\d+)$/.exec(id)
	const version = at ? Number(at[1]) : 1
	const body = id.replace(/@\d+$/, "")
	const [ns, rest = ""] = body.split(":")
	const slash = rest.indexOf("/")
	return slash === -1
		? { ns: ns!, name: rest, version }
		: {
				ns: ns!,
				kind: rest.slice(0, slash),
				name: rest.slice(slash + 1),
				version
			}
}

export const camel = (s: string) =>
	s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())

/** The one and only rule. */
export const bindingNameFor = (id: string) => camel(parseTypeId(id).name)

export interface DerivationProblem {
	id: string
	given: string
	expected: string
}

/**
 * Check a hand-written contracts module against the rule. Run in CI: the moment a name
 * stops being derivable, generation would need an alias table, and that is the failure.
 */
export function checkDerivable(
	entries: Array<{ name: string; id: string }>
): DerivationProblem[] {
	return entries
		.map((e) => ({
			id: e.id,
			given: e.name,
			expected: bindingNameFor(e.id)
		}))
		.filter((p) => p.given !== p.expected)
}

export interface NameCollision {
	name: string
	ids: string[]
}

/**
 * Two ids that derive to one name.
 *
 * The derivation is namespace-blind on purpose — `core:task/assemble@2` reads as
 * `assemble`, not `coreAssemble` — and the cost is that
 * `core:task/rank-semantic@1` and `chariot.recall:rank-semantic@1` both want to
 * be `rankSemantic`. Generation would emit the same export twice and the second
 * would win silently.
 *
 * Found the way these things are found: adding a core ranker whose name segment a
 * plugin example already used. Reported as its own problem rather than folded
 * into `checkDerivable`, because the fix is different — a collision is resolved
 * by renaming a *type*, not by renaming a binding.
 */
export function checkUnique(entries: Array<{ id: string }>): NameCollision[] {
	const byName = new Map<string, string[]>()
	for (const e of entries) {
		const name = bindingNameFor(e.id)
		byName.set(name, [...(byName.get(name) ?? []), e.id])
	}
	return [...byName.entries()]
		.filter(([, ids]) => ids.length > 1)
		.map(([name, ids]) => ({ name, ids }))
}

// ── Emission ────────────────────────────────────────────────────────────────

export interface GenerateOptions {
	/** Written into the banner so a stale file is obvious in a diff. */
	release?: string
	/** Import specifier for the SDK itself. */
	sdk?: string
}

const banner = (o: GenerateOptions, count: number) =>
	`/**
 * GENERATED — do not edit.
 *
 * ${count} type declarations${o.release ? `, Serene Pub ${o.release}` : ""}.
 * Frozen at release: a pin resolved against this file resolves the same way forever,
 * which is what makes a spec's pins statically checkable (01 §3, 04 §2).
 *
 * Names are derived from type ids, never chosen — see src/codegen.ts for the rule.
 */`

const lit = (v: unknown): string => JSON.stringify(v)

/**
 * Emit a contracts module. Descriptors are emitted as data plus a `pin()` call, so the
 * generated file is readable and diffable rather than a blob — a plugin author reading
 * `/contracts` to find out what ports a node has should be able to.
 */
export function generateContracts(
	types: Descriptor[],
	opts: GenerateOptions = {}
): string {
	const sdk = opts.sdk ?? "@serene-pub/sdk"
	const byKind: Record<string, Descriptor[]> = {}
	for (const d of types) (byKind[d.kind] ??= []).push(d)

	const describeFor: Record<string, string> = {
		input: "describeInput",
		query: "describeQueryType",
		task: "describeTaskType",
		provider: "describeProvider",
		consumer: "describeConsumerTarget"
	}

	const out: string[] = [
		banner(opts, types.length),
		"",
		`import { pin, ${[...new Set(Object.values(describeFor))].sort().join(", ")} } from '${sdk}'`,
		""
	]

	for (const kind of ["input", "query", "task", "provider", "consumer"]) {
		const group = byKind[kind]
		if (!group?.length) continue
		out.push(
			`// ── ${kind}s ${"─".repeat(Math.max(1, 60 - kind.length))}`,
			""
		)
		for (const d of group
			.slice()
			.sort((a, b) => a.id.localeCompare(b.id))) {
			const name = bindingNameFor(d.id)
			const { version } = parseTypeId(d.id)
			const body = Object.entries(d)
				.filter(([k]) => k !== "kind")
				.map(([k, v]) => `\t\t${k}: ${lit(v)},`)
				.join("\n")
			if (d.i18n?.description)
				out.push(
					`/** ${typeof d.i18n.description === "string" ? d.i18n.description : d.i18n.description.en} */`
				)
			out.push(
				`export const ${name} = pin(`,
				`\t${describeFor[kind]}({`,
				body,
				`\t}),`,
				`)`,
				""
			)
			out.push(`// pinned as ${name}.v${version}(…)`, "")
		}
	}

	return out.join("\n")
}

/**
 * The manifest's view of a type: what an admin's audit screen and the install-time
 * permission check read, without loading any code (10 §10.2).
 */
export interface TypeSummary {
	id: string
	binding: string
	kind: string
	version: number
	ports: { in: string[]; out: string[] }
	slots: string[]
	effects?: string
	causesEvent?: string
	public?: boolean
	declaresRandomness?: boolean
	timeoutMs?: number
}

export const summarizeType = (d: Descriptor): TypeSummary => ({
	id: d.id,
	binding: bindingNameFor(d.id),
	kind: d.kind,
	version: parseTypeId(d.id).version,
	ports: {
		in: Object.keys(d.ports.in ?? {}),
		out: Object.keys(d.ports.out ?? {})
	},
	slots: Object.keys(d.slots ?? {}),
	effects: d.effects,
	causesEvent: d.causesEvent,
	public: d.public,
	declaresRandomness: d.declaresRandomness,
	timeoutMs: d.timeoutMs
})
