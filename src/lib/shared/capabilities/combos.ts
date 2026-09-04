/**
 * The list of capabilities an admin can register a default for.
 *
 * Not a fixed list, and not one derived from a single source. It is the UNION
 * of what this build can SERVE (the adapter manifest) and what core nodes
 * DEMAND (the connection slots in `pipeline_type_registry`), because today's
 * data proves neither half is sufficient on its own:
 *
 *   - manifest only  → drops `text->audio` and `text->embedding`, which
 *     `core:provider/speak@1` and `core:provider/embed-text@1` require and no
 *     adapter declares.
 *   - registry only  → drops `text+image->text` and `text+document->text`,
 *     which are servable today and demanded by nothing yet.
 *
 * A new capability therefore appears on the admin screen without anybody
 * editing a list here — which is the whole point, since the alternative is a
 * hardcoded array that silently omits a plugin's transform.
 *
 * ⚠ Shared, not server-only, so the browser can render the same list from the
 * same rules. Nothing on this path may import an adapter MODULE — the manifest
 * is metadata, the adapters are lazily imported, and one of them cannot load on
 * Android at all. `importBoundary.test.ts` polices this.
 *
 * Both functions here are PURE. The registry read that feeds `aggregateCombos`
 * belongs to the one socket handler that answers `connectionDefaults:list`; a
 * `db` argument in this file would make the browser half unreachable and put a
 * Drizzle import on the shared path for no gain.
 */

import { IO_KINDS, isTransformId, type CapabilityId } from "@serene-pub/sdk"
import { ADAPTER_MANIFEST } from "$lib/shared/connectionAdapters/manifest"
import { outputKindOf } from "$lib/shared/capabilities/samplingShape"

/**
 * One capability, with the evidence for why it is on the list.
 *
 * `demanded` and `servable` are kept apart rather than collapsed into a single
 * "show this" boolean, because they answer different questions and the screen
 * says different things about them: a demanded-but-unservable combo needs a
 * connection the instance may not have yet, and a servable-but-undemanded one
 * is simply available.
 *
 * ⚠ `servable` is WORDING ONLY. Never gate on it. `openai-embeddings` and
 * `local-onnx` are live connection types with NO manifest entry, and
 * `storedCapabilities` returns their cached capabilities un-intersected — so
 * those connections genuinely carry `text->embedding` while
 * `servableTransforms()` says false. Gate on it and the embeddings default
 * becomes unsettable on exactly the installs that have one. Check the INSTANCE
 * first and the BUILD second.
 */
export interface ComboRow {
	/** The canonical transform id, e.g. `text+image->text`. The storage key. */
	id: string
	/** Some connection slot in the registry REQUIRES it. */
	demanded: boolean
	/** Some manifest entry can express it. See the warning above. */
	servable: boolean
	/** Which node types require it — what the empty-state warning names. */
	requiredBy: Array<{ typeId: string; version: number; slot: string }>
	/**
	 * Which node types merely prefer it.
	 *
	 * Filed SEPARATELY from `requiredBy` rather than summed into it. There are
	 * zero `optional:` sites today, so the distinction costs nothing now and
	 * settles the question before there is one: a capability nothing REQUIRES
	 * is not missing, and warning that it is unset would put a permanent
	 * complaint on a screen about something no run will ever need.
	 */
	optionalFor: Array<{ typeId: string; version: number; slot: string }>
}

/**
 * One `pipeline_type_registry` row, reduced to what the aggregation reads.
 *
 * Typed structurally rather than as the Drizzle select type so this file stays
 * importable from the browser — and so a test can hand it three literals
 * instead of standing up a database to assert a set union.
 */
export interface RegistryTypeRow {
	typeId: string
	version: number
	/** `Record<string, SlotDecl>`, as stored. Loose because the JSON column is. */
	slots?: Record<string, unknown> | null
}

/**
 * Every transform any adapter in this build can express.
 *
 * The KEY SPACE of `supports`, not its values: an `{unproven: true}` entry is
 * still a capability this build has a route for, and whether the backend on the
 * other end has an image model loaded is a question about an INSTANCE, which
 * this cannot and must not answer.
 *
 * Features (`tools`, `json_schema`, …) are filtered out. Only transforms are
 * ever registered as a default — "the default connection for text→image" is a
 * sensible thing to want and "the default connection for JSON schema" is not,
 * because a feature qualifies a request rather than being something a node goes
 * shopping for.
 */
export function servableTransforms(): string[] {
	const out = new Set<string>()
	for (const entry of Object.values(ADAPTER_MANIFEST))
		for (const id of Object.keys(entry.capabilities?.supports ?? {}))
			if (isTransformId(id)) out.add(id)
	return [...out].sort(compareCombos)
}

/**
 * The union: what this build can serve, plus what its node types ask for.
 *
 * Pure, and takes the rows rather than a `db`, so the whole rule is testable
 * against three literals — which matters because the failure this guards is
 * SILENT. A combo missing from the aggregate is not an error anywhere: the
 * admin screen simply never offers it, no default is ever registered for it,
 * and the first sign is a run refusing a capability with nothing on any screen
 * to set.
 *
 * A slot contributes through `requires` and `optional` alike — both name
 * something core can use, and a capability nobody can register a default for is
 * a capability the instance does not have (piece 3). Only `requires` sets
 * `demanded`, which is what the empty-state warning keys on: warning about an
 * unset `optional` would put a permanent complaint on the screen about
 * something no run will ever need.
 *
 * Feature ids in either list are skipped for the reason `servableTransforms`
 * skips them — a slot may legitimately require `json_schema`, and that is not a
 * thing an admin points a connection at.
 */
export function aggregateCombos(rows: readonly RegistryTypeRow[]): ComboRow[] {
	const by = new Map<string, ComboRow>()
	const rowFor = (id: string): ComboRow => {
		let combo = by.get(id)
		if (!combo) {
			combo = {
				id,
				demanded: false,
				servable: false,
				requiredBy: [],
				optionalFor: []
			}
			by.set(id, combo)
		}
		return combo
	}

	for (const id of servableTransforms()) rowFor(id).servable = true

	for (const row of rows) {
		const slots = (row.slots ?? {}) as Record<string, unknown>
		if (!slots || typeof slots !== "object") continue
		for (const [slot, raw] of Object.entries(slots)) {
			if (!raw || typeof raw !== "object") continue
			const decl = raw as {
				requires?: readonly CapabilityId[]
				optional?: readonly CapabilityId[]
			}
			const site = {
				typeId: row.typeId,
				version: row.version,
				slot
			}
			for (const id of decl.requires ?? []) {
				if (!isTransformId(id)) continue
				const combo = rowFor(id)
				combo.demanded = true
				combo.requiredBy.push(site)
			}
			for (const id of decl.optional ?? []) {
				if (!isTransformId(id)) continue
				rowFor(id).optionalFor.push(site)
			}
		}
	}

	return [...by.values()].sort((a, b) => compareCombos(a.id, b.id))
}

/**
 * Output kind first, then the id.
 *
 * The admin screen groups by output kind, so the list arrives already grouped
 * and the page never has to re-sort what the server sent — one order, decided
 * once. Within a group, alphabetical: `text->image` before `text+image->image`
 * is arbitrary but stable, and stable is the property a list of checkboxes
 * needs.
 *
 * A transform whose output side names more than one kind sorts last (see
 * `outputKindOf`); there are none today and a guess would be a lie in the
 * heading.
 */
function compareCombos(a: string, b: string): number {
	const rank = (id: string) => {
		const kind = outputKindOf(id)
		return kind ? IO_KINDS.indexOf(kind) : IO_KINDS.length
	}
	return rank(a) - rank(b) || a.localeCompare(b)
}
