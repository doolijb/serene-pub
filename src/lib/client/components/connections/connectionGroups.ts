/**
 * How the index divides the list, and which capabilities a row is the default
 * for.
 *
 * ## The division is the decision
 *
 * The list is not one flat run of connections sorted by type, because the
 * question a person is actually holding when they look at it is not "which
 * adapter is this" — it is **where do my words go, and does this cost money**.
 * Those are the same split: a runtime this pub runs is private and free and
 * bounded by the machine; a service is fast and costs per message and sees
 * everything you type.
 *
 * So the list groups by that, in two groups, with the trade named once on each
 * header instead of nowhere. A beginner reads the headers and has the whole
 * decision; an expert scans to the group they meant and ignores the other.
 *
 * ⚠ **Two groups, never more.** A group per modality was the obvious
 * alternative and it is wrong twice over: one KoboldCPP row does chat and
 * images from one process, so it would have to appear twice or pick a home;
 * and a person adding an embedding model is not thinking "embeddings", they are
 * thinking "on my machine". Modality is what the capability tiles answer.
 *
 * ⚠ Pure. No Svelte, no socket, no icons — the view maps these to components.
 */
import {
	connectionGroupOf,
	type ConnectionGroupId
} from "$lib/shared/connections/connectionGroup"

export interface ConnectionGroup {
	id: ConnectionGroupId
	label: string
	/**
	 * The trade, in three words, on the header's right.
	 *
	 * ⚠ It says what this KIND of connection costs, never what any particular
	 * one does — "billed per message" on the Services header is true of the
	 * group; whether a given model is free is the model table's business.
	 */
	trade: string
	/** A `@lucide/svelte` export name, resolved by the component. */
	icon: string
}

export const CONNECTION_GROUPS: readonly ConnectionGroup[] = [
	{
		id: "local",
		label: "On this machine",
		trade: "private · free",
		icon: "MonitorSmartphone"
	},
	{
		id: "service",
		label: "Services",
		trade: "billed per message",
		icon: "Cloud"
	}
]

/**
 * Which group a connection TYPE falls in — `connectionGroupOf`, defined in
 * `$lib/shared/connections/connectionGroup` since 2026-09-29, where the
 * server's semantic search reads the same rule. It is the type's own
 * `category`, the one the New connection picker files it by: a KoboldCPP,
 * LM Studio or llama.cpp you run yourself is **On this machine**, and an
 * Ollama on the box downstairs still is — the type is the claim, not the
 * hostname.
 */
export { connectionGroupOf }

export interface GroupedConnection {
	id: number
	type?: string | null
}

export interface GroupedRows<C> {
	group: ConnectionGroup
	rows: C[]
}

/**
 * The list, split in two and in the groups' own order.
 *
 * ⚠ An EMPTY group is dropped, never rendered as a header over nothing. A
 * person with only cloud connections should not be told twice that there is a
 * category they have not used.
 */
export function groupConnections<C extends GroupedConnection>(
	rows: readonly C[]
): GroupedRows<C>[] {
	const out: GroupedRows<C>[] = []
	for (const group of CONNECTION_GROUPS) {
		const inGroup = rows.filter((r) => connectionGroupOf(r.type) === group.id)
		if (inGroup.length) out.push({ group, rows: inGroup })
	}
	return out
}

// ── The gold marks on a row ─────────────────────────────────────────────────

export interface DefaultRef {
	connectionId?: number | null
	connectionModelId?: number | null
}

/**
 * The capability labels this CONNECTION is the instance default for.
 *
 * Why on the row at all: until now the only place the chat default appeared was
 * inside the readiness card, so the list — the thing a person actually scans —
 * could not answer "which of these four is the one my sessions use". One gold
 * mark beside the name answers it without opening anything.
 *
 * ⚠ It matches on the CONNECTION half of the pair, not the model half, because
 * the row stands for the connection. The model view is where a pair is shown
 * whole. A default naming only an endpoint is incomplete and resolves as
 * unconfigured elsewhere (§10 *(endpoint, model) pair*) — it still earns the
 * mark here, because the person's question is "is this one in use".
 *
 * ⚠ Capped at ONE, plus a count. An Anthropic connection is the registered
 * default for chat, vision and document reading the moment it is created, and
 * three chips beside a 15px name in a 400px column pushed the name off the row
 * entirely — the shipped index rendered a row whose title was invisible and
 * whose marks were not. The name is what the row is FOR; it always wins.
 */
export function defaultsForConnection(
	connectionId: number,
	defaults: Record<string, DefaultRef | undefined> | undefined,
	labelOf: (capability: string) => string,
	limit = 1
): string[] {
	if (!defaults) return []
	const labels: string[] = []
	for (const [capability, ref] of Object.entries(defaults)) {
		if (!ref || ref.connectionId !== connectionId) continue
		labels.push(labelOf(capability))
	}
	labels.sort((a, b) => a.localeCompare(b))
	if (labels.length <= limit) return labels
	return [...labels.slice(0, limit), `+${labels.length - limit}`]
}
