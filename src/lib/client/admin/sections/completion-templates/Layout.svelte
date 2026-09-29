<script lang="ts">
	/**
	 * Completion templates — the list over `completion_templates`, the
	 * delimiters every prompt this instance sends is wrapped in, beside the
	 * template it opens (`[id]/+page.svelte`, via `AdminSplit`). An immutable
	 * row carries the list's **Built-in** badge, the word `NOMENCLATURE.md`
	 * uses for this table ("Built-ins seed immutable; a variant is a clone").
	 *
	 * There is no `new/` route, following /admin/prompts: core seeds the eight
	 * formats it ships and **clone is the way to a variant**, which is also the
	 * only way to start from delimiters that already work. "New template" in
	 * the header creates a blank one for an author who wants to start from
	 * nothing, and opens it.
	 */
	import * as Icons from "@lucide/svelte"
	import { adminGoto as goto } from "$lib/client/admin/adminRouter.svelte"
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import AdminSplit from "$lib/client/components/admin/AdminSplit.svelte"
	import { visibleWhitespace } from "$lib/client/utils/visibleWhitespace"
	import { refreshCompletionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"

	let { children } = $props()

	type Row = SelectCompletionTemplate

	const socket = useTypedSocket()
	const interest = getInterestContext()

	let rows: Row[] = $state([])
	let loading = $state(true)

	function handleList(res: Sockets.CompletionTemplates.List.Response) {
		rows = res.completionTemplatesList
		loading = false
	}
	function handleCreate(res: Sockets.CompletionTemplates.Create.Response) {
		refreshCompletionTemplateOptions()
		goto(`/admin/completion-templates/${res.completionTemplate.id}`)
	}
	function handleError(res: { error?: string }) {
		toaster.error({ title: res.error ?? "The server refused that." })
	}

	/**
	 * The list, asked for and listened for in one, and the create the
	 * header's New button sends. All BARE — a template is the
	 * instance's, with nothing to scope it to.
	 *
	 * `completionTemplates:list` is a STANDING key: the server re-emits it as
	 * a cascade after every write to the table, which is how this list redraws
	 * without asking again. The refusal is declared too, and never gated.
	 *
	 * The app-wide interest context, not `adminInterest`: `completionTemplates:`
	 * is not a restricted interest family, and the admin gate is the one
	 * `/admin/+layout.svelte` already makes.
	 */
	$effect(() => {
		const releases = [
			interest.declareInterest<"completionTemplates:create">(
				"completionTemplates:create",
				handleCreate
			),
			interest.declareInterest<"completionTemplates:create:error">(
				"completionTemplates:create:error",
				handleError
			),
			interest.requestWithInterest(
				"completionTemplates:list",
				{},
				handleList
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	/** What a system block opens with — the glanceable half of a format. */
	function opening(row: Row): string {
		const roles = (row.roles ?? {}) as Record<
			string,
			{ prefix?: string } | undefined
		>
		return roles.system?.prefix ?? row.fallbackRole?.prefix ?? ""
	}

	function createBlank() {
		// A key nobody has: the server refuses a collision by name, but landing
		// on the change form beats being told to pick a different one first.
		const taken = new Set(rows.map((r) => r.key))
		let key = "custom-template"
		for (let n = 2; taken.has(key); n++) key = `custom-template-${n}`
		socket.emit("completionTemplates:create", {
			completionTemplate: {
				key,
				name: "Custom template",
				renderMode: "flat",
				// Something to open with, because a template that opens with
				// nothing for every role is refused on save — starting from a
				// draft the server would reject is not a blank slate, it is a
				// puzzle.
				roles: Object.fromEntries(
					[
						"system",
						"user",
						"assistant",
						"model",
						"tool",
						"function"
					].map((r) => [r, { prefix: `### ${r}\n`, suffix: "\n" }])
				),
				fallbackRole: { prefix: "### user\n", suffix: "\n" },
				stopStrings: [],
				isSelectable: true
			} as any
		})
	}

	const columns: AdminColumn<Row>[] = [
		{ key: "name", label: "Name", value: (r) => r.name },
		// Numeric so built-ins sort first, matching the server's
		// `desc(isImmutable)` — and the client sort is stable, so names stay
		// alphabetical inside each group.
		{ key: "kind", label: "Kind", value: (r) => (r.isImmutable ? 0 : 1) },
		{ key: "key", label: "Key", value: (r) => r.key },
		{ key: "opening", label: "System opens", value: (r) => opening(r) },
		{
			key: "offered",
			label: "Offered",
			value: (r) => (r.isSelectable ? 0 : 1)
		}
	]

	let selectedId = $derived(page.params.id)

	/** The key, and the escaped opening: the whitespace is the subject here. */
	function meta(r: Row): string {
		const open = visibleWhitespace(opening(r))
		const parts = [open ? `${r.key} · ${open}` : r.key]
		if (!r.isSelectable) parts.push("internal")
		return parts.join(" · ")
	}
</script>

<AdminPageHeader
	title="Completion templates"
	purpose="What wraps each block of a prompt: the ### User: or <|im_start|> a model was trained to read. A connection picks one; built-ins are read-only, so clone one to make a variant."
>
	{#snippet actions()}
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500"
			onclick={createBlank}
		>
			<Icons.Plus size={16} /> New template
		</button>
	{/snippet}
</AdminPageHeader>

<AdminSplit
	hasDetail={!!selectedId}
	emptyMessage="Pick a template to read or edit it."
>
	{#snippet list()}
		<AdminList
			{rows}
			{columns}
			{loading}
			compact
			rowTitle={(r) => r.name}
			rowMeta={meta}
			rowBadge={(r) => (r.isImmutable ? "Built-in" : undefined)}
			isSelected={(r) => String(r.id) === selectedId}
			searchText={(r) => `${r.name} ${r.key}`}
			searchPlaceholder="Filter completion templates"
			defaultSort="kind"
			emptyMessage="No completion templates. Core seeds the formats it ships at startup."
			onRowClick={(r) => goto(`/admin/completion-templates/${r.id}`)}
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
