<script lang="ts">
	/**
	 * Admin › Configurations: the changelist (note 37, Django admin) of every
	 * named configuration across every pipeline, with its dependents — the
	 * reverse edges no single workspace can show. Filters by pipeline,
	 * origin, default and use; "Delete selected" keeps shipped and default
	 * configurations and those a preset or session still uses.
	 *
	 * The change view is the owning workspace's Configure tab: a config is
	 * meaningless without its spec (its option space IS the spec's
	 * declarations), so a row opens `/admin/pipelines/<slug>?config=<id>` and
	 * editing stays one surface. A config is added there too.
	 */
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { adminGoto as goto } from "$lib/client/admin/adminRouter.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { requestWithInterest, useInterest } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { pipelineLabel } from "$lib/client/utils/pipelineGenre"
	import AdminChangelist from "$lib/client/components/admin/AdminChangelist.svelte"
	import {
		deletionFor,
		type AdminBulkAction,
		type AdminChangelistColumn,
		type AdminChangelistFilter
	} from "$lib/client/components/admin/changelist"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()

	type Row = Sockets.Pipelines.ConfigsIndex.Row
	const noun = { singular: "configuration", plural: "configurations" }
	let rows = $state<Row[]>([])
	let loading = $state(true)

	onMount(() => {
		if (!userCtx.user?.isAdmin) goto("/")
	})

	/**
	 * The inventory, asked for and listened for in one. BARE — it spans every
	 * pipeline. The app-wide registry: `pipelines:` is a MIXED family.
	 */
	function load() {
		return requestWithInterest("pipelines:configsIndex", {}, (res) => {
			rows = res.configs
			loading = false
		})
	}
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		return load()
	})

	/**
	 * The published pipelines and the genres' names, for the genre beside
	 * each pipeline's name: names carry none (NOMENCLATURE §2), so every
	 * genre's _Reply_ — each with its _Default_ — would read alike. Read the
	 * way Admin › Pipelines' Genre column reads them. BARE, like the index.
	 */
	let pipelines = $state<Sockets.Pipelines.Namespace[] | null>(null)
	let genres = $state<Sockets.Sessions.Genres.Response["genres"] | null>(null)
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			requestWithInterest("pipelines:list", {}, (res) => {
				pipelines = res.pipelinesList
			}),
			requestWithInterest("sessions:genres", {}, (res) => {
				genres = res.genres ?? []
			})
		]
		return () => {
			for (const release of releases) release()
		}
	})
	/** "Reply · Adventure"; the bare name until both lists arrive. */
	const pipelineOf = (r: Pick<Row, "specSlug" | "specName">) =>
		pipelineLabel(r.specSlug, pipelines, genres) ?? r.specName

	let deleting = $state(0)
	useInterest<"pipelines:deleteConfig">("pipelines:deleteConfig", () => {
		if (!deleting) return
		if (--deleting === 0) {
			toaster.success({ title: "Deleted" })
			socket.emit("pipelines:configsIndex", {})
		}
	})
	useInterest<"pipelines:deleteConfig:error">("pipelines:deleteConfig:error", (res) => {
		if (!deleting) return
		deleting--
		toaster.error({ title: res.error ?? "The configuration was not deleted." })
		if (!deleting) socket.emit("pipelines:configsIndex", {})
	})

	const workspaceHref = (r: Row) =>
		`/admin/pipelines/${encodeURIComponent(r.specSlug)}?config=${r.id}`

	const columns: AdminChangelistColumn<Row>[] = [
		{
			key: "name",
			label: "Configuration",
			primary: true,
			text: (r) => r.name + (r.isDefault ? " (default)" : ""),
			sortValue: (r) => r.name
		},
		{ key: "pipeline", label: "Pipeline", text: pipelineOf, sortValue: pipelineOf },
		{
			key: "usedByPresets",
			label: "Presets",
			numeric: true,
			text: (r) => (r.usedByPresets ? String(r.usedByPresets) : "—"),
			sortValue: (r) => r.usedByPresets || null
		},
		{
			key: "usedBySessions",
			label: "Sessions",
			numeric: true,
			text: (r) => (r.usedBySessions ? String(r.usedBySessions) : "—"),
			sortValue: (r) => r.usedBySessions || null
		},
		{
			key: "origin",
			label: "Origin",
			text: (r) => (r.isImmutable ? "Shipped" : "Custom"),
			sortValue: (r) => (r.isImmutable ? 0 : 1)
		}
	]

	const filters: AdminChangelistFilter<Row>[] = $derived([
		{
			key: "pipeline",
			label: "Pipeline",
			values: (r) => r.specSlug,
			optionLabel: (v) => {
				const r = rows.find((r) => r.specSlug === v)
				return r ? pipelineOf(r) : v
			}
		},
		{
			key: "origin",
			label: "Origin",
			values: (r) => (r.isImmutable ? "shipped" : "custom"),
			optionLabel: (v) => (v === "shipped" ? "Shipped" : "Custom"),
			order: ["shipped", "custom"]
		},
		{
			key: "default",
			label: "Default",
			values: (r) => (r.isDefault ? "yes" : "no"),
			optionLabel: (v) => (v === "yes" ? "Its pipeline's default" : "Not the default"),
			order: ["yes", "no"]
		},
		{
			key: "use",
			label: "Use",
			values: (r) => (r.usedByPresets || r.usedBySessions ? "used" : "unused"),
			optionLabel: (v) => (v === "used" ? "Used by a preset or session" : "Unused"),
			order: ["used", "unused"]
		}
	])

	const protect = (r: Row) =>
		r.isImmutable
			? "shipped configurations are replaced by updates"
			: r.isDefault
				? "it is its pipeline's default — make another the default first"
				: r.usedByPresets || r.usedBySessions
					? "a preset or session still uses it"
					: null

	const bulkActions: AdminBulkAction<Row>[] = [
		{
			key: "delete",
			label: "Delete selected configurations…",
			icon: Icons.Trash2,
			destructive: true,
			confirm: (selected) =>
				deletionFor(selected, {
					noun,
					label: (r) => `${r.name} (${pipelineOf(r)})`,
					protect
				}),
			run: (selected) => {
				const going = selected.filter((r) => !protect(r))
				deleting += going.length
				for (const r of going)
					socket.emit("pipelines:deleteConfig", { slug: r.specSlug, configId: r.id })
			}
		}
	]
</script>

<AdminChangelist
	title="Configurations"
	purpose="Every named tuning across every pipeline, and what depends on each one. Open one to edit it in its pipeline's workspace."
	{rows}
	rowKey={(r) => r.id}
	{columns}
	{filters}
	{bulkActions}
	{loading}
	{noun}
	searchText={(r) => `${r.name} ${pipelineOf(r)} ${r.specSlug}`}
	rowHref={workspaceHref}
	defaultSort="pipeline"
	emptyIcon={Icons.SlidersVertical}
	emptyMessage="No configurations — every pipeline ships one at startup, so an empty list means the bootstrap failed."
/>
