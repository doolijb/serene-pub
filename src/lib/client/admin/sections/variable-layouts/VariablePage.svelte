<script lang="ts">
	/**
	 * Admin › Writing › Variable layouts › one variable (W2): a read-only
	 * change view. Its layouts, each previewed against the variable's
	 * example value; **Use this** makes one the pub's choice, **Back to the
	 * default** undoes it. A refusal reads in words where it applies (the
	 * row, or under the header line), never as a toast; a delete asks on
	 * the confirmation page, not a dialog.
	 */
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminInline from "$lib/client/components/admin/AdminInline.svelte"
	import AdminDeleteConfirm from "$lib/client/components/admin/AdminDeleteConfirm.svelte"
	import VariableLayoutPreview from "$lib/client/components/admin/VariableLayoutPreview.svelte"
	import LoadingState from "$lib/client/components/LoadingState.svelte"
	import InlineError from "$lib/client/components/InlineError.svelte"
	import {
		deletionFor,
		type AdminChangelistColumn
	} from "$lib/client/components/admin/changelist"
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		VARIABLE_LAYOUTS_HREF,
		differenceLine,
		layoutFormHref,
		layoutStaysWords,
		namedByTemplatesWords
	} from "./variableLayoutWords"

	type Variable = Sockets.Pipelines.VariableLayouts.Variable
	type Row = Sockets.Pipelines.VariableLayouts.Row

	const socket = useTypedSocket()
	const variableId = $derived(page.params.variable ?? "")

	let variable = $state<Variable | null>(null)
	let loadError = $state<string | null>(null)
	let warnings = $state<string[]>([])
	/** The write in flight: the events carry no id, so the view remembers whose it is. */
	let pending = $state<{
		kind: "use" | "default" | "delete"
		id?: number
	} | null>(null)
	/** A refusal, where it applies: a row's id, or "default" (under the header line). */
	let refusal = $state<{
		target: number | "default"
		message: string
	} | null>(null)
	let confirming = $state<Row | null>(null)

	function take(v: Variable | undefined) {
		if (!v || v.variableId !== variableId) return false
		variable = v
		loadError = null
		return true
	}

	function reload() {
		socket.emit("pipelines:libraryVariable", {
			variableId
		})
	}

	onMount(() =>
		requestWithInterest(
			"pipelines:libraryVariable",
			{ variableId },
			(res) => {
				take(res.variable)
			}
		)
	)

	useInterest<"pipelines:libraryVariable:error">(
		"pipelines:libraryVariable:error",
		(res) => {
			loadError = res.error ?? "This variable could not be read."
		}
	)
	useInterest<"pipelines:librarySetPubLayout">(
		"pipelines:librarySetPubLayout",
		(res) => {
			if (!take(res.variable)) return
			warnings = res.warnings ?? []
			if (pending && pending.kind !== "delete") pending = null
			refusal = null
		}
	)
	useInterest<"pipelines:librarySetPubLayout:error">(
		"pipelines:librarySetPubLayout:error",
		(res) => {
			if (!pending || pending.kind === "delete") return
			refusal = {
				target:
					pending.kind === "default"
						? "default"
						: (pending.id as number),
				message: res.error ?? "That could not be changed."
			}
			pending = null
		}
	)
	for (const key of [
		"pipelines:libraryCreateTemplate",
		"pipelines:libraryUpdateTemplate",
		"pipelines:libraryCloneTemplate"
	] as const) {
		useInterest(key, () => reload())
	}
	useInterest("pipelines:libraryDeleteTemplate", () => {
		if (pending?.kind === "delete") {
			pending = null
			refusal = null
		}
		reload()
	})
	useInterest("pipelines:libraryDeleteTemplate:error", (res) => {
		if (pending?.kind !== "delete") return
		refusal = {
			target: pending.id as number,
			message: res.error ?? "That could not be deleted."
		}
		pending = null
	})

	function use(id: number | null, kind: "use" | "default") {
		warnings = []
		refusal = null
		pending = { kind, id: id ?? undefined }
		socket.emit("pipelines:librarySetPubLayout", {
			variableId,
			templateId: id
		})
	}

	function confirmDelete() {
		const row = confirming
		if (!row) return
		confirming = null
		refusal = null
		pending = { kind: "delete", id: row.id }
		socket.emit("pipelines:libraryDeleteTemplate", {
			kind: "variable",
			id: row.id
		})
	}

	const deletion = $derived(
		confirming
			? deletionFor([confirming], {
					noun: {
						singular: "variable layout",
						plural: "variable layouts"
					},
					label: (r) => r.name,
					protect: layoutStaysWords
				})
			: null
	)

	const columns: AdminChangelistColumn<Row>[] = [
		{ key: "name", label: "Name", primary: true, text: (r) => r.name },
		{ key: "owner", label: "Owner", text: (r) => r.ownerLabel },
		{ key: "preview", label: "Preview", custom: true },
		{ key: "status", label: "Status", custom: true },
		{ key: "actions", label: "Actions", custom: true }
	]
</script>

{#if confirming && deletion && variable}
	<AdminDeleteConfirm
		{deletion}
		trail={[
			{ label: variable.label, onclick: () => (confirming = null) },
			{ label: confirming.name }
		]}
		onConfirm={confirmDelete}
		onCancel={() => (confirming = null)}
	/>
{:else if loadError && !variable}
	<div class="m-auto flex flex-col items-center gap-3 py-16 text-center">
		<p class="text-surface-600-400 text-sm" role="alert">{loadError}</p>
		<a href={VARIABLE_LAYOUTS_HREF} class="btn btn-sm preset-tonal-surface">
			All variable layouts
		</a>
	</div>
{:else if !variable}
	<LoadingState />
{:else}
	{@const v = variable}
	<div class="@container/variable flex min-w-0 flex-col gap-3">
		<AdminPageHeader title={v.label} purpose={v.description}>
			{#snippet actions()}
				<a
					href={layoutFormHref(v.variableId, "new", v.inUse?.id)}
					class="btn btn-sm preset-filled-primary-500"
				>
					<Icons.Plus size={14} aria-hidden="true" />
					New layout
				</a>
			{/snippet}
			<p class="text-surface-600-400 text-sm">
				Supplied by {v.supplier}.
			</p>
			{#if v.pubDiffersFromDefault}
				<p
					class="text-surface-600-400 flex flex-wrap items-baseline gap-x-2 text-sm"
				>
					<span>Chosen for this pub.</span>
					<button
						type="button"
						class="anchor text-sm"
						onclick={() => use(null, "default")}
					>
						Back to the default
					</button>
					{#if v.default}<span>({v.default.name})</span>{/if}
				</p>
			{/if}
			{#if refusal?.target === "default"}
				<InlineError>{refusal.message}</InlineError>
			{/if}
			{#each warnings as w (w)}
				<p class="text-surface-600-400 text-sm" role="status">{w}</p>
			{/each}
		</AdminPageHeader>

		<AdminFieldset title="Example value" collapsible open={false}>
			<pre
				class="text-surface-950-50 overflow-x-auto font-mono text-xs whitespace-pre-wrap">{JSON.stringify(
					v.sample,
					null,
					2
				)}</pre>
		</AdminFieldset>

		{#if v.rows.length}
			<AdminInline
				title="Variable layouts"
				description="Each variable layout of this variable, previewed against the example value."
				rows={v.rows}
				rowKey={(r) => r.id}
				{columns}
				rowHref={(r) => layoutFormHref(v.variableId, r.id)}
			>
				{#snippet cell(r, col)}
					{#if col.key === "preview"}
						<VariableLayoutPreview
							preview={r.preview}
							error={r.previewError}
						/>
					{:else if col.key === "status"}
						<div class="flex min-w-0 flex-col items-start gap-1">
							{#if r.inUse}
								<span
									class="preset-tonal-primary inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs"
								>
									<Icons.Check size={12} aria-hidden="true" />
									In use
								</span>
							{:else}
								<button
									type="button"
									class="btn btn-sm preset-tonal-surface"
									onclick={() => use(r.id, "use")}
								>
									Use this
									<span class="sr-only">{r.name}</span>
								</button>
							{/if}
							{#if r.namedByTemplates > 0}
								<span class="text-surface-600-400 text-xs">
									{namedByTemplatesWords(r.namedByTemplates)}
								</span>
							{/if}
							{#if r.chosenByPresets.length}
								<span class="text-surface-600-400 text-xs">
									Chosen by the
									{#each r.chosenByPresets as p, i (p.id)}
										<a
											class="anchor"
											href="/admin/session-presets/{p.id}"
										>
											{p.name}
										</a>
										{i < r.chosenByPresets.length - 2
											? ", "
											: i === r.chosenByPresets.length - 2
												? " and "
												: ""}
									{/each}
									{r.chosenByPresets.length === 1
										? "preset"
										: "presets"}
								</span>
							{/if}
							{#if refusal?.target === r.id}
								<p
									class="text-error-600-400 text-xs"
									role="alert"
								>
									{refusal.message}
								</p>
							{/if}
						</div>
					{:else if col.key === "actions"}
						<div class="flex flex-wrap items-center gap-2">
							<a
								href={layoutFormHref(v.variableId, "new", r.id)}
								class="btn btn-sm preset-tonal-surface"
							>
								Duplicate
								<span class="sr-only">{r.name}</span>
							</a>
							{#if r.editable}
								<a
									href={layoutFormHref(v.variableId, r.id)}
									class="btn btn-sm preset-tonal-surface"
								>
									Edit
									<span class="sr-only">{r.name}</span>
								</a>
								<button
									type="button"
									class="btn btn-sm text-error-600-400 hover:preset-tonal-error"
									onclick={() => (confirming = r)}
								>
									Delete
									<span class="sr-only">{r.name}</span>
								</button>
							{/if}
						</div>
					{/if}
				{/snippet}
			</AdminInline>
			{#if v.differs.length > 0}
				<AdminFieldset
					title="Where this differs"
					description="These write this variable out with another layout than the one in use."
				>
					<ul class="flex flex-col gap-2">
						{#each v.differs as d (`${d.kind}:${d.kind === "template" || d.kind === "preset" ? d.id : `${d.specSlug}:${d.stepKey}`}:${d.layout.id}`)}
							{@const line = differenceLine(d)}
							<li class="text-sm">
								{line.lead}
								<a class="anchor" href={line.link.href}>
									{line.link.text}
								</a>
								{line.rest}
							</li>
						{/each}
					</ul>
				</AdminFieldset>
			{/if}
		{:else}
			<AdminFieldset title="Variable layouts">
				<div class="flex flex-wrap items-center gap-3">
					<div class="min-w-0 flex-[1_1_16rem]">
						<p class="text-surface-950-50 text-sm font-medium">
							As written
						</p>
						<p class="text-surface-600-400 text-xs">
							Written exactly as the pipeline gives it: this
							variable has no variable layout yet.
						</p>
					</div>
					<a
						href={layoutFormHref(v.variableId, "new")}
						class="btn btn-sm preset-tonal-surface"
					>
						New layout
					</a>
				</div>
			</AdminFieldset>
		{/if}
	</div>
{/if}
