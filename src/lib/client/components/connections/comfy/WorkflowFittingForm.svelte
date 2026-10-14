<script lang="ts">
	/**
	 * 🚧 The **fitting form** (DESIGN-image-generation §4.8 step 3): a
	 * person's own ComfyUI export, walked by the server (`workflows:fit`), shown
	 * as a table of holes to confirm — which input the prompt, the seed, the
	 * size, the model… land on, which other literals stay literal and which
	 * become variables, and which output node carries the mark. Save rewrites
	 * the graph with the same `applyFit` the starters use and saves it.
	 *
	 * The UI-format refusal is the server's sentence, verbatim (`graph.ts`).
	 * The model is all `fitting.ts`; this is its markup.
	 */
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { workflowsApi } from "./workflowsApi"
	import {
		assignStandard,
		candidatesFor,
		draftFromProposal,
		draftProblems,
		editedProposal,
		enumIdOf,
		inputLabel,
		markerHoles,
		markOutput,
		nameProblem,
		otherLiterals,
		parseDefault,
		setPromoted,
		standardRows,
		withDraftDefaults,
		type FitDraft
	} from "./fitting"

	interface Props {
		/** The pasted or uploaded export, as text. */
		content: string
		/** A ComfyUI whose cached lists type the selects. */
		connectionId?: number | null
		/** Replace this workflow's document instead of creating one (the editor's re-fit). */
		replaceId?: number | null
		initialName?: string
		initialDescription?: string | null
		onSaved: (row: Sockets.Workflows.Row) => void
		onCancel?: () => void
	}

	let {
		content,
		connectionId = null,
		replaceId = null,
		initialName = "",
		initialDescription = "",
		onSaved,
		onCancel
	}: Props = $props()

	const api = workflowsApi(useTypedSocket())

	let loading = $state(true)
	let refusal = $state<string | null>(null)
	let draft = $state<FitDraft | null>(null)
	let enums = $state<Record<string, string[]>>({})
	let name = $state("")
	let description = $state("")
	let saving = $state(false)
	let saveError = $state<string | null>(null)

	$effect(() => {
		name = initialName
		description = initialDescription ?? ""
	})

	$effect(() => {
		const text = content
		loading = true
		refusal = null
		draft = null
		api.fit({ content: text, ...(connectionId != null ? { connectionId } : {}) })
			.then((res) => {
				if (text !== content) return
				// A file the walk cannot read comes back with one warning and
				// no `applied`: that warning IS the refusal, word for word.
				if (!res.applied) refusal = res.proposal.warnings[0] ?? "That file could not be read."
				else {
					draft = draftFromProposal(res.proposal)
					enums = res.enums ?? {}
				}
			})
			.catch((e) => (refusal = e instanceof Error ? e.message : String(e)))
			.finally(() => (loading = false))
	})

	const rows = $derived(draft ? standardRows(draft) : [])
	const others = $derived(draft ? otherLiterals(draft) : [])
	const markers = $derived(draft ? markerHoles(draft) : [])
	const problems = $derived(draft ? draftProblems(draft) : [])
	const NONE = "__none__"

	async function save() {
		if (!draft || problems.length || !name.trim()) return
		saving = true
		saveError = null
		try {
			const { proposal, chosen } = editedProposal(draft)
			const res = await api.fit({
				content,
				...(connectionId != null ? { connectionId } : {}),
				proposal,
				chosen
			})
			if (!res.applied) throw new Error(res.proposal.warnings[0] ?? "That file could not be read.")
			const input = {
				name: name.trim(),
				description: description.trim() || null,
				dialect: "comfyui",
				document: res.applied.document,
				variables: withDraftDefaults(res.applied.variables, draft),
				outputNode: res.applied.outputNode
			}
			const row =
				replaceId != null
					? await api.update(replaceId, input)
					: await api.create(input)
			onSaved(row)
		} catch (e) {
			saveError = e instanceof Error ? e.message : String(e)
		} finally {
			saving = false
		}
	}
</script>

<div class="flex flex-col gap-4" data-fitting-form>
	{#if loading}
		<p class="text-surface-600-400 text-sm">Reading the workflow…</p>
	{:else if refusal}
		<p class="text-error-600-400 text-sm" role="alert" data-fit-refusal>
			{refusal}
		</p>
		{#if onCancel}
			<div class="flex justify-end">
				<button type="button" class="btn preset-tonal-surface" onclick={onCancel}>
					Back
				</button>
			</div>
		{/if}
	{:else if draft}
		<div class="grid gap-3 sm:grid-cols-2">
			<label class="flex flex-col gap-1 text-sm">
				<span class="font-semibold">Name</span>
				<input class="input" type="text" bind:value={name} autocomplete="off" />
			</label>
			<label class="flex flex-col gap-1 text-sm">
				<span class="font-semibold">Description</span>
				<input class="input" type="text" bind:value={description} autocomplete="off" />
			</label>
		</div>

		{#if draft.warnings.length}
			<ul class="text-warning-700-300 flex flex-col gap-1 text-xs">
				{#each draft.warnings as w (w)}
					<li class="flex items-start gap-1">
						<Icons.TriangleAlert size={12} class="mt-0.5 shrink-0" aria-hidden="true" />
						{w}
					</li>
				{/each}
			</ul>
		{/if}

		<section class="flex flex-col gap-2" aria-labelledby="fit-holes-title">
			<h3 id="fit-holes-title" class="text-sm font-semibold">
				What Serene Pub fills in
			</h3>
			<p class="text-surface-600-400 text-xs">
				Each row is something a run sends. Check where it lands, or choose
				<em>Not used</em> to leave the workflow's own value.
			</p>
			<div class="flex flex-col divide-y divide-surface-200-800" role="table" aria-label="Holes">
				{#each rows as row (row.variable)}
					<div
						class="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[10rem_1fr] sm:items-center"
						role="row"
						data-hole-row={row.variable}
					>
						<div role="rowheader" class="text-sm font-medium" title={row.help}>
							{row.label}
						</div>
						<div role="cell" class="min-w-0">
							<Select
								label="Where {row.label} lands"
								labelHidden
								class="w-full"
								options={[
									{ value: NONE, label: "Not used" },
									...candidatesFor(draft, row.variable).map((h) => ({
										value: h.address,
										label: inputLabel(h)
									}))
								]}
								value={row.landings[0]?.address ?? NONE}
								onValueChange={(v) =>
									draft && assignStandard(draft, row.variable, v === NONE ? null : v)}
							/>
							{#if row.landings.length > 1}
								<p class="text-surface-600-400 mt-1 text-xs">
									Also on {row.landings
										.slice(1)
										.map((h) => `node ${h.nodeId}`)
										.join(", ")}.
								</p>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</section>

		{#if markers.length}
			<section class="flex flex-col gap-1" aria-labelledby="fit-markers-title">
				<h3 id="fit-markers-title" class="text-sm font-semibold">
					Declared in the workflow
				</h3>
				<ul class="text-sm">
					{#each markers as h (h.address)}
						<li data-marker={h.variable}>
							<strong>{h.label ?? h.variable}</strong>
							<span class="text-surface-600-400 text-xs">
								· {h.variable} · default {String(h.literal)}
							</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if others.length}
			<section class="flex flex-col gap-2" aria-labelledby="fit-others-title">
				<h3 id="fit-others-title" class="text-sm font-semibold">Other values</h3>
				<p class="text-surface-600-400 text-xs">
					Everything else the workflow fixes. Keep a value as it is, or
					promote it to a variable you can change in this editor or on a loadout.
				</p>
				<div class="flex flex-col divide-y divide-surface-200-800">
					{#each others as h (h.address)}
						{@const options = enums[enumIdOf(h.enumSource) ?? ""]}
						{@const problem = h.chosen ? nameProblem(draft, h) : null}
						<div class="flex flex-col gap-2 py-2" data-literal={h.address}>
							<div class="flex flex-wrap items-center gap-2">
								<span class="min-w-0 flex-1 truncate text-sm" title={h.reason}>
									{inputLabel(h)}
								</span>
								<div class="flex gap-1" role="radiogroup" aria-label="{inputLabel(h)}">
									<button
										type="button"
										role="radio"
										aria-checked={!h.chosen}
										class="btn btn-sm {h.chosen ? 'preset-tonal-surface' : 'preset-filled-surface-500'}"
										onclick={() => draft && setPromoted(draft, h.address, false)}
									>
										Keep literal
									</button>
									<button
										type="button"
										role="radio"
										aria-checked={h.chosen}
										class="btn btn-sm {h.chosen ? 'preset-filled-primary-500' : 'preset-tonal-surface'}"
										onclick={() => draft && setPromoted(draft, h.address, true)}
									>
										Promote to variable
									</button>
								</div>
							</div>
							{#if h.chosen}
								<div class="grid gap-2 sm:grid-cols-2">
									<label class="flex flex-col gap-1 text-xs">
										<span class="font-medium">Variable name</span>
										<input
											class="input"
											type="text"
											bind:value={h.variable}
											aria-invalid={!!problem}
										/>
									</label>
									{#if options?.length}
										<Select
											label="Default"
											class="w-full"
											options={options.map((o) => ({ value: o, label: o }))}
											value={String(h.defaultValue ?? "")}
											onValueChange={(v) => (h.defaultValue = v)}
										/>
									{:else}
										<label class="flex flex-col gap-1 text-xs">
											<span class="font-medium">Default</span>
											<input
												class="input"
												type="text"
												value={String(h.defaultValue ?? "")}
												onchange={(e) =>
													(h.defaultValue = parseDefault(e.currentTarget.value, h.literal))}
											/>
										</label>
									{/if}
								</div>
								{#if problem}
									<p class="text-error-600-400 text-xs" role="alert">{problem}</p>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<section class="flex flex-col gap-1" aria-labelledby="fit-output-title">
			<h3 id="fit-output-title" class="text-sm font-semibold">Output</h3>
			{#if draft.outputs.length}
				<Select
					label="The picture the run keeps"
					class="w-full"
					options={draft.outputs.map((o) => ({
						value: o.nodeId,
						label: `Node ${o.nodeId} · ${o.classType}`
					}))}
					value={draft.outputNode ?? ""}
					onValueChange={(v) => draft && markOutput(draft, v)}
				/>
			{:else}
				<p class="text-warning-700-300 text-xs">
					This workflow has no SaveImage node. Add one in ComfyUI and export again.
				</p>
			{/if}
		</section>

		{#if problems.length}
			<ul class="text-error-600-400 text-xs" data-fit-problems>
				{#each problems as p (p)}<li>{p}</li>{/each}
			</ul>
		{/if}
		{#if saveError}
			<p class="text-error-600-400 text-sm" role="alert">{saveError}</p>
		{/if}

		<div class="flex justify-end gap-2">
			{#if onCancel}
				<button type="button" class="btn preset-tonal-surface" onclick={onCancel}>
					Cancel
				</button>
			{/if}
			<button
				type="button"
				class="btn preset-filled-primary-500"
				disabled={saving || !!problems.length || !name.trim()}
				onclick={save}
			>
				{replaceId != null ? "Save changes" : "Save workflow"}
			</button>
		</div>
	{/if}
</div>
