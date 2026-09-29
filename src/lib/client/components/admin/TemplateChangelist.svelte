<script lang="ts">
	/**
	 * The list half of the template admin (context templates and variable
	 * templates share everything but their pool vocabulary), rendered by each
	 * section's `+layout.svelte` as a list beside the template it opens
	 * (`AdminSplit`). The detail is the section's `[id]` or `new` page —
	 * `TemplateChangeForm` — passed in as `children`. Rows come from the
	 * pipeline library view.
	 */
	import * as Icons from "@lucide/svelte"
	import type { Snippet } from "svelte"
	import { adminGoto as goto } from "$lib/client/admin/adminRouter.svelte"
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import { requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import AdminSplit from "$lib/client/components/admin/AdminSplit.svelte"

	type Template = Sockets.Pipelines.Library.LibraryTemplate

	interface Props {
		kind: "context" | "variable"
		title: string
		description: string
		/** Route base, e.g. `/admin/context-templates`. */
		basePath: string
		/** The detail: the section's `[id]` or `new` page. */
		children?: Snippet
	}
	let { kind, title, description, basePath, children }: Props = $props()

	let view = $state<Sockets.Pipelines.Library.Response>({})
	let loading = $state(true)

	function handleLibrary(res: Sockets.Pipelines.Library.Response) {
		view = res
		loading = false
	}

	/**
	 * The rows this changelist renders, asked for and listened for in one.
	 * BARE — the library is the instance's, not one session's. The app-wide
	 * registry, not `adminInterest`: `pipelines:` is a MIXED family, most of
	 * whose handlers answer every user, so this is an ordinary key.
	 */
	$effect(() => requestWithInterest("pipelines:library", {}, handleLibrary))

	let rows = $derived(
		(kind === "context"
			? (view.contextTemplates ?? [])
			: (view.variableTemplates ?? [])) as Template[]
	)

	const columns: AdminColumn<Template>[] = [
		{ key: "name", label: "Name", value: (r) => r.name },
		{ key: "pool", label: "Pool", value: (r) => r.poolLabel },
		{ key: "engine", label: "Engine", value: (r) => r.engine ?? "" },
		{ key: "usedBy", label: "Used by", value: (r) => r.usedBy.length }
	]

	let selectedId = $derived(page.params.id)
	let hasDetail = $derived(!!selectedId || page.url.pathname.endsWith("/new"))

	const usedBy = (r: Template) =>
		r.usedBy.length
			? `${r.usedBy.length} pipeline${r.usedBy.length === 1 ? "" : "s"}`
			: "unused"
</script>

<AdminPageHeader {title} purpose={description}>
	{#snippet actions()}
		<a class="btn btn-sm preset-filled-primary-500" href="{basePath}/new">
			<Icons.Plus size={16} /> New template
		</a>
	{/snippet}
</AdminPageHeader>

<AdminSplit {hasDetail} emptyMessage="Pick a template to read or edit it.">
	{#snippet list()}
		<AdminList
			{rows}
			{columns}
			{loading}
			compact
			rowTitle={(r) => r.name}
			rowMeta={(r) => `${r.poolLabel} · ${usedBy(r)}`}
			rowBadge={(r) => (r.isImmutable ? "Built-in" : undefined)}
			isSelected={(r) => String(r.id) === selectedId}
			searchText={(r) => `${r.name} ${r.poolLabel} ${r.engine ?? ""}`}
			searchPlaceholder="Filter templates"
			defaultSort="pool"
			pageSize={50}
			emptyMessage="No templates yet."
			onRowClick={(r) => goto(`${basePath}/${r.id}`)}
		>
			{#snippet cell(row)}{row.name}{/snippet}
		</AdminList>
	{/snippet}
	<!-- Keyed: SvelteKit reuses the page when only the id changes, and a
	     detail seeds its form once. -->
	{#key page.url.pathname}
		{@render children?.()}
	{/key}
</AdminSplit>
