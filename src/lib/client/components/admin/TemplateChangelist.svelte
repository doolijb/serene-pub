<script lang="ts">
	/**
	 * The changelist half of the template admin (Django admin, note 37):
	 * context templates and variable templates share everything but their
	 * pool vocabulary. Rows come from the pipeline library view; filters by
	 * pool, language, origin and use; "Delete selected" keeps built-in and
	 * in-use rows (the server refuses those). A row opens `TemplateChangeForm`
	 * at `<basePath>/<id>`; "Add template" at `<basePath>/new`.
	 */
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { requestWithInterest, useInterest } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import AdminChangelist from "./AdminChangelist.svelte"
	import {
		deletionFor,
		type AdminBulkAction,
		type AdminChangelistColumn,
		type AdminChangelistFilter
	} from "./changelist"

	type Template = Sockets.Pipelines.Library.LibraryTemplate

	interface Props {
		kind: "context" | "variable"
		title: string
		description: string
		/** Route base, e.g. `/admin/context-templates`. */
		basePath: string
	}
	let { kind, title, description, basePath }: Props = $props()

	const socket = useTypedSocket()
	const noun = { singular: "template", plural: "templates" }

	let view = $state<Sockets.Pipelines.Library.Response>({})
	let loading = $state(true)
	/**
	 * BARE — the library is the instance's, not one session's. The app-wide
	 * registry: `pipelines:` is a MIXED family, so this is an ordinary key.
	 */
	$effect(() =>
		requestWithInterest("pipelines:library", {}, (res) => {
			view = res
			loading = false
		})
	)
	let deleting = $state(0)
	useInterest<"pipelines:libraryDeleteTemplate">("pipelines:libraryDeleteTemplate", (res) => {
		if (res.library) view = res.library
		if (deleting > 0 && --deleting === 0) toaster.success({ title: "Deleted" })
	})
	useInterest<"pipelines:libraryDeleteTemplate:error">(
		"pipelines:libraryDeleteTemplate:error",
		(res) => {
			if (deleting > 0) deleting--
			toaster.error({ title: res.error ?? "The template was not deleted." })
		}
	)

	const rows = $derived(
		(kind === "context" ? (view.contextTemplates ?? []) : (view.variableTemplates ?? [])) as Template[]
	)
	/** `core:template/handlebars@1` → "Handlebars", as the pool labels say it. */
	const language = (engine: string) => {
		const n = engine.split("/")[1]?.split("@")[0]
		return n ? n.charAt(0).toUpperCase() + n.slice(1) : engine
	}
	const poolLabels = $derived(new Map(rows.map((r) => [`${r.poolId}#${r.engine}`, r.poolLabel])))

	const columns: AdminChangelistColumn<Template>[] = $derived([
		{ key: "name", label: "Name", primary: true, text: (r) => r.name, sortValue: (r) => r.name },
		{ key: "pool", label: kind === "context" ? "Step" : "Variable", text: (r) => r.poolLabel, sortValue: (r) => r.poolLabel },
		{
			key: "usedBy",
			label: "Used by",
			text: (r) =>
				r.usedBy.length
					? r.usedBy.length <= 2
						? r.usedBy.join(", ")
						: `${r.usedBy.length} pipelines`
					: "—",
			sortValue: (r) => r.usedBy.length || null
		},
		{
			key: "origin",
			label: "Origin",
			text: (r) => (r.isImmutable ? "Built-in" : "Custom"),
			sortValue: (r) => (r.isImmutable ? 0 : 1)
		}
	])

	const filters: AdminChangelistFilter<Template>[] = $derived([
		{
			key: "pool",
			label: kind === "context" ? "Step" : "Variable",
			values: (r) => `${r.poolId}#${r.engine}`,
			optionLabel: (v) => poolLabels.get(v) ?? v
		},
		{ key: "language", label: "Language", values: (r) => r.engine, optionLabel: language },
		{
			key: "origin",
			label: "Origin",
			values: (r) => (r.isImmutable ? "builtin" : "custom"),
			optionLabel: (v) => (v === "builtin" ? "Built-in" : "Custom"),
			order: ["builtin", "custom"]
		},
		{
			key: "use",
			label: "Use",
			values: (r) => (r.usedBy.length ? "used" : "unused"),
			optionLabel: (v) => (v === "used" ? "Picked by a pipeline" : "Unused"),
			order: ["used", "unused"]
		}
	])

	const bulkActions: AdminBulkAction<Template>[] = [
		{
			key: "delete",
			label: "Delete selected templates…",
			icon: Icons.Trash2,
			destructive: true,
			confirm: (selected) =>
				deletionFor(selected, {
					noun,
					label: (r) => r.name,
					protect: (r) =>
						r.isImmutable
							? "built-in templates are read-only (duplicate one to change it)"
							: r.usedBy.length
								? `still used by ${r.usedBy.join(", ")}`
								: null
				}),
			run: (selected) => {
				const ids = selected.filter((r) => !r.isImmutable && !r.usedBy.length).map((r) => r.id)
				deleting += ids.length
				for (const id of ids) socket.emit("pipelines:libraryDeleteTemplate", { kind, id })
			}
		}
	]
</script>

<AdminChangelist
	{title}
	purpose={description}
	{rows}
	rowKey={(r) => r.id}
	{columns}
	{filters}
	{bulkActions}
	{loading}
	{noun}
	searchText={(r) => `${r.name} ${r.poolLabel} ${r.engine} ${r.usedBy.join(" ")}`}
	rowHref={(r) => `${basePath}/${r.id}`}
	addHref="{basePath}/new"
	defaultSort="pool"
	emptyIcon={Icons.LayoutTemplate}
	emptyMessage="No templates yet."
/>
