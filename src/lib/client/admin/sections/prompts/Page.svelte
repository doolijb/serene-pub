<script lang="ts">
	/**
	 * Admin › Prompts: the changelist (note 37, Django admin). Every
	 * **pipeline prompt** (`pipeline_prompts`) with its step, the pipelines
	 * picking it and where it came from; filters by **genre**, **pipeline**
	 * and **step**, so "the prompts for the Adventure pipeline" is one click.
	 *
	 * A prompt belongs to a step's pool and follows that step into every
	 * pipeline reusing it, so the Pipeline filter means "fits" — a step of
	 * that pipeline can pick it — and Genre is pipeline → genre through the
	 * presets that bind it (`promptsAdmin.ts`). A row opens its change form at
	 * `/admin/prompts/<id>`; "Add prompt" starts one from an existing prompt
	 * (`/admin/prompts/new`), since a prompt's fields are its step's.
	 */
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { requestWithInterest, useInterest } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { docsHref } from "$lib/shared/utils/docsHref"
	import AdminChangelist from "$lib/client/components/admin/AdminChangelist.svelte"
	import type {
		AdminBulkAction,
		AdminChangelistColumn,
		AdminChangelistFilter
	} from "$lib/client/components/admin/changelist"
	import { PROMPT_NOUN, genresFitting, pipelinesFitting, promptDeletion } from "./promptsAdmin"

	type Prompt = Sockets.Pipelines.Library.LibraryPrompt
	type Pipeline = Sockets.Pipelines.Library.LibraryPipeline

	const socket = useTypedSocket()

	let view = $state<Sockets.Pipelines.Library.Response>({})
	let loading = $state(true)
	$effect(() =>
		requestWithInterest("pipelines:library", {}, (res) => {
			view = res
			loading = false
		})
	)

	/** Ids this page asked to delete, so its toast counts only its own. */
	let deleting = $state(0)
	useInterest<"pipelines:libraryDeletePrompt">("pipelines:libraryDeletePrompt", (res) => {
		if (res.library) view = res.library
		if (deleting > 0 && --deleting === 0) toaster.success({ title: "Deleted" })
	})
	useInterest<"pipelines:libraryDeletePrompt:error">(
		"pipelines:libraryDeletePrompt:error",
		(res) => {
			if (deleting > 0) deleting--
			toaster.error({ title: res.error ?? "The prompt was not deleted." })
		}
	)
	// A clone or save made on a prompt's page answers with the whole view.
	useInterest<"pipelines:libraryClonePrompt">("pipelines:libraryClonePrompt", (res) => {
		if (res.library) view = res.library
	})
	useInterest<"pipelines:libraryUpdatePrompt">("pipelines:libraryUpdatePrompt", (res) => {
		if (res.library) view = res.library
	})

	const rows = $derived((view.prompts ?? []) as Prompt[])
	const pipelines = $derived((view.pipelines ?? []) as Pipeline[])
	/** By label — the name with its genre beside it — so each genre's "Reply" reads apart. */
	const pipelineName = $derived(new Map(pipelines.map((p) => [p.slug, p.label])))
	const genreName = $derived(
		new Map(pipelines.flatMap((p) => (p.genres ?? []).map((g) => [g.id, g.name] as const)))
	)
	const poolLabel = $derived(
		new Map([
			...((view.promptPools ?? []).map((p) => [p.id, p.label] as const)),
			...rows.map((r) => [r.poolId, r.poolLabel] as const)
		])
	)

	const columns: AdminChangelistColumn<Prompt>[] = [
		{
			key: "name",
			label: "Name",
			primary: true,
			text: (r) => r.name,
			sortValue: (r) => r.name
		},
		{
			key: "step",
			label: "Step",
			text: (r) => r.poolLabel,
			sortValue: (r) => r.poolLabel
		},
		{
			key: "usedBy",
			label: "Picked by",
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
		},
		{
			// 🚧 R54: whether session owners may choose it where a pipeline offers them its prompt.
			key: "owners",
			label: "Owners",
			text: (r) => (r.hidden ? "Hidden" : "Offered"),
			sortValue: (r) => (r.hidden ? 1 : 0),
			hideWhenStacked: true
		},
		{
			key: "written",
			label: "Written in",
			text: (r) => r.origin ?? "",
			sortValue: (r) => r.origin ?? null,
			hideWhenStacked: true
		}
	]

	const filters: AdminChangelistFilter<Prompt>[] = $derived([
		{
			key: "genre",
			label: "Genre",
			values: (r) => genresFitting(r, pipelines).map((g) => g.id),
			optionLabel: (v) => genreName.get(v) ?? v
		},
		{
			key: "pipeline",
			label: "Pipeline",
			values: (r) => pipelinesFitting(r, pipelines).map((p) => p.slug),
			optionLabel: (v) => pipelineName.get(v) ?? v
		},
		{
			key: "step",
			label: "Step",
			values: (r) => r.poolId,
			optionLabel: (v) => poolLabel.get(v) ?? v
		},
		{
			key: "origin",
			label: "Origin",
			values: (r) => (r.isImmutable ? "builtin" : "custom"),
			optionLabel: (v) => (v === "builtin" ? "Built-in" : "Custom"),
			order: ["builtin", "custom"]
		},
		{
			key: "owners",
			label: "Owners",
			values: (r) => (r.hidden ? "hidden" : "offered"),
			optionLabel: (v) => (v === "hidden" ? "Hidden from owners" : "Offered to owners"),
			order: ["offered", "hidden"]
		},
		{
			key: "use",
			label: "Use",
			values: (r) => (r.usedBy.length ? "picked" : "unused"),
			optionLabel: (v) => (v === "picked" ? "Picked by a pipeline" : "Unused"),
			order: ["picked", "unused"]
		}
	])

	/**
	 * 🚧 R54: where a pipeline offers session owners a choice of prompt, they
	 * choose among the prompts not hidden here. The text is never theirs.
	 */
	function setHidden(selected: Prompt[], hidden: boolean) {
		const ids = selected.filter((r) => r.hidden !== hidden).map((r) => r.id)
		for (const id of ids) socket.emit("pipelines:libraryUpdatePrompt", { id, hidden })
		toaster.success({
			title: `${ids.length} ${ids.length === 1 ? "prompt" : "prompts"} ${hidden ? "hidden from session owners" : "offered to session owners"}`
		})
	}

	const bulkActions: AdminBulkAction<Prompt>[] = [
		{
			key: "offer",
			label: "Offer selected prompts to session owners",
			icon: Icons.Eye,
			run: (s) => setHidden(s, false)
		},
		{
			key: "hide",
			label: "Hide selected prompts from session owners",
			icon: Icons.EyeOff,
			run: (s) => setHidden(s, true)
		},
		{
			key: "delete",
			label: "Delete selected prompts…",
			icon: Icons.Trash2,
			destructive: true,
			confirm: (selected) => promptDeletion(selected),
			run: (selected) => {
				const ids = selected
					.filter((r) => !r.isImmutable && !r.usedBy.length)
					.map((r) => r.id)
				deleting += ids.length
				for (const id of ids) socket.emit("pipelines:libraryDeletePrompt", { id })
			}
		}
	]
</script>

<AdminChangelist
	title="Prompts"
	purpose="The pipelines' authored prose. Each belongs to a step, so it is offered in every pipeline that reuses the step. Filter by genre or pipeline to see what one of them can pick."
	doc={docsHref("pipelines")}
	{rows}
	rowKey={(r) => r.id}
	{columns}
	{filters}
	{bulkActions}
	{loading}
	noun={PROMPT_NOUN}
	searchText={(r) =>
		`${r.name} ${r.poolLabel} ${r.origin ?? ""} ${r.usedBy.join(" ")} ${Object.values(r.fields).join(" ")}`}
	rowHref={(r) => `/admin/prompts/${r.id}`}
	addHref="/admin/prompts/new"
	defaultSort="step"
	emptyIcon={Icons.MessageSquareText}
	emptyMessage="No prompts yet. Core seeds the prose it ships at startup."
/>
