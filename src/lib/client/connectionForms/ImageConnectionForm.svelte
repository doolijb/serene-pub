<script lang="ts">
	/**
	 * The connection form for ANY image backend.
	 *
	 * This started as a hand-written component for one
	 * backend, which would have become four hand-written components each
	 * re-implementing a URL field and a test button around a different middle.
	 * The middle is the only part that differs, and an adapter already knows its
	 * own settings, so it declares them (`profileSchema`) and this renders them.
	 * Adding ComfyUI or KoboldCPP-SD needs no Svelte at all.
	 *
	 * The two scopes are visible on screen the way they are in the code: the
	 * fields above the divider are what every image connection has, and the
	 * generated section below is what this backend alone offers.
	 */
	import * as Icons from "@lucide/svelte"
	import { onDestroy } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { mediaUrl } from "$lib/client/utils/media"
	import SchemaForm from "$lib/client/components/pipelines/SchemaForm.svelte"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { S } from "@serene-pub/sdk"
	import type { RunProgress } from "$lib/shared/sockets/progress"
	import type {
		GeneratedMedia,
		ImageProfileSchemaResponse,
		ImagesGenerateResponse
	} from "$lib/shared/sockets/imageGen"

	interface Props {
		connection: SelectConnection
	}
	let { connection = $bindable() }: Props = $props()

	const socket = useTypedSocket()

	type TestResult = {
		ok: boolean
		error?: string
		models?: string[]
		extra?: Record<string, unknown>
	}
	let testResult = $state<TestResult | null>(null)
	let models: string[] = $derived(testResult?.models ?? [])
	/**
	 * A Manager-owned connection, which changes what several fields MEAN.
	 *
	 * Its address comes from the Manager's settings rather than this row, and its
	 * model is required rather than optional — the file named here is the whole
	 * content of the load request.
	 */
	let isManaged = $derived(
		connection?.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE
	)
	/** Style names and the like, learned from the test rather than guessed. */
	let discovered = $derived(testResult?.extra ?? {})

	// ── The backend's own settings, declared by its adapter ──────────────
	let profileSchema = $state<Record<string, any> | null>(null)
	let capabilities = $state<Record<string, any> | null>(null)

	const onProfileSchema = (msg: ImageProfileSchemaResponse) => {
		if (msg.type !== connection.type) return
		profileSchema = (msg.schema as Record<string, any>) ?? null
		capabilities = (msg.capabilities as Record<string, any>) ?? null
		// Materialise the declared defaults so the form shows real values rather
		// than blanks that mean "whatever the adapter falls back to".
		if (msg.defaults && connection.extraJson) {
			const current = (connection.extraJson as any).profile ?? {}
			;(connection.extraJson as any).profile = {
				...msg.defaults,
				...current
			}
		}
	}
	socket.on("images:profileSchema", onProfileSchema)
	onDestroy(() => socket.off("images:profileSchema", onProfileSchema))

	$effect(() => {
		if (CONNECTION_TYPE.isImage(connection.type))
			socket.emit("images:profileSchema", { type: connection.type })
	})

	// The apiKey and profile bindings both need a container object.
	$effect(() => {
		if (connection && !connection.extraJson) connection.extraJson = {}
	})

	// ── Test connection ──────────────────────────────────────────────────
	// A named handler + targeted off, so unmounting this form removes only its
	// own listener and never the parent sidebar's connections:test handler.
	const onTest = (msg: Sockets.Connections.Test.Response) => {
		if (msg.connectionId != null && msg.connectionId !== connection.id)
			return
		testResult = {
			ok: msg.ok,
			error: msg.error ?? undefined,
			models: msg.models,
			extra: msg.extra
		}
	}
	socket.on("connections:test", onTest)
	onDestroy(() => socket.off("connections:test", onTest))

	function handleTest() {
		testResult = null
		socket.emit("connections:test", { connection })
	}

	// ── Test generation ──────────────────────────────────────────────────
	let genPrompt = $state("")
	let genNegative = $state("")
	let generating = $state(false)
	let genError = $state<string | null>(null)
	let genMedia = $state<GeneratedMedia[]>([])
	let ignored = $state<string[]>([])
	let progress = $state<RunProgress | null>(null)
	/**
	 * Chosen before the request, so Cancel works during the window between
	 * pressing Generate and the first progress event — which is exactly when
	 * someone notices the prompt was wrong.
	 */
	let runId = $state<string | null>(null)

	const onProgress = (msg: RunProgress) => {
		if (!runId || msg.runId !== runId) return
		if (msg.done) {
			progress = null
			return
		}
		progress = msg
	}
	socket.on("images:progress", onProgress)
	onDestroy(() => socket.off("images:progress", onProgress))

	const onGenerated = (msg: ImagesGenerateResponse) => {
		if (runId && msg.runId && msg.runId !== runId) return
		generating = false
		progress = null
		runId = null
		if (msg.ok) {
			genMedia = msg.media ?? []
			ignored = msg.ignored ?? []
			genError = msg.cancelled ? null : genError
		} else {
			genError = msg.error ?? "Generation failed."
		}
	}
	socket.on("images:generate", onGenerated)
	onDestroy(() => socket.off("images:generate", onGenerated))

	function handleGenerate() {
		if (!connection.id || !genPrompt.trim()) return
		generating = true
		genError = null
		genMedia = []
		ignored = []
		progress = null
		runId = crypto.randomUUID()
		socket.emit("images:generate", {
			connectionId: connection.id,
			runId,
			prompt: genPrompt.trim(),
			...(genNegative.trim()
				? { negativePrompt: genNegative.trim() }
				: {})
		})
	}

	function handleCancel() {
		if (runId) socket.emit("images:cancel", { runId })
	}

	const previewSrc = $derived(
		progress?.preview
			? `data:${progress.preview.mime};base64,${progress.preview.base64}`
			: null
	)
</script>

{#if connection}
	<!-- A managed connection's address is the Manager's, not this row's: the
	     loader resolves it from koboldcpp_settings on every request and ignores
	     whatever is stored here. Editing it would look like it worked and change
	     nothing, so it is shown read-only with the reason. -->
	<div class="mt-4 flex flex-col gap-1">
		<label class="font-semibold" for="img-base">Server URL</label>
		<input
			id="img-base"
			type="text"
			class="input"
			placeholder="http://localhost:5001"
			readonly={isManaged}
			bind:value={connection.baseUrl}
		/>
		{#if isManaged}
			<p class="text-muted-foreground text-xs">
				Set by the KoboldCPP Manager, in its Settings tab.
			</p>
		{/if}
	</div>

	{#if connection.extraJson}
		<div class="mt-2 flex flex-col gap-1">
			<label class="font-semibold" for="img-key">
				API Key (optional)
			</label>
			<input
				id="img-key"
				type="password"
				class="input"
				placeholder="Only if the server requires one"
				bind:value={connection.extraJson.apiKey}
			/>
		</div>
	{/if}

	<div class="mt-3 flex gap-2">
		<button
			type="button"
			class="btn preset-tonal-success btn-sm w-full"
			onclick={handleTest}
		>
			{#if testResult?.ok === true}
				Test: Okay!
			{:else if testResult?.ok === false}
				Test: Failed!
			{:else}
				Test Connection
			{/if}
		</button>
	</div>
	{#if testResult?.error}
		<p class="text-error-500 mt-2 text-sm">{testResult.error}</p>
	{/if}

	{#if models.length}
		<div class="mt-3 flex flex-col gap-1">
			<label
				class="flex items-center gap-1.5 font-semibold"
				for="img-model"
			>
				<Icons.Image size={14} />
				Checkpoint
			</label>
			<select
				id="img-model"
				class="select bg-background border-muted w-full rounded border"
				bind:value={connection.model}
			>
				<!-- For a MANAGED connection there is no server default to fall
				     back to: the model named here is the entire content of the
				     load request, and a blank one is refused at render time. The
				     old wording actively recommended the one choice that cannot
				     work. -->
				<option value="">
					{isManaged ? "— none selected —" : "(server default)"}
				</option>
				{#each models as m}
					<option value={m}>{m}</option>
				{/each}
			</select>
			<p class="text-muted-foreground text-xs">
				{#if isManaged}
					Required. The KoboldCPP Manager loads this file on demand
					when an image is requested.
				{:else}
					The base checkpoint. Leave on default to let the server
					choose.
				{/if}
			</p>
		</div>
	{/if}

	<!-- Everything below is this backend's own, rendered from what its adapter
	     declares. Core has no idea what any of these fields mean. -->
	{#if profileSchema && Object.keys(profileSchema).length && connection.extraJson}
		<div class="border-surface-500/20 mt-5 border-t pt-4">
			<h4 class="mb-1 flex items-center gap-1.5 font-semibold">
				<Icons.SlidersHorizontal size={14} />
				Backend Settings
			</h4>
			<p class="text-muted-foreground mb-3 text-xs">
				Specific to this server. Generation parameters shared by every
				image backend — steps, size, seed — live in the Sampling
				sidebar.
			</p>
			{#if Array.isArray(discovered.styles) && discovered.styles.length}
				<p class="text-muted-foreground mb-2 text-xs">
					<b>{discovered.styles.length}</b>
					styles available on this install. Copy the ones you want into
					the Styles field.
				</p>
			{/if}
			<SchemaForm
				schema={profileSchema}
				bind:values={connection.extraJson.profile}
			/>
		</div>
	{/if}

	{#if capabilities && capabilities.freeSize === false}
		<p
			class="text-muted-foreground border-surface-500/20 mt-3 rounded border p-2 text-xs"
		>
			<Icons.Info size={12} class="mr-1 inline" />
			This backend renders at a fixed set of sizes. A width and height that
			are not on that list snap to the nearest matching shape.
		</p>
	{/if}

	<!-- Test generation: prompt → images:generate → stored media, shown inline.
	     Uses the SAVED connection (the server loads it by id), so save edits to
	     the URL/key/profile first. -->
	{#if connection.id}
		<details class="mt-4">
			<summary
				class="flex cursor-pointer items-center gap-1.5 font-semibold"
			>
				<Icons.Sparkles size={14} />
				Test Generation
			</summary>
			<div class="mt-2 flex flex-col gap-2">
				<textarea
					class="textarea h-20"
					placeholder="Describe an image to generate…"
					bind:value={genPrompt}
				></textarea>
				<textarea
					class="textarea h-12"
					placeholder="Negative prompt (optional)"
					bind:value={genNegative}
				></textarea>

				{#if generating}
					<div class="flex gap-2">
						<button
							type="button"
							class="btn preset-filled-error-500 btn-sm flex-1"
							onclick={handleCancel}
						>
							<Icons.X size={14} />
							Cancel
						</button>
					</div>
				{:else}
					<button
						type="button"
						class="btn preset-filled-primary-500 btn-sm w-full"
						onclick={handleGenerate}
						disabled={!genPrompt.trim()}
					>
						<Icons.Sparkles size={14} />
						Generate
					</button>
				{/if}

				{#if generating}
					<div class="border-surface-500/20 rounded-lg border p-2">
						<div
							class="text-muted-foreground mb-1 flex items-center justify-between text-xs"
						>
							<span class="capitalize">
								{progress?.stage ?? "starting"}…
							</span>
							{#if progress?.percent != null}
								<span>{Math.round(progress.percent)}%</span>
							{/if}
						</div>
						<div
							class="bg-surface-500/20 h-1.5 w-full overflow-hidden rounded-full"
						>
							<div
								class="bg-primary-500 h-full transition-all duration-300"
								class:animate-pulse={progress?.percent == null}
								style="width: {progress?.percent ?? 100}%"
							></div>
						</div>
						{#if previewSrc}
							<img
								src={previewSrc}
								alt="Generation preview"
								class="border-surface-200-700 mt-2 h-auto w-full rounded border"
							/>
						{/if}
					</div>
				{/if}

				<p class="text-muted-foreground text-xs">
					Generates against the last <b>saved</b>
					settings and the default image sampling config, and stores the
					result to your media.
				</p>
				{#if genError}
					<p class="text-error-500 text-sm">{genError}</p>
				{/if}
				{#if ignored.length}
					<p class="text-warning-600 dark:text-warning-400 text-xs">
						<Icons.TriangleAlert size={12} class="mr-1 inline" />
						This backend could not honour: {ignored.join(", ")}.
					</p>
				{/if}
				{#if genMedia.length}
					<div class="grid grid-cols-2 gap-2">
						{#each genMedia as m (m.id)}
							<a
								href={mediaUrl(m.id)}
								target="_blank"
								rel="noopener noreferrer"
								class="border-surface-200-700 block overflow-hidden rounded-lg border"
								title={m.seed != null
									? `Seed ${m.seed}`
									: undefined}
							>
								<img
									src={mediaUrl(m.id)}
									alt="Generated"
									class="h-auto w-full"
								/>
							</a>
						{/each}
					</div>
				{/if}
			</div>
		</details>
	{/if}
{/if}
