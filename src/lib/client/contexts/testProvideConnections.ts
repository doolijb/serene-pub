/**
 * A stand-in connections context for render tests of views that read it
 * (`useConnections()`): the list they are handed, nothing in flight, and
 * every action a no-op. Spread the entry into a render's `context` map:
 *
 * ```ts
 * render(ModelFinderView, { props, context: new Map([connectionsTestContext()]) })
 * ```
 *
 * A dom test that drives the real events creates the real context instead
 * (`createConnections` inside `$effect.root`).
 */
import { CONNECTIONS_CONTEXT, type ConnectionsCtx } from "./connections.svelte"

const noop = () => {}
const release = () => noop

export function fakeConnections(
	list: Sockets.Connections.List.Row[] = [],
	over: Partial<ConnectionsCtx> = {}
): ConnectionsCtx {
	const fake = {
		hold: release,
		list,
		listed: list.filter((c) => c.id != null),
		loading: false,
		syncingIds: new Set<number>(),
		syncingAll: false,
		chatPair: {},
		embeddingDialog: { open: false },
		entityDialog: { open: false },
		requestList: noop,
		requestSync: noop,
		syncMayForce: () => false,
		expectCreate: noop,
		enableManagerHere: () => ({ connectionId: null, plan: {} }),
		chooseJobModel: noop,
		jobsOf: () => [],
		currentDefaultModel: () => null,
		defaultsByModel: () => ({}),
		useModelOn: noop,
		servesChat: () => false,
		useLabelOf: () => "Use",
		onCreated: release,
		onCreateFailed: release,
		onDefaultSet: release,
		onSynced: release,
		onAnnounce: release,
		...over
	}
	return fake as unknown as ConnectionsCtx
}

/** `[CONNECTIONS_CONTEXT, fake]`, ready for a render's context map. */
export function connectionsTestContext(
	list: Sockets.Connections.List.Row[] = [],
	over: Partial<ConnectionsCtx> = {}
): [string, ConnectionsCtx] {
	return [CONNECTIONS_CONTEXT, fakeConnections(list, over)]
}
