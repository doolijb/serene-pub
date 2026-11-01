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
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"

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
	/** 🚧 "Update rules" (🚧 M0 L4): the owner's offer, read with the options. */
	let upgrade: { from: string; to: string; notes: string[] } | null = $state(null)
	let confirming = $state(false)
	let updating = $state(false)
	let updateError: string | null = $state(null)

	$effect(() => {
		const id = sessionId
		const release = declareInterest<"sessions:setRulesetSettings">(
			"sessions:setRulesetSettings",
			(res) => {
				if (res.sessionId !== id) return
				view = res.rulesOptions
				canEdit = res.canEdit
				upgrade = res.upgrade ?? null
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

	function confirmUpdate() {
		if (!upgrade || updating) return
		const id = sessionId
		const to = upgrade.to
		updating = true
		updateError = null
		const release = declareInterest<"sessions:convertRuleset">(
			"sessions:convertRuleset",
			(res) => {
				if (res.id !== id) return
				release()
				releaseConvert = null
				updating = false
				confirming = false
				if (res.error) {
					updateError = res.error
					return
				}
				upgrade = null
				socket.emit("sessions:setRulesetSettings", { sessionId: id })
			}
		)
		releaseConvert = release
		socket.emit("sessions:convertRuleset", { id, to })
	}

	let releaseConvert: (() => void) | null = null
	$effect(() => () => {
		releaseConvert?.()
		releaseConvert = null
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

{#if view && upgrade && canEdit}
	<section class={cardClass} aria-labelledby="session-rules-version">
		<h3 id="session-rules-version" class="mb-1 text-sm font-medium">Rules version</h3>
		<p class="text-surface-600-400 mb-3 text-xs">
			This session plays {view.rulesetName} v{upgrade.from}. Version {upgrade.to} is installed.
		</p>
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500"
			onclick={() => {
				updateError = null
				confirming = true
			}}
		>
			Update rules to v{upgrade.to}
		</button>
		{#if updateError}
			<p class="text-error-600-400 mt-2 text-xs" role="alert">{updateError}</p>
		{/if}
	</section>
	<Dialog
		open={confirming}
		role="alertdialog"
		closeOnInteractOutside={false}
		onOpenChange={(e) => {
			if (!e.open && !updating) confirming = false
		}}
	>
		<Portal>
			<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm" />
			<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
				<Dialog.Content class="card bg-surface-100-900 w-full max-w-md space-y-4 p-6 shadow-xl">
					<Dialog.Title class="[font-family:var(--typo-heading--font-family)] text-lg font-semibold">
						Update rules to v{upgrade.to}?
					</Dialog.Title>
					<Dialog.Description class="space-y-2 text-sm">
						{#each upgrade.notes as note, i (i)}
							<p>{note}</p>
						{:else}
							<p>These rules give no notes for this update.</p>
						{/each}
						<p class="text-surface-600-400 text-xs">
							Stats the new version renames, removes or adds change in this session now; everything else stays. Back undoes this.
						</p>
					</Dialog.Description>
					<div class="flex flex-wrap justify-end gap-2">
						<button
							type="button"
							class="btn preset-tonal-surface"
							disabled={updating}
							onclick={() => (confirming = false)}
						>
							Not now
						</button>
						<button
							type="button"
							class="btn preset-filled-primary-500"
							disabled={updating}
							onclick={confirmUpdate}
						>
							{updating ? "Updating…" : "Update rules"}
						</button>
					</div>
				</Dialog.Content>
			</Dialog.Positioner>
		</Portal>
	</Dialog>
{/if}

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
