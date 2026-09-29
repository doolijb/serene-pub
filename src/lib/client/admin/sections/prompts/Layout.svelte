<script lang="ts">
	/**
	 * Prompts — the **pipeline prompts** (`pipeline_prompts`), as a list
	 * beside the prompt it opens.
	 * No create: core seeds the prose it ships at startup, and Clone (on a
	 * prompt's page) is the way to a variant.
	 *
	 * A prompt is pooled by the *step* that consumes it and follows that step
	 * into every pipeline reusing it, so the list names the step, not a
	 * pipeline; where a row was written is a fact about its history.
	 */
	import { adminGoto as goto } from "$lib/client/admin/adminRouter.svelte"
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import AdminSplit from "$lib/client/components/admin/AdminSplit.svelte"

	let { children } = $props()

	type Prompt = Sockets.Pipelines.Library.LibraryPrompt

	let view = $state<Sockets.Pipelines.Library.Response>({})
	let loading = $state(true)

	function handleLibrary(res: Sockets.Pipelines.Library.Response) {
		view = res
		loading = false
	}
	function handleClone(res: Sockets.Pipelines.Library.Response) {
		view = res
	}

	// A clone made on a prompt's page answers with the whole refreshed view,
	// whenever that write happens, so the interest stands. BARE: the library
	// is the instance's, not one session's.
	useInterest<"pipelines:libraryClonePrompt">(
		"pipelines:libraryClonePrompt",
		handleClone
	)
	$effect(() => requestWithInterest("pipelines:library", {}, handleLibrary))

	let rows = $derived((view.prompts ?? []) as Prompt[])
	let selectedId = $derived(page.params.id)

	const columns: AdminColumn<Prompt>[] = [
		{ key: "name", label: "Name", value: (r) => r.name },
		{ key: "pool", label: "Step", value: (r) => r.poolLabel }
	]
</script>

<AdminPageHeader
	title="Prompts"
	purpose="The pipelines' authored prose. Each belongs to a step, so it is offered anywhere that step is reused. Clone a built-in to make a variant."
/>

<AdminSplit
	hasDetail={!!selectedId}
	emptyMessage="Pick a prompt to read or edit it."
>
	{#snippet list()}
		<AdminList
			{rows}
			{columns}
			{loading}
			compact
			rowTitle={(r) => r.name}
			rowMeta={(r) =>
				`${r.poolLabel} · ${r.usedBy.length ? `${r.usedBy.length} pipeline${r.usedBy.length === 1 ? "" : "s"}` : "unused"}`}
			rowBadge={(r) => (r.isImmutable ? "Built-in" : undefined)}
			isSelected={(r) => String(r.id) === selectedId}
			searchText={(r) => `${r.name} ${r.poolLabel} ${r.origin ?? ""}`}
			searchPlaceholder="Filter prompts"
			defaultSort="pool"
			pageSize={50}
			emptyMessage="No prompts yet. Core seeds the prose it ships at startup."
			onRowClick={(r) => goto(`/admin/prompts/${r.id}`)}
		>
			{#snippet cell(row)}{row.name}{/snippet}
		</AdminList>
	{/snippet}
	<!-- Keyed on the address: a detail page that reads its row once must
	     remount when another row is picked, or it keeps showing the first. -->
	{#key page.url.pathname}
		{@render children?.()}
	{/key}
</AdminSplit>
