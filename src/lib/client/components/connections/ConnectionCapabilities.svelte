<script lang="ts">
	/**
	 * What a connection can do, and who decided that — the panel
	 * `connections:update`'s server-ownership comment has been waiting for.
	 *
	 * ## One prop, and it is an id
	 *
	 * This component never reads `connection.capabilities` and never writes into
	 * `connection`. It is handed an id and fetches, holds and refreshes its own
	 * copy of the column over its own two events, exactly as the stop-guard block
	 * beside it does with `connections:scripts`. That single choice disposes of
	 * three hazards by construction:
	 *
	 *   - the editor's unsaved-changes baseline. `originalConnection` is only ever
	 *     replaced by a server payload, so writing a live column into `connection`
	 *     would make `unsavedChanges` permanently true — disabling the connection
	 *     picker and firing the discard guard on every close.
	 *   - server ownership. `persistCapabilities` is the column's only writer, and
	 *     a toggle riding the update payload would be stripped anyway.
	 *   - testing while open. A test rewrites the column underneath us; re-reading
	 *     is the whole answer, and there is no local copy to reconcile.
	 *
	 * ## The three states are the widget
	 *
	 * Auto first, because auto is the resting position: nobody has stated an
	 * intent, so the preset and the last test decide. On and Off are stated
	 * intent, and Off is DURABLE — it outranks every probe that will ever run.
	 * A checkbox plus a "reset to auto" link was rejected for exactly that
	 * reason: it demotes the default state to a secondary affordance and, worse,
	 * makes the obvious two-state control mean "blind this row forever".
	 *
	 * Real radios in a real fieldset: arrow-key navigation, grouping and
	 * screen-reader semantics come free, and the same markup works unstyled on
	 * Document View's edit page.
	 *
	 * ## Nothing here predicts the result
	 *
	 * The radio is optimistic — it moves at once, because it is the person's own
	 * intent and they should not watch a round trip. Everything else on the row —
	 * chip, provenance, the contested line — is replaced WHOLESALE from the
	 * response. `closure()` and `resolveCapabilities()` are importable from here
	 * and are never called: a second implementation of the four layers is the
	 * exact divergence this design exists to prevent.
	 */
	import { onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { joinWithAnd } from "$lib/shared/utils/joinWithAnd"
	import {
		buildCapabilityRows,
		OVERRIDE_STATES,
		type CapabilityRow,
		type OverrideState
	} from "$lib/shared/connectionAdapters/capabilityRows"

	interface Props {
		/** The SAVED connection's id — the only thing this panel is told. */
		connectionId: number
	}
	let { connectionId }: Props = $props()

	const socket = useTypedSocket()

	let stored = $state<Sockets.Connections.Capabilities.Response | null>(null)
	let loading = $state(true)
	/**
	 * Radio positions the server has not answered for yet.
	 *
	 * Reassigned rather than mutated (a `$state` object's keys are the reactive
	 * surface here), and cleared whole on every response — what came back IS the
	 * stored intent, so keeping a local half would only let the two drift.
	 */
	let pending = $state<Record<string, OverrideState>>({})
	let lastToggled: string | null = null
	let announcement = $state("")

	let rows = $derived(
		buildCapabilityRows({
			type: stored?.type,
			preset: stored?.preset,
			capabilities: stored?.capabilities
		})
	)

	const positionOf = (row: CapabilityRow): OverrideState =>
		pending[row.id] ?? row.state

	function choose(row: CapabilityRow, state: OverrideState) {
		const option = OVERRIDE_STATES.find((s) => s.value === state)
		if (!option) return
		pending = { ...pending, [row.id]: state }
		lastToggled = row.id
		// `wire` carries the three-state rule: auto sends null, which the handler
		// reads as DELETE the key rather than as a `false`.
		socket.emit("connections:setCapability", {
			id: connectionId,
			capability: row.id,
			value: option.wire
		})
	}

	function announce(message: string) {
		announcement = message
		setTimeout(() => (announcement = ""), 1000)
	}

	const applyCapabilities = (
		res: Sockets.Connections.Capabilities.Response
	) => {
		// emitToUser reaches every open tab for this user, not just the one that
		// asked — the same guard every other handler in the sidebar carries.
		if (res.connectionId !== connectionId) return
		loading = false
		if (res.error) return
		stored = res
		pending = {}
		// Say it out loud when the answer disagrees with what was just asked for.
		// An explicit off does not survive the SDK's closure, so KoboldCPP's tool
		// calling comes back emulated through its native grammar — silently
		// snapping the radio back would look like the click was lost.
		const toggled = lastToggled
		lastToggled = null
		if (!toggled) return
		const row = [...rows.transforms, ...rows.features].find(
			(r) => r.id === toggled
		)
		if (row?.contested && row.derived)
			announce(`${row.label}: ${row.derived}`)
	}

	const handleCapabilitiesError = () => {
		// The two :error events carry `Sockets.ErrorResponse` — an error string
		// and nothing else — so this cannot tell whose failure it was. It only
		// stops the spinner and drops the optimistic positions, so the control
		// falls back to the last answer the server actually gave. Layout's onAny
		// catch-all owns the toast, deliberately: neither event is in
		// HANDLED_ERROR_EVENTS.
		loading = false
		pending = {}
	}

	const handleTest = (msg: Sockets.Connections.Test.Response) => {
		if (msg.connectionId !== connectionId || !msg.ok) return
		// RE-READ rather than apply `msg.capabilities`. A test's response carries
		// the resolved set but neither `probe.found` nor `probe.at`, so applying
		// it would print "nothing has tested this connection yet" one second
		// after somebody tested it.
		socket.emit("connections:capabilities", { id: connectionId })
	}

	onMount(() => {
		// Named references, off'd by name below. A bare
		// socket.off("connections:test") removes the FIRST-registered listener —
		// usually one of the five connection forms' own — which has caused two
		// real bugs in this codebase already.
		socket.on("connections:capabilities", applyCapabilities)
		socket.on("connections:setCapability", applyCapabilities)
		socket.on("connections:capabilities:error", handleCapabilitiesError)
		socket.on("connections:setCapability:error", handleCapabilitiesError)
		socket.on("connections:test", handleTest)
		// Mount is the right moment because the sidebar keys this whole block on
		// connection.id, so a different selection is a different instance and
		// there is no stale-id window to guard.
		socket.emit("connections:capabilities", { id: connectionId })
	})

	onDestroy(() => {
		socket.off("connections:capabilities", applyCapabilities)
		socket.off("connections:setCapability", applyCapabilities)
		socket.off("connections:capabilities:error", handleCapabilitiesError)
		socket.off("connections:setCapability:error", handleCapabilitiesError)
		socket.off("connections:test", handleTest)
	})
</script>

{#snippet capabilityRow(row: CapabilityRow)}
	<fieldset class="border-surface-200-700 rounded-lg border px-2 pb-1">
		<legend
			class="px-1 text-sm {row.basic ? 'font-semibold' : 'font-medium'}"
		>
			{row.label}
		</legend>
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
			<span class="text-xs {row.on ? '' : 'opacity-60'}">
				<span aria-hidden="true">
					{row.tier === "native"
						? "●"
						: row.tier === "emulated"
							? "◐"
							: "○"}
				</span>
				{row.stateLabel}
			</span>
			{#if row.assumed}
				<span
					class="text-muted border-b border-dotted text-[10px]"
					title="Nothing has tested this connection, so this is the connection type's own guess."
				>
					Assumed
				</span>
			{/if}
			<div class="ml-auto flex items-center gap-2">
				{#each OVERRIDE_STATES as option (option.value)}
					<label
						class="flex cursor-pointer items-center gap-1 text-xs"
						title={option.hint}
					>
						<input
							type="radio"
							name={`cap-${connectionId}-${row.id}`}
							value={option.value}
							checked={positionOf(row) === option.value}
							onchange={() => choose(row, option.value)}
						/>
						{option.label}
					</label>
				{/each}
			</div>
		</div>
		{#if row.tagline}
			<p class="text-muted text-xs">{row.tagline}</p>
		{/if}
		<p class="text-muted text-xs">{row.provenance}</p>
		{#if row.derived}
			<p
				class="text-warning-700 dark:text-warning-400 text-xs {row.contested
					? 'font-medium'
					: ''}"
			>
				{row.derived}
			</p>
		{/if}
	</fieldset>
{/snippet}

<div class="mt-4 flex flex-col gap-1">
	<span class="flex items-center gap-2 font-semibold">
		<Icons.ToggleRight size={14} aria-hidden="true" />
		What this connection can do
	</span>
	<p class="text-muted text-xs">
		Auto follows this service's preset and the last successful test. Switch
		one by hand only when you know better than the backend does — a hand-set
		value outranks every test that comes after it.
	</p>
	<p class="text-muted text-xs">{rows.testedText}</p>
	<div aria-live="polite" aria-atomic="true" class="sr-only">
		{announcement}
	</div>
	{#if loading}
		<p class="text-muted text-xs">Loading…</p>
	{:else if !rows.declared}
		<p class="text-muted text-xs italic">
			Nothing is declared for this connection type, so there is nothing to
			switch.
		</p>
	{:else}
		<!-- Every transform, always: at most six rows, and one of them is the
		     image generation switch this panel was built for. Features hide
		     behind the disclosure instead, which names what is on so nothing
		     surprising is only reachable by opening it. -->
		{#each rows.transforms as row (row.id)}
			{@render capabilityRow(row)}
		{/each}
		{#if rows.features.length}
			<details class="mt-1">
				<summary class="cursor-pointer text-xs font-semibold">
					Advanced — {rows.featuresOnLabels.length
						? `${joinWithAnd(rows.featuresOnLabels)} on`
						: "nothing on"}
				</summary>
				<div class="mt-1 flex flex-col gap-1">
					{#each rows.features as row (row.id)}
						{@render capabilityRow(row)}
					{/each}
				</div>
			</details>
		{/if}
	{/if}
</div>
