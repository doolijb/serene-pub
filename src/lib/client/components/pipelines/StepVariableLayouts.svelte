<script lang="ts">
	/**
	 * The variable-layout row under a step's context template (variable
	 * layouts, W4; STYLE-GUIDE §6.17 provenance-line shape). Layouts are one
	 * choice per variable for the whole pub, so this row says so and points at
	 * where they are changed; the only per-step thing left is the ⏳ leftover
	 * picks stored before layouts moved, each read-only with its two ways out:
	 * *Remove this pick* and *Move into the template* (name the
	 * layouts in the template). Admin-only — the panel does not mount it
	 * otherwise.
	 */
	import {
		leftoverLineWords,
		ownerSlugProblem,
		variablesAtSeveralLevels
	} from "$lib/client/admin/sections/variable-layouts/variableLayoutWords"
	import type { LeftoverStepState } from "$lib/client/components/pipelines/leftoverPicks.svelte"

	type Step = Sockets.Pipelines.LeftoverPicks.Step
	type Pick = Sockets.Pipelines.LeftoverPicks.Pick

	interface Props {
		/** Where the pub's layouts are changed, opened on this step. */
		href: string
		/** The leftover steps attached to this template option. */
		steps: Step[]
		stateOf: (step: Step) => LeftoverStepState
		onclear: (step: Step, pick: Pick) => void
		onmove: (step: Step, ownerSlug?: string) => void
		/** The template has an open draft: Move rewrites the stored one. */
		templateUnsaved: boolean
	}
	let { href, steps, stateOf, onclear, onmove, templateUnsaved }: Props =
		$props()

	let owners = $state<Record<string, string>>({})
	let unsavedAsked = $state<Record<string, boolean>>({})
	/** Owner slug fields the person has typed in or pressed on: only then is a problem shown. */
	let ownerSeen = $state<Record<string, boolean>>({})
	const ownerProblemOf = (id: string) =>
		ownerSeen[id] ? ownerSlugProblem(owners[id] ?? "") : null
	function moveWithOwner(step: Step) {
		const id = idOf(step)
		ownerSeen[id] = true
		if (ownerSlugProblem(owners[id] ?? "")) return
		move(step, owners[id]!.trim())
	}
	/** Variables with picks at more than one level, across every step shown here. */
	const severalLevels = $derived(
		variablesAtSeveralLevels(steps.flatMap((s) => s.picks))
	)
	const idOf = (step: Step) => `${step.stepKey}\u0000${step.slot}`

	function move(step: Step, ownerSlug?: string) {
		const id = idOf(step)
		if (templateUnsaved) {
			unsavedAsked[id] = true
			return
		}
		unsavedAsked[id] = false
		if (stateOf(step).busy) return
		onmove(step, ownerSlug)
	}
</script>

<div class="mt-1 space-y-1" data-step-variable-layouts>
	<p class="text-surface-600-400 text-xs">
		Each variable is written out by its variable layout, shared by every
		pipeline.
		<a class="underline" {href}>Change layouts</a>
	</p>
	{#each steps as step, i (idOf(step))}
		{@const st = stateOf(step)}
		{@const id = idOf(step)}
		{@const ownerProblem = ownerProblemOf(id)}
		<!-- One key can be picked at two scopes (a genre and a preset). -->
		{#each step.picks as pick (`${pick.key}\u0000${JSON.stringify(pick.scope)}`)}
			<p
				class="text-surface-600-400 flex flex-wrap items-center gap-2 text-xs"
				data-leftover-pick
			>
				<span>
					{leftoverLineWords(pick, {
						stepHeading: step.stepHeading,
						levelNamed: severalLevels.has(pick.variableId)
					})}
				</span>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface pointer-coarse:min-h-11"
					onclick={() => onclear(step, pick)}
				>
					Remove this pick
				</button>
			</p>
		{/each}
		{#if step.canMoveIntoTemplate && step.picks.length}
			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface pointer-coarse:min-h-11"
					onclick={() => move(step)}
				>
					Move into the template
				</button>
			</div>
		{/if}
		{#if unsavedAsked[id] && templateUnsaved}
			<p role="alert" class="text-error-600-400 text-xs">
				Save or cancel your changes to the template first.
			</p>
		{/if}
		{#if st.refusal}
			<p role="alert" class="text-error-600-400 text-xs">
				{st.refusal}
			</p>
			{#if st.needsOwner}
				<div class="flex flex-wrap items-end gap-2">
					<label class="flex flex-col gap-1 text-xs font-medium">
						Owner slug
						<input
							type="text"
							class="input"
							placeholder="acme"
							value={owners[id] ?? ""}
							aria-invalid={ownerProblem ? "true" : undefined}
							aria-describedby={ownerProblem
								? `owner-slug-problem-${i}`
								: undefined}
							oninput={(e) => {
								owners[id] = e.currentTarget.value
								ownerSeen[id] = true
							}}
						/>
					</label>
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface pointer-coarse:min-h-11"
						onclick={() => moveWithOwner(step)}
					>
						Move into the template
					</button>
				</div>
				{#if ownerProblem}
					<p
						id="owner-slug-problem-{i}"
						class="text-error-600-400 text-xs"
					>
						{ownerProblem}
					</p>
				{/if}
			{/if}
		{/if}
		{#each st.kept as k (k.key)}
			<p role="status" class="text-surface-600-400 text-xs">{k.why}</p>
		{/each}
	{/each}
</div>
