<script lang="ts">
	/**
	 * 🚧 **Add workflow** (DESIGN-image-generation §4.8 step 1): the one door.
	 * Two routes — **Import a file** (paste or upload an API-format export,
	 * then the fitting form) and **Start from a starter** (a copy of one of the
	 * six shipped starters, opened in the editor). After an import saves, the
	 * row's sheet sentence and *Validate against this server* follow in place.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import WorkflowFittingForm from "./WorkflowFittingForm.svelte"
	import WorkflowFacts from "./WorkflowFacts.svelte"
	import { workflowsApi } from "./workflowsApi"
	import { validityChip } from "./workflowsTab"

	interface Props {
		open: boolean
		connectionId: number | null
		starters: readonly Sockets.Workflows.Summary[]
		onServer?: Sockets.Workflows.OnServer.Response | null
		/** A starter was copied: the tab opens the copy in the editor. */
		onStarterCopied: (row: Sockets.Workflows.Row) => void
		onClose: () => void
	}

	let { open, connectionId, starters, onServer = null, onStarterCopied, onClose }: Props =
		$props()

	const api = workflowsApi(useTypedSocket())

	type Route = "choose" | "import" | "fit" | "saved" | "starter"
	let route = $state<Route>("choose")
	let pasted = $state("")
	let fileName = $state("")
	let saved = $state<Sockets.Workflows.Row | null>(null)
	let busy = $state(false)
	let error = $state<string | null>(null)

	$effect(() => {
		if (!open) return
		route = "choose"
		pasted = ""
		fileName = ""
		saved = null
		error = null
	})

	async function readFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0]
		if (!file) return
		fileName = file.name
		pasted = await file.text()
	}

	const suggestedName = $derived(
		fileName.replace(/\.(api\.)?json$/i, "").replace(/[_-]+/g, " ").trim() || "My workflow"
	)

	async function copyStarter(id: number) {
		busy = true
		error = null
		try {
			const row = await api.duplicate(id)
			onStarterCopied(row)
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}
</script>

<Dialog {open} onOpenChange={(e) => !e.open && onClose()}>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content
				class="card bg-surface-100-900 flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto p-6 shadow-xl"
				aria-labelledby="workflow-add-title"
			>
				<header class="flex items-start gap-2">
					<h2 id="workflow-add-title" class="h4 flex-1">Add workflow</h2>
					<button
						type="button"
						class="btn-icon btn-icon-sm preset-tonal-surface"
						aria-label="Close"
						onclick={onClose}
					>
						<Icons.X size={16} aria-hidden="true" />
					</button>
				</header>

				{#if route === "choose"}
					<div class="grid gap-3 sm:grid-cols-2">
						<button
							type="button"
							class="card preset-tonal-surface flex flex-col items-start gap-1 p-4 text-left"
							onclick={() => (route = "import")}
						>
							<span class="flex items-center gap-2 font-semibold">
								<Icons.FileUp size={16} aria-hidden="true" />
								Import a file
							</span>
							<span class="text-surface-600-400 text-xs">
								Your own workflow, exported from ComfyUI with
								<strong>Export (API)</strong>.
							</span>
						</button>
						<button
							type="button"
							class="card preset-tonal-surface flex flex-col items-start gap-1 p-4 text-left"
							onclick={() => (route = "starter")}
						>
							<span class="flex items-center gap-2 font-semibold">
								<Icons.Sparkles size={16} aria-hidden="true" />
								Start from a starter
							</span>
							<span class="text-surface-600-400 text-xs">
								A copy of one of the workflows Serene Pub ships, ready to edit.
							</span>
						</button>
					</div>
				{:else if route === "import"}
					<div class="flex flex-col gap-3">
						<p class="text-surface-600-400 text-sm">
							In ComfyUI, turn on <strong>Dev mode</strong> in its settings, then use
							<strong>Export (API)</strong>. Paste the file's text here, or choose the file.
						</p>
						<label class="flex flex-col gap-1 text-sm">
							<span class="font-semibold">The workflow file</span>
							<input
								type="file"
								accept=".json,application/json"
								class="input"
								onchange={readFile}
							/>
						</label>
						<label class="flex flex-col gap-1 text-sm">
							<span class="font-semibold">Or paste it</span>
							<textarea
								class="textarea h-40 font-mono text-xs"
								bind:value={pasted}
								spellcheck="false"
							></textarea>
						</label>
						<div class="flex justify-end gap-2">
							<button type="button" class="btn preset-tonal-surface" onclick={() => (route = "choose")}>
								Back
							</button>
							<button
								type="button"
								class="btn preset-filled-primary-500"
								disabled={!pasted.trim()}
								onclick={() => (route = "fit")}
							>
								Read it
							</button>
						</div>
					</div>
				{:else if route === "fit"}
					<WorkflowFittingForm
						content={pasted}
						{connectionId}
						initialName={suggestedName}
						onSaved={(row) => {
							saved = row
							route = "saved"
						}}
						onCancel={() => (route = "import")}
					/>
				{:else if route === "saved" && saved}
					<div class="flex flex-col gap-3" data-workflow-saved>
						<p class="font-semibold">Saved “{saved.name}”.</p>
						<WorkflowFacts workflowId={saved.id} {connectionId} />
						<div class="flex justify-end">
							<button type="button" class="btn preset-filled-primary-500" onclick={onClose}>
								Done
							</button>
						</div>
					</div>
				{:else if route === "starter"}
					<ul class="flex flex-col gap-2">
						{#each starters as s (s.id)}
							{@const chip = validityChip(s.id, onServer)}
							<li class="card preset-tonal-surface flex flex-col gap-1 p-3">
								<div class="flex flex-wrap items-center gap-2">
									<span class="flex-1 font-medium">{s.name}</span>
									<span
										class="badge text-xs {chip.tone === 'ready'
											? 'preset-tonal-success'
											: chip.tone === 'missing'
												? 'preset-tonal-warning'
												: 'preset-tonal-surface'}"
										title={chip.detail}
									>
										{chip.label}
									</span>
									<button
										type="button"
										class="btn btn-sm preset-filled-primary-500"
										disabled={busy}
										onclick={() => copyStarter(s.id)}
									>
										Use this starter
									</button>
								</div>
								{#if s.description}
									<p class="text-surface-600-400 text-xs">{s.description}</p>
								{/if}
							</li>
						{/each}
					</ul>
					{#if error}<p class="text-error-600-400 text-sm" role="alert">{error}</p>{/if}
					<div class="flex justify-end">
						<button type="button" class="btn preset-tonal-surface" onclick={() => (route = "choose")}>
							Back
						</button>
					</div>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
