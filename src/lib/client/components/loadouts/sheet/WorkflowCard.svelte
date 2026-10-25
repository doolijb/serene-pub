<script lang="ts">
	/**
	 * The loadout editor's **Workflow** card — drawn only when the pair's
	 * drawing sheet takes a template payload (ComfyUI). The workflow picker
	 * (`WorkflowPicker`), the sheet sentence, and the workflow's **dials**
	 * inline: each says *Default 20* or *Set here · default 20*, and a dial
	 * set here offers *Use default*. Values land in the draft's
	 * `workflowValues` (saved as the loadout's `workflow_values`).
	 */
	import * as Icons from "@lucide/svelte"
	import WorkflowPicker from "$lib/client/components/connections/comfy/WorkflowPicker.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import {
		NO_DIALS_SENTENCE,
		PICK_WORKFLOW_SENTENCE,
		VERBS,
		type DialRow
	} from "../loadoutSheet"

	interface Props {
		workflowId: number | null
		connectionId: number | null
		/** The chosen workflow's sheet sentence, once known. */
		sentence: string | null
		/** Null while the workflow's variables load. */
		dials: DialRow[] | null
		disabled?: boolean
		onWorkflow: (id: number | null) => void
		onDial: (row: DialRow, value: unknown) => void
	}
	let {
		workflowId,
		connectionId,
		sentence,
		dials,
		disabled = false,
		onWorkflow,
		onDial
	}: Props = $props()

	const uid = $props.id()
</script>

<section class="panel-card flex flex-col gap-3" aria-labelledby="{uid}-h">
	<div class="flex items-center gap-2">
		<Icons.Workflow
			size={16}
			class="text-surface-600-400"
			aria-hidden="true"
		/>
		<h3 id="{uid}-h" class="flex-1 text-sm font-medium">Workflow</h3>
	</div>

	<WorkflowPicker
		value={workflowId}
		{connectionId}
		allowNone
		labelHidden
		label="Workflow"
		onChange={onWorkflow}
	/>

	{#if workflowId == null}
		<p class="text-surface-600-400 text-sm">{PICK_WORKFLOW_SENTENCE}</p>
	{:else}
		{#if sentence}
			<p class="text-surface-700-300 text-sm leading-relaxed">
				{sentence}
			</p>
		{/if}
		{#if dials == null}
			<p class="text-surface-600-400 text-xs" role="status">
				Reading the dials…
			</p>
		{:else if !dials.length}
			<p class="text-surface-600-400 text-sm">{NO_DIALS_SENTENCE}</p>
		{:else}
			<fieldset
				class="panel-inset flex flex-col gap-0 rounded-base"
				{disabled}
			>
				<legend class="sr-only">Dials</legend>
				<div
					class="grid grid-cols-1 gap-x-4 gap-y-3 p-3 @lg/editor:grid-cols-2"
				>
					{#each dials as dial (dial.name)}
						{@const id = `${uid}-dial-${dial.name}`}
						<div class="flex min-w-0 flex-col gap-1">
							{#if dial.type === "boolean"}
								<label
									class="flex min-h-10 items-center gap-2 text-sm"
									for={id}
								>
									<input
										{id}
										type="checkbox"
										role="switch"
										class="checkbox"
										checked={!!dial.value}
										onchange={(e) =>
											onDial(
												dial,
												(
													e.currentTarget as HTMLInputElement
												).checked
											)}
									/>
									<span class="truncate">{dial.label}</span>
								</label>
							{:else if dial.type === "enum"}
								<Select
									label={dial.label}
									options={(dial.options ?? []).map((o) => ({
										value: o,
										label: o
									}))}
									value={dial.value == null
										? null
										: String(dial.value)}
									onValueChange={(v) => onDial(dial, v)}
								/>
							{:else}
								<label class="text-xs" for={id}>
									{dial.label}
								</label>
								<input
									{id}
									class="input h-10 text-sm {dial.setHere
										? ''
										: 'text-surface-600-400'}"
									type={dial.type === "string"
										? "text"
										: "number"}
									min={dial.min}
									max={dial.max}
									step={dial.step ??
										(dial.type === "integer" ? 1 : "any")}
									value={dial.value ?? ""}
									aria-describedby="{id}-note"
									onchange={(e) =>
										onDial(
											dial,
											(
												e.currentTarget as HTMLInputElement
											).value
										)}
								/>
							{/if}
							<p
								id="{id}-note"
								class="flex items-center gap-1.5 text-xs"
							>
								{#if dial.setHere}
									<span
										class="bg-primary-500 size-1.5 shrink-0 rounded-full"
										aria-hidden="true"
									></span>
								{/if}
								<span
									class="text-surface-600-400 min-w-0 flex-1 truncate"
								>
									{dial.note}
								</span>
								{#if dial.setHere}
									<button
										type="button"
										class="text-surface-600-400 hover:text-surface-950-50 shrink-0 underline-offset-2 hover:underline pointer-coarse:min-h-11"
										aria-label="{VERBS.resetDial} for {dial.label}"
										onclick={() =>
											onDial(dial, dial.defaultValue)}
									>
										{VERBS.resetDial}
									</button>
								{/if}
							</p>
						</div>
					{/each}
				</div>
			</fieldset>
		{/if}
	{/if}
</section>
