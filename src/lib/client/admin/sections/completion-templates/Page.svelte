<script lang="ts">
	/**
	 * Admin › Completion templates: the changelist (note 37, Django admin)
	 * over `completion_templates`, the delimiters every prompt this instance
	 * sends is wrapped in. An immutable row is **Built-in** (`NOMENCLATURE.md`:
	 * "Built-ins seed immutable; a variant is a clone"). Filters by origin and
	 * whether a connection's format picker offers it; "Delete selected" keeps
	 * the built-ins. A row opens its change form; "Add completion template"
	 * opens the add form (`/new`), which starts blank or from another's
	 * delimiters.
	 */
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { visibleWhitespace } from "$lib/client/utils/visibleWhitespace"
	import { refreshCompletionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"
	import AdminChangelist from "$lib/client/components/admin/AdminChangelist.svelte"
	import {
		deletionFor,
		type AdminBulkAction,
		type AdminChangelistColumn,
		type AdminChangelistFilter
	} from "$lib/client/components/admin/changelist"

	type Row = SelectCompletionTemplate
	const noun = { singular: "completion template", plural: "completion templates" }

	const socket = useTypedSocket()
	const interest = getInterestContext()

	let rows = $state<Row[]>([])
	let loading = $state(true)
	let deleting = $state(0)

	/**
	 * BARE and STANDING: the server re-emits the list as a cascade after every
	 * write to the table. The app-wide interest context: `completionTemplates:`
	 * is not a restricted family; the handlers check admin.
	 */
	$effect(() => {
		const releases = [
			interest.requestWithInterest("completionTemplates:list", {}, (res) => {
				rows = res.completionTemplatesList
				loading = false
			}),
			interest.declareInterest<"completionTemplates:delete">("completionTemplates:delete", () => {
				if (!deleting) return
				if (--deleting === 0) {
					refreshCompletionTemplateOptions()
					toaster.success({ title: "Deleted" })
				}
			}),
			interest.declareInterest<"completionTemplates:delete:error">(
				"completionTemplates:delete:error",
				(res) => {
					if (deleting > 0) deleting--
					toaster.error({ title: res.error ?? "The template was not deleted." })
				}
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	/** What a system block opens with — the glanceable half of a format. */
	function opening(row: Row): string {
		const roles = (row.roles ?? {}) as Record<string, { prefix?: string } | undefined>
		return roles.system?.prefix ?? row.fallbackRole?.prefix ?? ""
	}

	const columns: AdminChangelistColumn<Row>[] = [
		{ key: "name", label: "Name", primary: true, text: (r) => r.name, sortValue: (r) => r.name },
		{ key: "key", label: "Key", text: (r) => r.key, sortValue: (r) => r.key, class: "font-mono text-xs" },
		{
			key: "opening",
			label: "System opens",
			text: (r) => visibleWhitespace(opening(r)),
			class: "font-mono text-xs",
			hideWhenStacked: true
		},
		{
			key: "origin",
			label: "Origin",
			text: (r) => (r.isImmutable ? "Built-in" : "Custom"),
			sortValue: (r) => (r.isImmutable ? 0 : 1)
		},
		{
			key: "offered",
			label: "Offered",
			text: (r) => (r.isSelectable ? "In the picker" : "Internal"),
			sortValue: (r) => (r.isSelectable ? 0 : 1)
		}
	]

	const filters: AdminChangelistFilter<Row>[] = [
		{
			key: "origin",
			label: "Origin",
			values: (r) => (r.isImmutable ? "builtin" : "custom"),
			optionLabel: (v) => (v === "builtin" ? "Built-in" : "Custom"),
			order: ["builtin", "custom"]
		},
		{
			key: "offered",
			label: "Offered",
			values: (r) => (r.isSelectable ? "yes" : "no"),
			optionLabel: (v) => (v === "yes" ? "In the format picker" : "Internal"),
			order: ["yes", "no"]
		}
	]

	const bulkActions: AdminBulkAction<Row>[] = [
		{
			key: "delete",
			label: "Delete selected completion templates…",
			icon: Icons.Trash2,
			destructive: true,
			confirm: (selected) =>
				deletionFor(selected, {
					noun,
					label: (r) => r.name,
					protect: (r) =>
						r.isImmutable ? "built-in templates are re-applied on every boot" : null,
					consequence: () =>
						"Any connection using one loses its format and renders with the default until one is chosen again"
				}),
			run: (selected) => {
				const ids = selected.filter((r) => !r.isImmutable).map((r) => r.id)
				deleting += ids.length
				for (const id of ids) socket.emit("completionTemplates:delete", { id })
			}
		}
	]
</script>

<AdminChangelist
	title="Completion templates"
	purpose="What wraps each block of a prompt: the ### User: or <|im_start|> a model was trained to read. A connection picks one; built-ins are read-only, so duplicate one to make a variant."
	{rows}
	rowKey={(r) => r.id}
	{columns}
	{filters}
	{bulkActions}
	{loading}
	{noun}
	searchText={(r) => `${r.name} ${r.key}`}
	rowHref={(r) => `/admin/completion-templates/${r.id}`}
	addHref="/admin/completion-templates/new"
	defaultSort="origin"
	emptyIcon={Icons.Brackets}
	emptyMessage="No completion templates. Core seeds the formats it ships at startup."
/>
