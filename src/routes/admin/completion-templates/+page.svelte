<script lang="ts">
	/**
	 * Completion templates — the changelist over `completion_templates`, the
	 * delimiters every prompt this instance sends is wrapped in.
	 *
	 * ## One word for one bit: **built-in**
	 *
	 * Three spellings of `is_immutable` exist across this admin area today —
	 * "built-in" (prompts, scripts, presets, genres), "Built-in"/"Custom"
	 * (sampling), "🔒 shipped"/"custom" (configurations). This page uses
	 * **built-in** / **custom**, lowercase: it is the majority spelling by
	 * section, and it is the word `NOMENCLATURE.md` already uses for this very
	 * table ("Built-ins seed immutable; a variant is a clone"). No fourth word
	 * is introduced. The inconsistency in the other two sections is recorded
	 * rather than fixed here — renaming a badge somebody else's screenshot
	 * documents is its own change.
	 *
	 * There is no `new/` route, following /admin/prompts: core seeds the eight
	 * formats it ships and **clone is the way to a variant**, which is also the
	 * only way to start from delimiters that already work. "New template" below
	 * creates a blank one for an author who wants to start from nothing.
	 */
	import { onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"
	import { visibleWhitespace } from "$lib/client/utils/visibleWhitespace"
	import { refreshCompletionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"

	type Row = SelectCompletionTemplate

	const socket = useTypedSocket()

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

	onMount(() => {
		socket.on("completionTemplates:list", handleList)
		socket.on("completionTemplates:create", handleCreate)
		socket.on("completionTemplates:create:error", handleError)
		socket.emit("completionTemplates:list", {})
	})
	onDestroy(() => {
		socket.off("completionTemplates:list", handleList)
		socket.off("completionTemplates:create", handleCreate)
		socket.off("completionTemplates:create:error", handleError)
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
					].map((r) => [
						r,
						{ prefix: `### ${r}\n`, suffix: "\n" }
					])
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
		},
		{ key: "actions", label: "", class: "w-px text-right" }
	]
</script>

<div class="mb-4 flex flex-wrap items-start gap-3">
	<div class="flex-1">
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.Brackets size={20} /> Completion templates
		</h2>
		<p class="text-surface-600-400 text-sm">
			What wraps each block of a prompt — the
			<code>### User:</code>
			or <code>&lt;|im_start|&gt;</code> a model was trained to read. A connection
			picks one; changing a template changes every prompt sent through the connections
			using it. Built-ins are read-only: clone one to make a variant.
		</p>
	</div>
	<button
		class="btn btn-sm preset-filled-primary-500"
		onclick={createBlank}
	>
		<Icons.Plus size={16} /> New template
	</button>
</div>

<AdminList
	{rows}
	{columns}
	{loading}
	searchText={(r) => `${r.name} ${r.key}`}
	searchPlaceholder="Search completion templates…"
	defaultSort="kind"
	storageKey="serene-pub:adminView:completion-templates"
	emptyMessage="No completion templates. Core seeds the formats it ships at startup."
	onRowClick={(r) => goto(`/admin/completion-templates/${r.id}`)}
>
	{#snippet cell(row, col)}
		{#if col.key === "name"}
			<span class="font-semibold">{row.name}</span>
		{:else if col.key === "kind"}
			{#if row.isImmutable}
				<span
					class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs"
					>built-in</span
				>
			{:else}
				<span
					class="preset-tonal-secondary rounded-full px-2 py-0.5 text-xs"
					>custom</span
				>
			{/if}
		{:else if col.key === "key"}
			<code class="text-xs">{row.key}</code>
		{:else if col.key === "opening"}
			<!-- Escapes visible: the whole subject of this page is whitespace
			     nobody can see, and a column that renders "### User:" over two
			     lines says nothing about where the newline is. -->
			<code class="text-surface-700-300 text-xs break-all"
				>{visibleWhitespace(opening(row)) || "—"}</code
			>
		{:else if col.key === "offered"}
			{#if row.isSelectable}
				<span class="text-xs">yes</span>
			{:else}
				<span
					class="text-surface-600-400 text-xs"
					title="Not offered in a connection's format picker — an internal transport bridge rather than a text format anyone chooses."
					>internal</span
				>
			{/if}
		{:else if col.key === "actions"}
			<a
				class="btn btn-sm preset-tonal-surface"
				href="/admin/completion-templates/{row.id}"
				onclick={(e) => e.stopPropagation()}
			>
				<Icons.Pencil size={13} />
				{row.isImmutable ? "View" : "Edit"}
			</a>
		{/if}
	{/snippet}
</AdminList>
