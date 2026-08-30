<script lang="ts">
	/**
	 * The pipeline view (05 §0a) — the panel that eventually replaces Prompt Configs.
	 *
	 * "A flat list of the things SP does for you — replying in session, summarizing,
	 * extracting lorebook entries — each with a handful of options."
	 *
	 * ## Why there is no field list in this file
	 *
	 * PromptsSidebar is 2,811 lines, and SamplingSidebar carries a hand-written
	 * `fieldMeta` map naming every slider's label, min, max and step. Both have to
	 * be edited every time a field is added, and neither can ever show a plugin's
	 * fields at all. Here the server sends declarations — label, control, range,
	 * options, current value, and which layer that value came from — and this file
	 * renders whatever arrives. A plugin that ships a pipeline appears in this
	 * panel with no change to this file, which is the entire point of slot
	 * declarations living in the type descriptor (12 §2).
	 *
	 * ## What it deliberately does not know
	 *
	 * Node keys, node count, order, structure. An option is an opaque id and a
	 * label. Structural editing lives on the management page behind an admin
	 * check, and a panel that leaked topology would make that boundary cosmetic.
	 *
	 * ## Scope is a fact, not a question
	 *
	 * The server decides where an edit lands from where the panel was opened —
	 * user scope from the list, session scope from inside a session you own (05 §0a) —
	 * and says so in `writeScope`. This shows it rather than asking, because a
	 * scope picker asks the user to understand the resolution chain before they
	 * can change a prompt.
	 */
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import PanelToolbar from "$lib/client/components/panels/PanelToolbar.svelte"
	import PipelineConfigOptions from "$lib/client/components/pipelines/PipelineConfigOptions.svelte"
	import EmptyState from "$lib/client/components/EmptyState.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
		/** Set when the panel is opened from inside a session. */
		sessionId?: number
	}

	let { onclose = $bindable(), sessionId }: Props = $props()

	const socket = useTypedSocket()
	const userCtx: { user: SelectUser } = getContext("userCtx")

	let list = $state<Sockets.Pipelines.Namespace[]>([])
	let selectedSlug = $state<string | null>(null)
	let loading = $state(true)

	const isAdmin = $derived(!!userCtx.user?.isAdmin)

	const selectedName = $derived(
		list.find((ns) => ns.slug === selectedSlug)?.name ?? selectedSlug ?? ""
	)

	function open(slug: string) {
		selectedSlug = slug
	}

	function back() {
		selectedSlug = null
	}

	const onList = (res: Sockets.Pipelines.List.Response) => {
		list = res.pipelinesList
		loading = false
		// One pipeline and nothing to choose between: go straight to it rather
		// than making the user click through a list of length one.
		if (!selectedSlug && list.length === 1) open(list[0].slug)
	}

	onMount(() => {
		socket.on("pipelines:list", onList)
		socket.emit("pipelines:list", {})
	})

	onDestroy(() => {
		socket.off("pipelines:list", onList)
	})
</script>

{#if !selectedSlug}
	<!-- No section title: Layout's PanelHeader already shows "Pipelines". -->
	{#if loading}
		<p class="text-muted p-4 text-sm">Loading…</p>
	{:else if !list.length}
		<EmptyState
			icon={Icons.Workflow}
			message="No pipelines are published on this instance yet."
		/>
	{:else}
		<div class="flex flex-col gap-2 px-3 pb-4">
			{#each list as ns (ns.slug)}
				<button
					type="button"
					class="card preset-filled-surface-100-900 hover:preset-tonal-primary flex w-full items-center gap-3 p-4 text-left transition-colors"
					onclick={() => open(ns.slug)}
				>
					<Icons.Workflow size={18} class="shrink-0 opacity-70" />
					<span class="min-w-0 flex-1">
						<span class="block truncate font-medium">
							{ns.name}
						</span>
						<span class="text-muted block truncate text-xs">
							v{ns.version}{ns.enabled ? "" : " · disabled"}
						</span>
					</span>
					<Icons.ChevronRight size={16} class="shrink-0 opacity-60" />
				</button>
			{/each}
		</div>
	{/if}
{:else}
	{@const slug = selectedSlug ?? ""}
	<PanelNavHeader title={selectedName} onBack={back} />

	<div class="px-3 pb-2">
		<PipelineConfigOptions {slug} {sessionId} />
	</div>

	{#if isAdmin}
		<PanelToolbar label="Pipeline management" class="mt-2 mb-4">
			<a
				class="btn btn-sm preset-tonal-primary flex-1"
				href="/admin/pipelines/{encodeURIComponent(slug)}"
			>
				<Icons.Settings2 size={16} /> Manage pipeline
			</a>
		</PanelToolbar>
	{/if}
{/if}
