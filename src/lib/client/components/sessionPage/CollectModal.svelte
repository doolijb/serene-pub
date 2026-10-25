<script lang="ts">
	/**
	 * The **collect modal** (lair pass R3, owner 2026-09-28): what an action
	 * asks for before it fires — its `collects` — typed or picked here, never
	 * read off the composer. Every press of a collecting action opens it, from
	 * any venue; S2's slash argument prefills `initialText`.
	 *
	 * Title = the action's name, its description under it; the recipients
	 * (the session's enabled cast) when declared; the text box when declared
	 * — Enter submits, Shift+Enter makes a new line — with the `ifEmpty`
	 * sentence under an optional one. Submit wears the action's name and
	 * greys until what is required is there; Cancel sends nothing. Skeleton
	 * `Dialog` in a `Portal`, the STYLE-GUIDE §6.6 modal.
	 *
	 * **Who will and won't hear it** (lair re-plan R10, owner ruling 5): under
	 * the recipients, a live sentence names who is picked, who is not, and
	 * the pipeline's own voice (`ownVoice` — the Lair's Castellan), which is
	 * never a recipient. Each member shows what the action's overwritten slot
	 * holds for them now (`holds`), so a replace is visible before it happens.
	 *
	 * 🚧 **The clock step** (live scenes §6): an action declaring
	 * `collects.clockStep` (*Time passes…*) asks how much time passes — a
	 * whole number, a unit (minutes … years) and *Forward* or *Back* — the
	 * same stepper the session settings' story clock steps with. It opens at
	 * the declaration's default, going forward.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import {
		CLOCK_STEP_LIMIT,
		CLOCK_STEP_UNITS,
		clockStepProblem,
		collectReady,
		reachSentence,
		type Collected,
		type CollectMember,
		type ListedCollects
	} from "./collects"

	interface Props {
		open: boolean
		/** The pressed action, as listed. */
		action: { name: string; description?: string; collects: ListedCollects } | null
		/**
		 * Who may be picked: the session's enabled cast members, `character:<id>`,
		 * each with what the overwritten slot holds for them now, if anything.
		 */
		cast?: CollectMember[]
		/** The pipeline's own voice (the Lair's Castellan): named in the reach sentence as never hearing it. */
		ownVoice?: string
		/** Text to open with — S2's slash argument. */
		initialText?: string
		onSubmit: (collected: Collected) => void
		onCancel: () => void
	}

	let { open, action, cast = [], ownVoice, initialText = "", onSubmit, onCancel }: Props = $props()

	let text = $state("")
	let picked = $state<string[]>([])
	let field: HTMLTextAreaElement | null = $state(null)
	/** The stepper: how many (a number input's value; null while empty), of what, which way. */
	let stepBy = $state<number | null>(1)
	let stepUnit = $state<string>("hours")
	let stepBack = $state(false)
	let amountField: HTMLInputElement | null = $state(null)

	// A fresh ask starts from the argument, or empty, with nobody picked —
	// and the stepper at the action's default, going forward.
	$effect(() => {
		if (open) {
			text = initialText
			picked = []
			const d = action?.collects?.clockStep?.default
			stepBy = d?.by ?? 1
			stepUnit = d?.unit ?? "hours"
			stepBack = false
		}
	})

	const collects = $derived(action?.collects)
	const clockStep = $derived(
		collects?.clockStep && typeof stepBy === "number" && Number.isFinite(stepBy)
			? { by: stepBack ? -stepBy : stepBy, unit: stepUnit }
			: undefined
	)
	const stepNote = $derived(
		collects?.clockStep
			? clockStep && stepBy !== null && stepBy > 0
				? clockStepProblem(clockStep)
				: "Pass a whole number of units, at least one."
			: null
	)
	const got = $derived<Collected>({
		text,
		recipients: picked,
		...(clockStep && stepBy !== null && stepBy > 0 ? { clockStep } : {})
	})
	const ready = $derived(!!collects && collectReady(collects, got))
	const reach = $derived(reachSentence(cast, picked, ownVoice))
	/**
	 * 🚧 Whether the recipients HEAR something — the action writes a slot
	 * on each (`overwrites`, the Lair's Whisper): only then is "who will and
	 * won't hear it" the right sentence. The Lair's Roll picks who rolls,
	 * and nobody hears anything (L5, 2026-10-21).
	 */
	const hears = $derived(!!collects?.recipients?.overwrites)
	const uid = $props.id()

	function submit() {
		if (!ready) return
		onSubmit({
			text,
			recipients: [...picked],
			...(got.clockStep ? { clockStep: { ...got.clockStep } } : {})
		})
	}

	function toggle(ref: string, on: boolean) {
		picked = on ? [...picked.filter((r) => r !== ref), ref] : picked.filter((r) => r !== ref)
	}
</script>

<Dialog
	{open}
	onOpenChange={(e: OpenChangeDetails) => {
		if (!e.open) onCancel()
	}}
	initialFocusEl={() => field ?? amountField}
>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-md space-y-4 p-6 shadow-xl"
				data-collect-modal
			>
				{#if action && collects}
					<Dialog.Title class="h4">{action.name}</Dialog.Title>
					{#if action.description}
						<Dialog.Description class="text-surface-700-300 text-sm">
							{action.description}
						</Dialog.Description>
					{/if}
					<form
						class="space-y-4"
						onsubmit={(e) => {
							e.preventDefault()
							submit()
						}}
					>
						{#if collects.recipients}
							<fieldset class="space-y-2" data-collect-recipients>
								<legend class="text-sm font-medium">{collects.recipients.label}</legend>
								{#each cast as member (member.ref)}
									<label class="flex items-start gap-2 text-sm">
										<input
											type="checkbox"
											class="checkbox mt-0.5"
											value={member.ref}
											checked={picked.includes(member.ref)}
											onchange={(e) => toggle(member.ref, e.currentTarget.checked)}
										/>
										<span class="min-w-0">
											<span class="block">{member.name}</span>
											{#if member.holds}
												<span
													class="text-surface-600-400 block text-xs break-words"
													data-collect-holds={member.ref}
												>
													{picked.includes(member.ref) ? "Replaces" : "Now"}: “{member.holds}”
												</span>
											{/if}
										</span>
									</label>
								{:else}
									<p class="text-surface-600-400 text-sm">Nobody in the cast is enabled.</p>
								{/each}
								{#if cast.length && hears}
									<p class="text-sm" aria-live="polite" data-collect-reach>
										{#each reach as run, i (i)}{#if run.name}<strong>{run.text}</strong>{:else}{run.text}{/if}{/each}
									</p>
								{/if}
							</fieldset>
						{/if}
						{#if collects.clockStep}
							<fieldset class="space-y-2" data-collect-clock-step>
								<legend class="text-sm font-medium">{collects.clockStep.label}</legend>
								<div class="flex flex-wrap items-end gap-2">
									<label class="flex flex-col gap-1 text-xs">
										<span class="text-surface-600-400">How many</span>
										<input
											bind:this={amountField}
											class="input w-24 rounded-base"
											type="number"
											min="1"
											max={CLOCK_STEP_LIMIT}
											step="1"
											bind:value={stepBy}
											aria-describedby="{uid}-step-note"
											data-collect-step-by
											onkeydown={(e) => {
												if (e.key === "Enter" && !e.isComposing) {
													e.preventDefault()
													submit()
												}
											}}
										/>
									</label>
									<Select
										label="Unit"
										class="w-32"
										options={CLOCK_STEP_UNITS.map((u) => ({ value: u.unit, label: u.label }))}
										value={stepUnit}
										onValueChange={(v) => {
											if (v) stepUnit = v
										}}
									/>
									<div
										class="flex gap-1"
										role="group"
										aria-label="Which way"
										data-collect-step-direction
									>
										<button
											type="button"
											class="btn btn-sm {stepBack ? 'preset-tonal-surface' : 'preset-pressed'}"
											aria-pressed={!stepBack}
											onclick={() => (stepBack = false)}
										>
											Forward
										</button>
										<button
											type="button"
											class="btn btn-sm {stepBack ? 'preset-pressed' : 'preset-tonal-surface'}"
											aria-pressed={stepBack}
											onclick={() => (stepBack = true)}
										>
											Back
										</button>
									</div>
								</div>
								<p
									id="{uid}-step-note"
									class="text-xs {stepNote ? 'text-error-600-400' : 'text-surface-600-400'}"
									aria-live="polite"
								>
									{stepNote ?? "Moves this session's story clock, never the lorebook's."}
								</p>
							</fieldset>
						{/if}
						{#if collects.text}
							<div class="space-y-1">
								<label for="{uid}-text" class="text-sm font-medium">{collects.text.label}</label>
								<textarea
									id="{uid}-text"
									bind:this={field}
									bind:value={text}
									class="textarea w-full"
									rows="3"
									placeholder={collects.text.placeholder}
									aria-required={collects.text.need === "required"}
									aria-describedby={collects.text.ifEmpty ? `${uid}-if-empty` : undefined}
									data-collect-text
									onkeydown={(e) => {
										if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
											e.preventDefault()
											submit()
										}
									}}
								></textarea>
								{#if collects.text.need === "optional" && collects.text.ifEmpty}
									<p id="{uid}-if-empty" class="text-surface-600-400 text-xs" data-collect-if-empty>
										Left empty: {collects.text.ifEmpty}
									</p>
								{/if}
							</div>
						{/if}
						<footer class="flex justify-end gap-2">
							<button type="button" class="btn preset-tonal" onclick={onCancel}>Cancel</button>
							<button
								type="submit"
								class="btn preset-filled-primary-500"
								disabled={!ready}
								data-collect-submit
							>
								{action.name}
							</button>
						</footer>
					</form>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
