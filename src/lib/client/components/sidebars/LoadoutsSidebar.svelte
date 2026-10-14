<script lang="ts">
	/**
	 * The Loadouts view (rail key `loadouts`, I12; DESIGN-image-generation
	 * §14): "what each kind of work runs on". Admin-only — members never see
	 * a loadout.
	 *
	 * Top to bottom: the **status strip** (*Sessions can reply* = the Reply
	 * default is filled), the **loadouts grid** (one tile per loadout, grouped
	 * by output kind), **New loadout**, and the **defaults ledger** (every job
	 * and its default, with Change / Fill). Every press opens the **loadout
	 * editor** (`loadouts/LoadoutSheet.svelte`), a dialog — never a place.
	 *
	 * Doors from outside, consumed once each (the digest is one shared slot):
	 * `digest.loadoutId` opens that loadout's sheet; `digest.connectionsJob`
	 * (a transform id) opens that job's default loadout, else core's declared
	 * default for it, else just the grid (`loadoutForJob`).
	 *
	 * The connections list (steps 1 and 2 of the sheet) comes from the
	 * connections context, held while this view is mounted. No draft is
	 * held here, so no close gate is registered.
	 */
	import { getContext, onDestroy, onMount, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { useConnections } from "$lib/client/contexts/connections.svelte"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"
	import PanelSplit from "$lib/client/components/panels/PanelSplit.svelte"
	import ViewToolbar from "$lib/client/components/panels/ViewToolbar.svelte"
	import LoadingState from "$lib/client/components/LoadingState.svelte"
	import StatusStrip from "$lib/client/components/connections/StatusStrip.svelte"
	import LoadoutsGrid from "$lib/client/components/loadouts/LoadoutsGrid.svelte"
	import LoadoutsLedger from "$lib/client/components/loadouts/LoadoutsLedger.svelte"
	import LoadoutSheet from "$lib/client/components/loadouts/LoadoutSheet.svelte"
	import NewLoadoutDialog from "$lib/client/components/loadouts/NewLoadoutDialog.svelte"
	import {
		groupLoadouts,
		ledgerRows,
		newLoadoutJobs,
		replyStrip
	} from "$lib/client/components/loadouts/loadoutsGrid"
	import { loadoutForJob } from "$lib/client/components/loadouts/loadoutSheet"

	interface Props {
		/** Bound by the shell; this view holds no draft and sets none. */
		onclose?: () => Promise<boolean> | undefined
	}
	let { onclose = $bindable() }: Props = $props()

	const panelsCtx: PanelsCtx | undefined = getContext("panelsCtx")
	const socket = useTypedSocket()
	const conns = useConnections()
	const vm = new ViewModeTracker()

	let list = $state<Sockets.Loadouts.List.Response | null>(null)
	const groups = $derived(
		list ? groupLoadouts(list.loadouts, list.transforms) : []
	)
	const ledger = $derived(
		list
			? ledgerRows(list.transforms, list.loadouts, (job) =>
					loadoutForJob(job, list!)
				)
			: []
	)
	const strip = $derived(list ? replyStrip(list) : null)
	const jobs = $derived(list ? newLoadoutJobs(list.transforms) : [])

	// ── The sheet ───────────────────────────────────────────────────────────
	let sheetId = $state<number | null>(null)
	const sheetLoadout = $derived(
		sheetId != null && list
			? (list.loadouts.find((l) => l.id === sheetId) ?? null)
			: null
	)
	function openSheet(id: number | null) {
		newOpen = false
		sheetId = id
	}
	function openJob(job: string) {
		if (!list) {
			pendingJob = job
			return
		}
		openSheet(loadoutForJob(job, list))
	}

	// ── New loadout (the editor opened empty; it creates the row itself) ────
	let newOpen = $state(false)

	// ── Answers ─────────────────────────────────────────────────────────────
	useInterest<"loadouts:list">("loadouts:list", (msg) => {
		list = msg
	})

	// ⚠ After the interests above: effects run in declaration order.
	onMount(() => {
		socket.emit("loadouts:list", {})
		conns.requestList()
	})

	// ── Doors ───────────────────────────────────────────────────────────────
	/** A job door that arrived before the list did. */
	let pendingJob = $state<string | null>(null)
	$effect(() => {
		const id = panelsCtx?.digest.loadoutId
		if (id == null) return
		untrack(() => {
			panelsCtx!.digest.loadoutId = undefined
			openSheet(id)
		})
	})
	$effect(() => {
		const job = panelsCtx?.digest.connectionsJob
		if (!job) return
		untrack(() => {
			panelsCtx!.digest.connectionsJob = undefined
			openJob(job)
		})
	})
	$effect(() => {
		if (!list || !pendingJob) return
		untrack(() => {
			const job = pendingJob!
			pendingJob = null
			openJob(job)
		})
	})

	onDestroy(() => {
		onclose = undefined
	})
</script>

<div class="flex h-full min-h-0 flex-col" use:vm.observe>
	<PanelSplit
		mode={vm.mode}
		hasDetail={false}
		listFills
		listWidth="340px"
		toolbar={listToolbar}
		list={listBody}
		detail={noDetail}
	/>
</div>

{#snippet listToolbar()}
	<ViewToolbar label="Loadouts">
		{#snippet primary()}
			<button
				type="button"
				class="btn btn-sm preset-filled-primary-500 shrink-0"
				disabled={!list}
				onclick={() => (newOpen = true)}
			>
				<Icons.Plus size={16} aria-hidden="true" />
				New loadout
			</button>
		{/snippet}
	</ViewToolbar>
{/snippet}

{#snippet listBody()}
	<div class="flex min-h-full flex-col gap-4">
		{#if !list || !strip}
			<LoadingState message="Loading loadouts…" showMessage />
		{:else}
			<StatusStrip
				state={strip.state}
				modelName={strip.modelName}
				connectionName={strip.connectionName}
				choose
				onChange={() => openJob("text->text")}
				onSetUp={() => openJob("text->text")}
			/>
			<LoadoutsGrid {groups} onOpen={openSheet} />
			<LoadoutsLedger rows={ledger} onOpen={openSheet} />
		{/if}
	</div>
{/snippet}

{#snippet noDetail()}{/snippet}

{#if list}
	<LoadoutSheet
		loadout={sheetLoadout}
		{list}
		connections={conns.listed}
		onClose={() => (sheetId = null)}
		onOpenLoadout={openSheet}
	/>
{/if}
{#if list}
	<NewLoadoutDialog
		open={newOpen}
		{jobs}
		{list}
		connections={conns.listed}
		onClose={() => (newOpen = false)}
	/>
{/if}
