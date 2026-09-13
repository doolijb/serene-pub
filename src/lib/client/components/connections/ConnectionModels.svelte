<script lang="ts">
	/**
	 * The MODELS on this endpoint (0114) — the second half of the pair.
	 *
	 * ## One prop, and it is an id
	 *
	 * `ConnectionCapabilities`' rule verbatim, and for the same three reasons.
	 * This component never reads `connection.model` and never writes into
	 * `connection`: it is handed an id and fetches, holds and refreshes its own
	 * list over its own six events. So the editor's unsaved-changes baseline
	 * cannot be dirtied by anything here, the server keeps ownership of which
	 * model is default, and a test rewriting rows underneath us is answered by
	 * re-reading rather than by reconciling a local copy.
	 *
	 * ## The star is not a checkbox
	 *
	 * "Default" is exactly-one-per-endpoint, enforced by a partial unique index
	 * rather than by whichever handler wrote last — so it is a radio group, not a
	 * row of checkboxes. A checkbox would offer a state the database refuses (two
	 * defaults) and a state that has no meaning (none), and pressing it a second
	 * time would have to be a no-op the person cannot see the reason for.
	 *
	 * ## Nothing here predicts the result
	 *
	 * Every handler answers with the whole refreshed list, and every response
	 * REPLACES what is shown. That is not caution: creating the first model stars
	 * it, deleting the starred one promotes another, and both rewrite the
	 * endpoint's legacy mirror — so a write that patched only the row it touched
	 * would leave the star one press behind, on the control most likely to be
	 * pressed twice.
	 */
	import { onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { completionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"
	import {
		normalizeProbedModels,
		type ProbedModel
	} from "$lib/shared/connections/probedModels"

	interface Props {
		/** The SAVED connection's id — the only thing this panel is told. */
		connectionId: number
		/**
		 * What the last Test or Refresh Models answered, in whatever shape the
		 * backend produced.
		 *
		 * Passed in rather than fetched, because the editor OWNS the test: it is
		 * the one holding unsaved form state, and a second `connections:test`
		 * subscription down here would race the one up there. Normalized at the
		 * boundary — see `normalizeProbedModels` for why that is not each form's
		 * job any more.
		 *
		 * ⚠ A probed list is never persisted on arrival. Adding is a press.
		 */
		probed?: unknown[]
	}
	let { connectionId, probed = [] }: Props = $props()

	const socket = useTypedSocket()

	type ModelRow = NonNullable<
		Sockets.Connections.Models.Response["models"]
	>[number]

	let view = $state<Sockets.Connections.Models.Response | null>(null)
	let loading = $state(true)
	let busy = $state(false)
	/** Which row's detail panel is open. Null means none — one at a time. */
	let editingId = $state<number | null>(null)
	let adding = $state(false)
	let newModel = $state("")
	let newName = $state("")
	let notice = $state("")

	const rows = $derived(view?.models ?? [])

	/**
	 * Which probed entries are not on the endpoint yet.
	 *
	 * Shown as a count rather than a list: an OpenAI-compatible host answers with
	 * a hundred ids including embeddings and transcription endpoints, and a
	 * hundred rows of checkboxes in a sidebar panel is not a choice anybody makes
	 * — it is a wall. The person adds what they want by name, or takes the lot
	 * and switches off what they do not.
	 */
	const missing = $derived.by(() => {
		const have = new Set(rows.map((m) => m.model))
		return normalizeProbedModels(probed).filter((m) => !have.has(m.model))
	})

	/**
	 * The SAME list the endpoint's own format picker shows — from the table, not
	 * from the constant beside it. A model-level override that could only name
	 * the eight built-ins would be unable to select a template an admin wrote,
	 * which is the exact hole `completionTemplateOptions` exists to close.
	 */
	const formatOptions = completionTemplateOptions()

	function say(message: string) {
		notice = message
		setTimeout(() => (notice = ""), 4000)
	}

	function addManual() {
		const model = newModel.trim()
		if (!model) return
		busy = true
		socket.emit("connections:createModel", {
			id: connectionId,
			model: {
				model,
				...(newName.trim() ? { name: newName.trim() } : {})
			}
		})
		newModel = ""
		newName = ""
		adding = false
	}

	function addAllProbed(list: ProbedModel[]) {
		if (!list.length) return
		busy = true
		socket.emit("connections:importModels", {
			id: connectionId,
			models: list
		})
	}

	function patch(row: ModelRow, model: Record<string, unknown>) {
		busy = true
		socket.emit("connections:updateModel", {
			id: connectionId,
			modelId: row.id,
			model: model as any
		})
	}

	/**
	 * The response every one of the six events carries.
	 *
	 * `emitToUser` reaches every open tab for this user rather than only the one
	 * that asked, so the id guard is not optional — the same guard every other
	 * handler in the sidebar carries.
	 */
	const applyModels = (res: Sockets.Connections.Models.Response) => {
		if (res.connectionId !== connectionId) return
		loading = false
		busy = false
		if (res.error) return
		view = res
	}

	const applyImport = (res: Sockets.Connections.ImportModels.Response) => {
		if (res.connectionId !== connectionId) return
		applyModels(res)
		if (res.error) return
		// "added 3 of 40" is the sentence that says the other 37 were already
		// here rather than silently dropped.
		if (res.added != null)
			say(
				res.skipped
					? `Added ${res.added}, skipped ${res.skipped} already here.`
					: `Added ${res.added}.`
			)
	}

	const handleError = () => {
		// The :error events carry an error string and nothing else, so this
		// cannot tell whose failure it was. It stops the spinner and leaves the
		// last answer the server actually gave on screen; Layout's onAny
		// catch-all owns the toast.
		loading = false
		busy = false
	}

	const handleTest = (msg: Sockets.Connections.Test.Response) => {
		// A test can create nothing here, but it CAN move what is probed, and it
		// rewrites the endpoint's capability column that the per-model layer sits
		// over. Re-reading is the whole answer.
		if (msg.connectionId !== connectionId || !msg.ok) return
		socket.emit("connections:models", { id: connectionId })
	}

	onMount(() => {
		// Named references, off'd by name below. A bare
		// `socket.off("connections:test")` removes the FIRST-registered listener
		// — usually one of the nine connection forms' own — which has caused two
		// real bugs in this codebase already.
		socket.on("connections:models", applyModels)
		socket.on("connections:createModel", applyModels)
		socket.on("connections:updateModel", applyModels)
		socket.on("connections:setDefaultModel", applyModels)
		socket.on("connections:deleteModel", applyModels)
		socket.on("connections:importModels", applyImport)
		socket.on("connections:models:error", handleError)
		socket.on("connections:createModel:error", handleError)
		socket.on("connections:updateModel:error", handleError)
		socket.on("connections:setDefaultModel:error", handleError)
		socket.on("connections:deleteModel:error", handleError)
		socket.on("connections:importModels:error", handleError)
		socket.on("connections:test", handleTest)
		// Mount is the right moment because the sidebar keys this whole block on
		// `connection.id`, so a different selection is a different instance and
		// there is no stale-id window to guard.
		socket.emit("connections:models", { id: connectionId })
	})

	onDestroy(() => {
		socket.off("connections:models", applyModels)
		socket.off("connections:createModel", applyModels)
		socket.off("connections:updateModel", applyModels)
		socket.off("connections:setDefaultModel", applyModels)
		socket.off("connections:deleteModel", applyModels)
		socket.off("connections:importModels", applyImport)
		socket.off("connections:models:error", handleError)
		socket.off("connections:createModel:error", handleError)
		socket.off("connections:updateModel:error", handleError)
		socket.off("connections:setDefaultModel:error", handleError)
		socket.off("connections:deleteModel:error", handleError)
		socket.off("connections:importModels:error", handleError)
		socket.off("connections:test", handleTest)
	})
</script>

<div class="mt-4 flex flex-col gap-1">
	<span class="flex items-center gap-2 font-semibold">
		<Icons.Boxes size={14} aria-hidden="true" />
		Models
	</span>
	<p class="text-muted text-xs">
		The models reachable through this connection. Every picker in the app
		chooses a connection <em>and</em>
		 a model; the starred one is what a choice that names only this connection
		means.
	</p>

	{#if loading}
		<p class="text-muted text-xs">Loading…</p>
	{:else}
		{#if !rows.length}
			<p
				class="text-muted border-surface-200-700 rounded-lg border border-dashed px-2 py-3 text-xs"
			>
				No models yet. Add the one this connection should send, or test
				the connection and add what it reports.
			</p>
		{/if}

		<!-- The star is a radio GROUP: exactly one per endpoint, which is a
		     database constraint and not a convention. -->
		<fieldset class="flex flex-col gap-1">
			<legend class="sr-only">Models on this connection</legend>
			{#each rows as m (m.id)}
				<div
					class="border-surface-200-700 flex flex-col gap-1 rounded-lg border px-2 py-1"
				>
					<div class="flex items-center gap-2">
						<label
							class="flex shrink-0 items-center"
							title={m.isDefault
								? "This connection's default model"
								: "Make this the default model"}
						>
							<input
								type="radio"
								class="radio"
								name={`default-model-${connectionId}`}
								checked={m.isDefault}
								disabled={busy || !m.enabled}
								onchange={() => {
									busy = true
									socket.emit("connections:setDefaultModel", {
										id: connectionId,
										modelId: m.id
									})
								}}
							/>
							<span class="sr-only">
								Make {m.name} the default model
							</span>
						</label>
						<span
							class="min-w-0 flex-1 truncate text-sm {m.enabled
								? ''
								: 'opacity-50'}"
							title={m.model}
						>
							{m.name}
							{#if m.model !== m.name}
								<span class="text-muted text-xs">
									— {m.model}
								</span>
							{/if}
						</span>
						<label
							class="text-muted flex shrink-0 items-center gap-1 text-[10px]"
							title="Offer this model in pickers"
						>
							<input
								type="checkbox"
								class="checkbox"
								checked={m.enabled}
								disabled={busy}
								onchange={(e) =>
									patch(m, {
										enabled: e.currentTarget.checked
									})}
							/>
							on
						</label>
						<button
							type="button"
							class="btn-icon btn-icon-sm preset-tonal-surface shrink-0"
							title="Per-model settings"
							aria-expanded={editingId === m.id}
							onclick={() =>
								(editingId = editingId === m.id ? null : m.id)}
						>
							<Icons.Settings2 size={12} />
						</button>
						<button
							type="button"
							class="btn-icon btn-icon-sm preset-tonal-surface shrink-0"
							title="Remove this model (the connection is kept)"
							disabled={busy}
							onclick={() => {
								busy = true
								socket.emit("connections:deleteModel", {
									id: connectionId,
									modelId: m.id
								})
							}}
						>
							<Icons.X size={12} />
						</button>
					</div>

					{#if editingId === m.id}
						<!-- The OVERRIDES. Every one of them is blank by default
						     and blank means "whatever the connection says" — which
						     is what every row the 0114 upgrade created holds, and
						     what makes it behaviour-preserving. -->
						<div
							class="grid grid-cols-[7rem_1fr] items-center gap-x-2 gap-y-1 pt-1"
						>
							<span class="text-muted text-xs">Name</span>
							<input
								class="input text-xs"
								value={m.name}
								disabled={busy}
								onchange={(e) =>
									patch(m, { name: e.currentTarget.value })}
							/>

							<span class="text-muted text-xs">Sends</span>
							<input
								class="input text-xs"
								value={m.model}
								disabled={busy}
								onchange={(e) =>
									patch(m, { model: e.currentTarget.value })}
							/>

							<span class="text-muted text-xs">
								Context window
							</span>
							<input
								class="input text-xs"
								type="number"
								min="1"
								placeholder="From the sampling config"
								value={m.contextWindow ?? ""}
								disabled={busy}
								onchange={(e) =>
									patch(m, {
										contextWindow:
											e.currentTarget.value === ""
												? null
												: Number(e.currentTarget.value)
									})}
							/>

							<span class="text-muted text-xs">Template</span>
							<select
								class="select text-xs"
								value={m.promptFormat ?? ""}
								disabled={busy}
								onchange={(e) =>
									patch(m, {
										promptFormat:
											e.currentTarget.value || null
									})}
							>
								<option value="">From the connection</option>
								{#each formatOptions.value as t (t.value)}
									<option value={t.value}>{t.label}</option>
								{/each}
							</select>

							<span class="text-muted text-xs">Tokenizer</span>
							<select
								class="select text-xs"
								value={m.tokenCounter ?? ""}
								disabled={busy}
								onchange={(e) =>
									patch(m, {
										tokenCounter:
											e.currentTarget.value || null
									})}
							>
								<option value="">From the connection</option>
								{#each TokenCounterOptions.options as t (t.value)}
									<option value={t.value}>{t.label}</option>
								{/each}
							</select>
						</div>
					{/if}
				</div>
			{/each}
		</fieldset>

		<div class="mt-1 flex flex-wrap items-center gap-2">
			{#if adding}
				<input
					class="input min-w-0 flex-1 text-xs"
					placeholder="What the service calls it — e.g. llama3.1:8b"
					bind:value={newModel}
					onkeydown={(e) => e.key === "Enter" && addManual()}
				/>
				<input
					class="input min-w-0 flex-1 text-xs"
					placeholder="Display name (optional)"
					bind:value={newName}
					onkeydown={(e) => e.key === "Enter" && addManual()}
				/>
				<button
					type="button"
					class="btn btn-sm preset-filled-primary-500"
					disabled={busy || !newModel.trim()}
					onclick={addManual}
				>
					Add
				</button>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={() => {
						adding = false
						newModel = ""
						newName = ""
					}}
				>
					Cancel
				</button>
			{:else}
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					disabled={busy}
					onclick={() => (adding = true)}
				>
					<Icons.Plus size={12} />
					Add model
				</button>
				{#if missing.length}
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface"
						disabled={busy}
						title="Add every model the last test reported that is not already here"
						onclick={() => addAllProbed(missing)}
					>
						<Icons.DownloadCloud size={12} />
						Add {missing.length} from the last test
					</button>
				{/if}
			{/if}
		</div>

		{#if notice}
			<p class="text-muted text-xs" role="status">{notice}</p>
		{/if}
	{/if}
</div>
