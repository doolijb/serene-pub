<script lang="ts">
	/**
	 * 🚧 **Rules options** — a session's choices for its rules' options
	 * (PLAN-rulesets §8, W3-A 2026-10-16; NOMENCLATURE §28: the SDK nouns
	 * never show). Each option is a choice; the rules' presets are a one-click
	 * row that sets them all. Read and changed through
	 * `sessions:setRulesetSettings`; a change applies at once (no Save), and
	 * only the session's owner may make one. Hidden when the session's rules
	 * offer no options (Story offers none).
	 */
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"

	let {
		sessionId,
		cardClass,
		fieldClass
	}: { sessionId: number; cardClass: string; fieldClass: string } = $props()

	const socket = useTypedSocket()
	let view: Sockets.Sessions.SetRulesetSettings.RulesOptions | null = $state(null)
	let canEdit = $state(false)
	let error: string | null = $state(null)
	let saving = $state(false)

	$effect(() => {
		const id = sessionId
		const release = declareInterest<"sessions:setRulesetSettings">(
			"sessions:setRulesetSettings",
			(res) => {
				if (res.sessionId !== id) return
				view = res.rulesOptions
				canEdit = res.canEdit
				saving = false
				error = null
			}
		)
		const releaseError = declareInterest<"sessions:setRulesetSettings:error">(
			"sessions:setRulesetSettings:error",
			(res) => {
				if (res.sessionId !== undefined && res.sessionId !== id) return
				saving = false
				error = res.error
			}
		)
		socket.emit("sessions:setRulesetSettings", { sessionId: id })
		return () => {
			release()
			releaseError()
		}
	})

	function choose(optionId: string, choiceId: string) {
		if (!canEdit || !view) return
		saving = true
		socket.emit("sessions:setRulesetSettings", {
			sessionId,
			rulesetId: view.rulesetId,
			values: { [optionId]: choiceId }
		})
	}

	function applyPreset(presetId: string) {
		if (!canEdit || !view) return
		saving = true
		socket.emit("sessions:setRulesetSettings", {
			sessionId,
			rulesetId: view.rulesetId,
			preset: presetId
		})
	}

	const chosen = (o: Sockets.Sessions.SetRulesetSettings.Option) =>
		o.choices.find((c) => c.id === o.value)
</script>

{#if view?.installed && view.options.length}
	<section class={cardClass} aria-labelledby="session-rules-options">
		<h3 id="session-rules-options" class="mb-1 text-sm font-medium">
			Rules options
		</h3>
		<p class="text-surface-600-400 mb-3 text-xs">
			How {view.rulesetName}'s rules play in this session. Changes apply
			from the next turn{canEdit ? "" : "; only the session's owner can change them"}.
		</p>

		{#if view.presets.length}
			<div class="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Presets">
				<span class="text-surface-600-400 text-xs">Use a preset:</span>
				{#each view.presets as preset (preset.id)}
					<button
						type="button"
						class="btn btn-sm {view.preset === preset.id
							? 'preset-pressed'
							: 'preset-tonal'}"
						aria-pressed={view.preset === preset.id}
						title={preset.description}
						disabled={!canEdit || saving}
						onclick={() => applyPreset(preset.id)}
					>
						{preset.label}
					</button>
				{/each}
				{#if !view.preset}
					<span class="text-surface-600-400 text-xs">Custom</span>
				{/if}
			</div>
		{/if}

		<div class="flex flex-col gap-3">
			{#each view.options as option (option.id)}
				<div>
					<label
						class="mb-1 block text-xs font-medium"
						for="rules-option-{option.id}"
					>
						{option.label}
					</label>
					<select
						id="rules-option-{option.id}"
						class={fieldClass}
						value={option.value}
						disabled={!canEdit || saving}
						onchange={(e) => choose(option.id, e.currentTarget.value)}
					>
						{#each option.choices as choice (choice.id)}
							<option value={choice.id}>
								{choice.label}{choice.id === option.default ? " (default)" : ""}
							</option>
						{/each}
					</select>
					{#if chosen(option)?.description}
						<p class="text-surface-600-400 mt-1 text-xs">
							{chosen(option)?.description}
						</p>
					{/if}
				</div>
			{/each}
		</div>

		{#if error}
			<p class="text-error-600-400 mt-2 text-xs" role="alert">{error}</p>
		{/if}
	</section>
{/if}
