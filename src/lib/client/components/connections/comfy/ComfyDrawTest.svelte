<script lang="ts">
	/**
	 * 🚧 **Draw a test** with a workflow (DESIGN-image-generation §4.8 step 5):
	 * the connection form's Test Generation for a template-payload connection.
	 * A ComfyUI draws with a workflow, so the test names one — a select, the
	 * first that fits this server by default — and offers only what that
	 * workflow's sheet takes (a negative only where the workflow reads one).
	 * The dials are the workflow's own — its variables' defaults.
	 *
	 * Rides `images:generate` with `workflowId`, against the SAVED connection.
	 */
	import { v4 as uuid } from "uuid"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { mediaUrl } from "$lib/client/utils/media"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import type { RunProgress } from "$lib/shared/sockets/progress"
	import type {
		GeneratedMedia,
		ImagesGenerateResponse
	} from "$lib/shared/sockets/imageGen"
	import type { DrawingSheet } from "$lib/shared/imageGen/types"
	import { sheetSentence } from "$lib/shared/imageGen/sheetSentence"
	import { workflowsApi } from "./workflowsApi"
	import { firstReadyWorkflow, validityChip } from "./workflowsTab"

	interface Props {
		connectionId: number
		/** The workflows to choose from; loaded here when absent; ignored when fixed. */
		workflows?: readonly Sockets.Workflows.Summary[]
		onServer?: Sockets.Workflows.OnServer.Response | null
		/** Draw with this one workflow (the editor's test); no select. */
		fixedWorkflowId?: number | null
	}

	let {
		connectionId,
		workflows: givenWorkflows,
		onServer: givenOnServer,
		fixedWorkflowId = null
	}: Props = $props()

	const socket = useTypedSocket()
	const api = workflowsApi(socket)

	// Loaded here when the caller has not (the connection form's Test Generation).
	let loadedWorkflows = $state<Sockets.Workflows.Summary[]>([])
	let loadedOnServer = $state<Sockets.Workflows.OnServer.Response | null>(null)
	const workflows = $derived(givenWorkflows ?? loadedWorkflows)
	const onServer = $derived(givenOnServer ?? loadedOnServer)
	$effect(() => {
		if (givenWorkflows || fixedWorkflowId != null) return
		const id = connectionId
		api.list()
			.then((l) => (loadedWorkflows = l))
			.catch(() => {})
		api.onServer(id)
			.then((r) => (loadedOnServer = r))
			.catch(() => {})
	})

	let picked = $state<string>("")
	const workflowId = $derived(
		fixedWorkflowId ??
			(picked ? Number(picked) : firstReadyWorkflow(workflows, onServer))
	)

	let sheet = $state<DrawingSheet | null>(null)
	let prompt = $state("")
	let negative = $state("")
	let generating = $state(false)
	let error = $state<string | null>(null)
	let media = $state<GeneratedMedia[]>([])
	let ignored = $state<string[]>([])
	let progress = $state<RunProgress | null>(null)
	let runId = $state<string | null>(null)

	useInterest<"images:progress">("images:progress", (msg: RunProgress) => {
		if (!runId || msg.runId !== runId) return
		progress = msg.done ? null : msg
	})
	useInterest<"images:generate">(
		"images:generate",
		(msg: ImagesGenerateResponse) => {
			if (!runId || msg.runId !== runId) return
			generating = false
			progress = null
			runId = null
			if (msg.ok) {
				media = msg.media ?? []
				ignored = msg.ignored ?? []
			} else error = msg.error ?? "The test did not draw."
		}
	)

	// The sheet of the workflow in hand, for the sentence and the negative.
	$effect(() => {
		const id = workflowId
		sheet = null
		if (id == null) return
		api.sheet(id, connectionId)
			.then((s) => {
				if (id === workflowId) sheet = s
			})
			.catch(() => {})
	})

	function draw() {
		if (workflowId == null || !prompt.trim()) return
		generating = true
		error = null
		media = []
		ignored = []
		runId = uuid()
		socket.emit("images:generate", {
			connectionId,
			workflowId,
			runId,
			prompt: prompt.trim(),
			...(sheet?.negative && negative.trim()
				? { negativePrompt: negative.trim() }
				: {})
		})
	}

	const previewSrc = $derived(
		progress?.preview
			? `data:${progress.preview.mime};base64,${progress.preview.base64}`
			: null
	)
</script>

<div class="flex flex-col gap-2" data-comfy-draw-test>
	{#if fixedWorkflowId == null}
		{#if workflows.length}
			<Select
				label="Workflow"
				options={workflows.map((w) => {
					const chip = validityChip(w.id, onServer)
					return {
						value: String(w.id),
						label: w.name,
						hint: chip.tone === "ready" ? undefined : chip.label
					}
				})}
				value={workflowId == null ? "" : String(workflowId)}
				onValueChange={(v) => (picked = v)}
			/>
		{:else}
			<p class="text-surface-600-400 text-sm">
				Add a workflow in the <strong>Workflows</strong> tab first — a ComfyUI
				draws with one.
			</p>
		{/if}
	{/if}

	{#if sheet}
		<p class="text-surface-600-400 text-xs" data-sheet-sentence>
			{sheetSentence(sheet)}
		</p>
	{/if}

	<label class="flex flex-col gap-1 text-sm">
		<span class="font-medium">Prompt</span>
		<textarea
			class="textarea h-20"
			placeholder="Describe a picture to draw…"
			bind:value={prompt}
		></textarea>
	</label>
	{#if sheet?.negative}
		<label class="flex flex-col gap-1 text-sm">
			<span class="font-medium">Negative (optional)</span>
			<textarea class="textarea h-12" bind:value={negative}></textarea>
		</label>
	{/if}

	{#if generating}
		<button
			type="button"
			class="btn btn-sm preset-tonal-error"
			onclick={() => runId && socket.emit("images:cancel", { runId })}
		>
			<Icons.X size={14} aria-hidden="true" />
			Cancel
		</button>
		<div class="border-surface-500/20 rounded-lg border p-2 text-xs">
			<span class="capitalize">{progress?.stage ?? "starting"}…</span>
			{#if progress?.percent != null}
				· {Math.round(progress.percent)}%
			{/if}
			{#if previewSrc}
				<img
					src={previewSrc}
					alt="Drawing preview"
					class="mt-2 h-auto w-full rounded"
				/>
			{/if}
		</div>
	{:else}
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500"
			disabled={workflowId == null || !prompt.trim()}
			onclick={draw}
		>
			<Icons.Sparkles size={14} aria-hidden="true" />
			Draw a test
		</button>
	{/if}

	<p class="text-surface-600-400 text-xs">
		Draws with the last <strong>saved</strong> connection at the workflow's own
		settings, and keeps the result in your media.
	</p>
	{#if error}
		<p class="text-error-600-400 text-sm" role="alert">{error}</p>
	{/if}
	{#if ignored.length}
		<p class="text-warning-700-300 text-xs">
			This workflow did not use: {ignored.join(", ")}.
		</p>
	{/if}
	{#if media.length}
		<div class="grid grid-cols-2 gap-2">
			{#each media as m (m.id)}
				<a
					href={mediaUrl(m.id)}
					target="_blank"
					rel="noopener noreferrer"
					class="border-surface-200-800 block overflow-hidden rounded-lg border"
				>
					<img src={mediaUrl(m.id)} alt="Test drawing" class="h-auto w-full" />
				</a>
			{/each}
		</div>
	{/if}
</div>
