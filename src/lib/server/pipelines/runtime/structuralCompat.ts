/**
 * Structural compatibility — the runtime half of "handler input types come
 * from the contract" (ruling 2026-09-10).
 *
 * `InputOf` derives a handler's `input` from its contract, and a read of a name
 * the contract does not declare stops compiling. That closes the case core
 * cares about most, because core's handlers are compiled with core. It closes
 * nothing at all for the two cases the follow-up ruling names:
 *
 *  1. **A plugin binding another plugin's public handler.** Two separately
 *     packaged, separately compiled artefacts. Neither `tsc` run saw the other,
 *     so neither could have refused the pairing.
 *  2. **The admin-side pipeline orchestrator**, which composes nodes in the UI.
 *     There is no compile step at all — a person picks a type and a handler in
 *     a form.
 *
 * So the same rule is checkable here, from data: a handler says what it reads,
 * a contract says what it supplies, and this decides. The answer is a
 * **report**, not a boolean — "incompatible" with nothing named is the kind of
 * refusal people work around rather than fix.
 *
 * ## The rule, exactly
 *
 * A handler is compatible with a type when **everything it reads, that type
 * declares**. Nothing is said about the other direction: a contract may supply
 * a dozen things the handler ignores and still be compatible, which is what
 * makes one handler serve several types — the handler is written against the
 * *intersection* of what they supply (`SharedInput<[A, B]>` in
 * `bindingTypes.ts`), and every one of them is then a superset of what it
 * reads.
 *
 * ⚠ **Ports and slots are one category here, deliberately.** `resolveInput`
 * (sdk/src/executor.ts) builds one flat object out of the node's config, its
 * wired edges and its resolved slot refs, so a handler cannot tell a port from
 * a slot and neither does this. Splitting them would ask a caller to know which
 * of the two a name is — precisely the knowledge the flat input takes away.
 *
 * ## What supplies an answer
 *
 * Three sources, one shape: a pinned contract (`typeof C.vectorSearch`), a bare
 * descriptor, or a **`pipeline_definition_registry` row**. The row matters more than
 * it looks — F6 says core reads a plugin's declaration from its stored row and
 * never loads the plugin to ask, and a `transport: 'process'` type has no
 * in-process descriptor to load in the first place. A check that only worked on
 * descriptors would be a check that did not work on plugins.
 */

import { suppliesOf, type FieldType } from "@serene-pub/sdk"
import type { HandlerRequires } from "@serene-pub/sdk"

/** What a type puts on a handler's `input`, whatever it was read from. */
export interface Supplies {
	/** The type id, for the sentence a refusal is made of. */
	id: string
	/** In-port and slot names together — see the note in this file's header. */
	ports: string[]
	/** Names on `input.params`. */
	params: string[]
	/** Each parameter's declared field type, where one is declared. */
	paramTypes: Record<string, FieldType>
}

/** A `pipeline_definition_registry` row, as far as this file needs one. */
export interface RegistryRowLike {
	definitionId: string
	version?: number
	ports?: {
		in?: Record<string, unknown>
		out?: Record<string, unknown>
	} | null
	slots?: Record<
		string,
		{ schema?: Record<string, { type?: string }> }
	> | null
}

export interface StructuralOk {
	ok: true
}

export interface StructuralMismatch {
	ok: false
	/** What was being bound — the handler's name or its binding key. */
	handler: string
	/** What it was being bound to. */
	definitionId: string
	/** Names read off `input` that the type declares nowhere. */
	missingPorts: string[]
	/** Names read off `input.params` that the type's schema does not carry. */
	missingParams: string[]
	/** Declared, but not as the field type the handler requires. */
	typeMismatches: Array<{
		param: string
		required: FieldType
		declared: FieldType
	}>
	/** The whole finding as one sentence, ready to refuse a boot with. */
	message: string
}

export type StructuralVerdict = StructuralOk | StructuralMismatch

/**
 * Read what a type supplies, from a contract, a descriptor or a registry row.
 *
 * The registry-row branch is not a convenience shim. It is how the plugin path
 * has to work: `pluginNodeBindings` already reads rows and never touches a
 * descriptor, because for a `transport: 'process'` type there is no descriptor
 * in this process to touch.
 */
export function normaliseSupplies(supplies: unknown): Supplies {
	const row = supplies as RegistryRowLike | null | undefined
	if (row && typeof row === "object" && typeof row.definitionId === "string") {
		const ports = [
			...Object.keys(row.ports?.in ?? {}),
			...Object.keys(row.slots ?? {})
		]
		const params: string[] = []
		const paramTypes: Record<string, FieldType> = {}
		for (const slot of Object.values(row.slots ?? {}))
			for (const [name, field] of Object.entries(slot?.schema ?? {})) {
				params.push(name)
				if (field?.type) paramTypes[name] = field.type as FieldType
			}
		return {
			id: row.version ? `${row.definitionId}@${row.version}` : row.definitionId,
			ports: [...new Set(ports)],
			params,
			paramTypes
		}
	}
	// A contract or a bare descriptor. One implementation, in the SDK, because
	// both sides of a plugin-to-plugin binding need the same answer and a
	// second implementation on either side is a second answer.
	return suppliesOf(supplies)
}

/**
 * Is this handler's read set covered by this type's declaration?
 *
 * @param requires What the handler reads. Core's comes from the contracts it is
 *   typed against (`requiresOf`); a plugin's comes from its own declaration.
 * @param supplies The type it is being bound to — contract, descriptor or row.
 * @param handler A name for the refusal sentence. Without one a boot failure
 *   names a type and leaves the reader to find which of forty handlers it was.
 */
export function structuralCompat(
	requires: HandlerRequires,
	supplies: unknown,
	handler = "handler"
): StructuralVerdict {
	const s = normaliseSupplies(supplies)
	const portSet = new Set(s.ports)
	const paramSet = new Set(s.params)

	const missingPorts = [...new Set(requires.ports)].filter(
		(p) => !portSet.has(p)
	)
	const missingParams = [...new Set(requires.params)].filter(
		(p) => !paramSet.has(p)
	)
	const typeMismatches: StructuralMismatch["typeMismatches"] = []
	for (const [param, required] of Object.entries(requires.paramTypes ?? {})) {
		// A missing name is already reported once, as missing. Reporting it
		// again as a type mismatch against `undefined` would be the same
		// finding wearing two labels.
		if (!paramSet.has(param)) continue
		const declared = s.paramTypes[param]
		if (declared && declared !== required)
			typeMismatches.push({ param, required, declared })
	}

	if (!missingPorts.length && !missingParams.length && !typeMismatches.length)
		return { ok: true }

	return {
		ok: false,
		handler,
		definitionId: s.id,
		missingPorts,
		missingParams,
		typeMismatches,
		message: describe(
			handler,
			s,
			missingPorts,
			missingParams,
			typeMismatches
		)
	}
}

/**
 * The sentence.
 *
 * Written out rather than assembled from a template string at each call site,
 * because the two callers that matter are a boot refusal and a plugin install
 * refusal — the two moments where the reader is furthest from the code and
 * least able to guess what "incompatible" meant.
 */
function describe(
	handler: string,
	s: Supplies,
	missingPorts: string[],
	missingParams: string[],
	typeMismatches: StructuralMismatch["typeMismatches"]
): string {
	const parts: string[] = []
	if (missingPorts.length)
		parts.push(
			`reads ${list(missingPorts)} off its input, which ${s.id} declares ` +
				`neither as an in-port nor as a slot`
		)
	if (missingParams.length)
		parts.push(
			`reads ${list(missingParams)} off input.params, which ${s.id}'s ` +
				`parameters schema does not declare`
		)
	for (const m of typeMismatches)
		parts.push(
			`needs '${m.param}' to be a ${m.required}, and ${s.id} declares it ` +
				`as a ${m.declared}`
		)
	return (
		`${handler} is not structurally compatible with ${s.id}: it ` +
		parts.join("; ") +
		`. A handler may be bound to any type that supplies everything it ` +
		`reads — declare the missing name on the type, or read it from a type ` +
		`that has it.`
	)
}

const list = (names: string[]) =>
	names.map((n) => `'${n}'`).join(names.length > 2 ? ", " : " and ")

/**
 * What a handler typed against these contracts may read — the runtime twin of
 * `SharedInput<[A, B]>`.
 *
 * One contract gives that contract's whole surface; several give the
 * **intersection**, which is exactly the rule the type enforces at compile
 * time. That is what makes a core handler's `requires` *generated* rather than
 * written: it is derived from the same contracts the annotation names, so there
 * is no second list to keep in step with the first.
 *
 * ⚠ An empty list answers "reads nothing" rather than "reads everything". The
 * inverse is the failure mode of every intersection written as a fold, and it
 * is silent: a group that lost its members would pass every check.
 */
export function requiresOf(...contracts: unknown[]): HandlerRequires {
	if (!contracts.length) return { ports: [], params: [] }
	const [first, ...rest] = contracts.map(normaliseSupplies)
	let ports = new Set(first.ports)
	let params = new Set(first.params)
	for (const s of rest) {
		ports = new Set([...ports].filter((p) => s.ports.includes(p)))
		params = new Set([...params].filter((p) => s.params.includes(p)))
	}
	return { ports: [...ports], params: [...params] }
}
