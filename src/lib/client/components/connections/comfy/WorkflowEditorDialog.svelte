<script lang="ts">
	/**
	 * 🚧 The workflow **editor** (DESIGN-image-generation §4.12 "One editor"):
	 * the same dialog over an existing row — the JSON with its holes in a
	 * CodeField (ruling 10-09: code fields are CodeMirror), the variables
	 * panel (with a re-runnable fit after pasting a new export), the output
	 * mark, the sheet sentence and *Draw a test*.
	 *
	 * A shipped starter opens read-only: *Duplicate to edit*.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import CodeField from "$lib/client/components/codeField/CodeField.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import type { WorkflowVariable } from "$lib/shared/imageGen/types"
	import WorkflowFittingForm from "./WorkflowFittingForm.svelte"
	import WorkflowFacts from "./WorkflowFacts.svelte"
	import ComfyDrawTest from "./ComfyDrawTest.svelte"
	import { workflowsApi } from "./workflowsApi"
	import { outputCandidates } from "./workflowsTab"
	import { parseDefault } from "./fitting"

	interface Props {
		open: boolean
		workflowId: number | null
		connectionId: number | null
		onDuplicate?: (id: number) => void
		onClose: () => void
	}

	let { open, workflowId, connectionId, onDuplicate, onClose }: Props = $props()

	const api = workflowsApi(useTypedSocket())

	let row = $state<Sockets.Workflows.Row | null>(null)
	let name = $state("")
	let description = $state("")
	let documentText = $state("")
	let variables = $state<WorkflowVariable[]>([])
	let outputNode = $state<string | null>(null)
	let refitting = $state(false)
	let refitText = $state("")
	let refitGo = $state(false)
	let saving = $state(false)
	let error = $state<string | null>(null)
	let revision = $state(0)

	const readOnly = $derived(!!row?.seedKey)

	function load(r: Sockets.Workflows.Row | null) {
		row = r
		name = r?.name ?? ""
		description = r?.description ?? ""
		documentText = r?.document ?? ""
		variables = (r?.variables ?? []).map((v) => ({ ...v }))
		outputNode = r?.outputNode ?? null
	}

	$effect(() => {
		if (!open || workflowId == null) return
		const id = workflowId
		error = null
		refitting = false
		refitGo = false
		refitText = ""
		api.get(id)
			.then((r) => id === workflowId && load(r))
			.catch((e) => (error = e instanceof Error ? e.message : String(e)))
	})

	const outputs = $derived(outputCandidates(documentText))
	const dirty = $derived(
		!!row &&
			(name !== row.name ||
				(description || null) !== (row.description || null) ||
				documentText !== row.document ||
				outputNode !== (row.outputNode ?? null) ||
				JSON.stringify(variables) !== JSON.stringify(row.variables))
	)

	async function save() {
		if (!row || readOnly) return
		saving = true
		error = null
		try {
			load(
				await api.update(row.id, {
					name: name.trim(),
					description: description.trim() || null,
					document: documentText,
					variables,
					outputNode
				})
			)
			revision++
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			saving = false
		}
	}
</script>

<Dialog {open} onOpenChange={(e) => !e.open && onClose()}>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content
				class="card bg-surface-100-900 flex max-h-[90vh] w-full max-w-3xl flex-col gap-4 overflow-y-auto p-6 shadow-xl"
				aria-labelledby="workflow-editor-title"
			>
				<header class="flex items-start gap-2">
					<h2 id="workflow-editor-title" class="h4 flex-1">
						{readOnly ? "Starter workflow" : "Edit workflow"}
					</h2>
					<button
						type="button"
						class="btn-icon btn-icon-sm preset-tonal-surface"
						aria-label="Close"
						onclick={onClose}
					>
						<Icons.X size={16} aria-hidden="true" />
					</button>
				</header>

				{#if !row}
					<p class="text-surface-600-400 text-sm">{error ?? "Loading the workflow…"}</p>
				{:else if refitGo}
					<WorkflowFittingForm
						content={refitText}
						{connectionId}
						replaceId={row.id}
						initialName={row.name}
						initialDescription={row.description}
						onSaved={(r) => {
							load(r)
							refitGo = false
							refitting = false
							revision++
						}}
						onCancel={() => (refitGo = false)}
					/>
				{:else}
					{#if readOnly}
						<p class="preset-tonal-surface rounded-md p-2 text-sm">
							Shipped with Serene Pub and read-only.
							{#if onDuplicate}
								<button
									type="button"
									class="anchor underline"
									onclick={() => onDuplicate?.(row!.id)}
								>
									Duplicate to edit
								</button>
							{/if}
						</p>
					{/if}
					<div class="grid gap-3 sm:grid-cols-2">
						<label class="flex flex-col gap-1 text-sm">
							<span class="font-semibold">Name</span>
							<input class="input" type="text" bind:value={name} disabled={readOnly} />
						</label>
						<label class="flex flex-col gap-1 text-sm">
							<span class="font-semibold">Description</span>
							<input class="input" type="text" bind:value={description} disabled={readOnly} />
						</label>
					</div>

					<section class="flex flex-col gap-1">
						<h3 class="text-sm font-semibold">The workflow</h3>
						<p class="text-surface-600-400 text-xs">
							ComfyUI's API format, with <code>{"{{…}}"}</code> where Serene Pub fills in a value.
						</p>
						<CodeField
							value={documentText}
							oninput={(v) => (documentText = v)}
							readonly={readOnly}
							rows={12}
							label="Workflow JSON"
						/>
					</section>

					<section class="flex flex-col gap-2" aria-labelledby="wf-vars-title">
						<div class="flex items-center gap-2">
							<h3 id="wf-vars-title" class="flex-1 text-sm font-semibold">Variables</h3>
							{#if !readOnly}
								<button
									type="button"
									class="btn btn-sm preset-tonal-surface"
									onclick={() => (refitting = !refitting)}
								>
									<Icons.FileUp size={14} aria-hidden="true" />
									Paste a new export
								</button>
							{/if}
						</div>
						{#if refitting}
							<div class="flex flex-col gap-2">
								<p class="text-surface-600-400 text-xs">
									Paste an updated Export (API) file. It is fitted again.
								</p>
								<textarea
									class="textarea h-32 font-mono text-xs"
									bind:value={refitText}
									spellcheck="false"
									aria-label="New export"
								></textarea>
								<div class="flex justify-end">
									<button
										type="button"
										class="btn btn-sm preset-filled-primary-500"
										disabled={!refitText.trim()}
										onclick={() => (refitGo = true)}
									>
										Fit it
									</button>
								</div>
							</div>
						{/if}
						{#if variables.length}
							<div class="flex flex-col divide-y divide-surface-200-800" role="table" aria-label="Variables">
								{#each variables as v, i (v.name)}
									<div class="grid grid-cols-[1fr_6rem_10rem] items-center gap-2 py-1.5 text-sm" role="row">
										<span role="cell" class="min-w-0 truncate font-mono text-xs" title={v.label ?? v.name}>
											{v.name}
										</span>
										<span role="cell" class="text-surface-600-400 text-xs">{v.type}</span>
										<input
											role="cell"
											class="input input-sm"
											type="text"
											aria-label="Default for {v.name}"
											disabled={readOnly}
											value={v.default === undefined ? "" : String(v.default)}
											onchange={(e) =>
												(variables[i] = {
													...v,
													default: parseDefault(e.currentTarget.value, v.default)
												})}
										/>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-surface-600-400 text-xs">This workflow declares no variables.</p>
						{/if}
					</section>

					<section class="flex flex-col gap-1">
						<h3 class="text-sm font-semibold">Output</h3>
						{#if outputs.length}
							<Select
								label="The picture the run keeps"
								class="w-full"
								disabled={readOnly}
								options={outputs.map((o) => ({
									value: o.nodeId,
									label: `Node ${o.nodeId} · ${o.classType}`
								}))}
								value={outputNode ?? ""}
								onValueChange={(v) => (outputNode = v)}
							/>
						{:else}
							<p class="text-surface-600-400 text-xs">
								Marked on node {outputNode ?? "—"}.
							</p>
						{/if}
					</section>

					<section class="flex flex-col gap-2">
						<h3 class="text-sm font-semibold">What it does</h3>
						<WorkflowFacts workflowId={row.id} {connectionId} {revision} />
					</section>

					{#if connectionId != null}
						<details class="flex flex-col gap-2">
							<summary class="cursor-pointer text-sm font-semibold">Draw a test</summary>
							<div class="mt-2">
								<ComfyDrawTest {connectionId} fixedWorkflowId={row.id} />
							</div>
						</details>
					{/if}

					{#if error}<p class="text-error-600-400 text-sm" role="alert">{error}</p>{/if}

					<footer class="flex justify-end gap-2">
						<button type="button" class="btn preset-tonal-surface" onclick={onClose}>
							{dirty ? "Discard" : "Close"}
						</button>
						{#if !readOnly}
							<button
								type="button"
								class="btn preset-filled-primary-500"
								disabled={!dirty || saving || !name.trim()}
								onclick={save}
							>
								Save
							</button>
						{/if}
					</footer>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
