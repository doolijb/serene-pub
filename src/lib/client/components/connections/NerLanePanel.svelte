<script lang="ts">
	/**
	 * The annotation lane, as the STARRED entity connection's detail panel.
	 *
	 * ## A status line, not a queue panel
	 *
	 * `EmbeddingQueuePanel` renders a priority queue with per-group controls
	 * because the embedding lane emits one: it has a `progressEvent`, a
	 * `getQueue`, and groups a person reorders. The annotation lane emits none of
	 * that — it is unconditionally enabled, it needs no start control (the
	 * lexical tier costs a regex), and its work is per-row rather than per-group.
	 * Rendering an empty copy of the embedding panel here would be six controls
	 * that do nothing, so this says the three things that are actually knowable
	 * and stops.
	 *
	 * ## What belongs here, and what does not
	 *
	 * Only what belongs to no field: whether the model is up, what failed if it
	 * did not, and how much is annotated. The service, the model and the idle
	 * timeout are ordinary connection controls above, and "off" is unstarring.
	 */
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { requestWithInterest } from "$lib/client/sockets/interest.svelte"

	interface Props {
		/** Whether the connection this is mounted under is the one starred. */
		isStarred: boolean
	}
	let { isStarred }: Props = $props()

	const socket = useTypedSocket()

	let status = $state<Sockets.Ner.Status.Response | null>(null)

	function handleStatus(msg: Sockets.Ner.Status.Response) {
		status = msg
	}

	$effect(() => {
		// The interest and the request that fills it, in one: the sync naming
		// `ner:status` leaves before the request, so the handler answering it
		// already sees the key. `ner:` is restricted interest, so a non-admin is
		// refused the key AND sends no request — which is what the admin-only
		// handler would have answered with anyway.
		return requestWithInterest("ner:status", {}, handleStatus)
	})
</script>

<div class="mt-6 flex flex-col gap-3">
	<span class="flex items-center gap-2 font-semibold">
		<Icons.ScanText size={14} aria-hidden="true" />
		Scanning
	</span>

	{#if !isStarred}
		<p class="text-surface-600-400 text-xs">
			There is one entity scan and it runs on whichever connection is in
			use. Press "Use for entity extraction" above to see its state here.
		</p>
	{:else}
		<p class="text-surface-600-400 text-xs">
			New and edited lore and messages are scanned in the background.
			Names the model finds are stored beside the ones your lorebook
			already declares, so an entry can be matched by what a scene calls
			it.
		</p>
		{#if status === null}
			<p class="text-surface-600-400 text-xs">Reading the lane…</p>
		{:else}
			<dl
				class="grid grid-cols-1 gap-x-4 gap-y-1 text-xs @lg/view:grid-cols-2"
			>
				<dt class="text-surface-600-400">Model</dt>
				<dd class="truncate font-medium">
					{status.modelId ?? "None"}
				</dd>
				<dt class="text-surface-600-400">State</dt>
				<dd
					class="font-medium {status.modelReady
						? 'text-success-500'
						: 'text-surface-600-400'}"
				>
					{status.modelReady ? "Loaded" : "Not loaded"}
				</dd>
				<dt class="text-surface-600-400">Scanned rows</dt>
				<dd class="font-medium">
					{status.annotatedRows.toLocaleString()}
				</dd>
			</dl>
			{#if !status.modelReady}
				<p class="text-surface-600-400 text-xs">
					The model loads when there is something to scan, and unloads
					again after the idle timeout above.
				</p>
			{/if}
			{#if status.loadError}
				<!-- Named rather than hidden: the lane keeps working without the
				     model, so this is the only place the failure is visible. -->
				<p class="text-warning-500 text-xs">
					The model did not load: {status.loadError}. Names are still
					matched from your lorebook in the meantime.
				</p>
			{/if}
			<button
				type="button"
				class="btn preset-filled-surface-400-600 w-fit text-xs"
				onclick={() => socket.emit("ner:status", {})}
			>
				<Icons.RefreshCw size={14} aria-hidden="true" />
				Refresh
			</button>
		{/if}
	{/if}
</div>
