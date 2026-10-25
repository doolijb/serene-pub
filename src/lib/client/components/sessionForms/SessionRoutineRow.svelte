<script lang="ts">
	/**
	 * 🚧 One routine in a session's settings (PLAN-layering R36, R37, R8;
	 * lane 7, 2026-10-21): its name, what it does, when it runs in words, what
	 * it is doing now (paused and why, what it needs, waiting), and its mode —
	 * **Off**, **Review** or **Full** — for anyone with the settings (R37).
	 * A routine the preset left switched Off stays here, so it can be turned
	 * on (R8).
	 *
	 * 🚧 A routine that runs after each turn or after each round (Story's
	 * reckoning) also offers **When it runs** — the one of the two — to anyone
	 * with the settings (R52, lane F1). An administrator also has the
	 * cadence's own options, **Allow stacking**, and on the real-time clock
	 * the two cron caps (R36), each a field of the derived form. A member
	 * never reads "cadence" here.
	 *
	 * The mode is a segmented control (STYLE-GUIDE §6.5: one value from a
	 * short fixed set): radio buttons in a track, the chosen one tonal
	 * primary, arrow keys moving the choice.
	 */
	import { cadenceWords, jumpCeilingWords } from "$lib/shared/routines/cadenceWords"
	import { eventDisplayName } from "$lib/client/utils/eventName"
	import SessionSettingField from "./SessionSettingField.svelte"
	import {
		adminFieldsOf,
		cadenceChoiceFieldOf,
		fieldDomId,
		modeFieldOf,
		ROUTINE_MODES,
		routineStatusLine
	} from "./sessionSettingsForm"

	type Routine = Sockets.Sessions.SettingsForm.Routine
	type Field = Sockets.Sessions.SettingsForm.Field

	interface Props {
		routine: Routine
		viewer: "owner" | "admin"
		/** How it stands now (`sessions:routines`): paused, needs, waiting. */
		status?: Sockets.Sessions.Routines.Routine
		busy: (field: Field) => boolean
		refusal: (field: Field) => string | null
		onwrite: (field: Field, value: unknown | null) => void
	}

	let { routine, viewer, status, busy, refusal, onwrite }: Props = $props()

	const modeField = $derived(modeFieldOf(routine))
	const cadenceField = $derived(cadenceChoiceFieldOf(routine))
	const extra = $derived(viewer === "admin" ? adminFieldsOf(routine) : [])
	const when = $derived(cadenceWords(routine.cadence, { eventName: eventDisplayName }))
	const ceiling = $derived(jumpCeilingWords(routine.cadence))
	const statusLine = $derived(routineStatusLine(status))
	const headingId = $derived(`routine-${fieldDomId({ id: routine.registrationKey }, "r")}`)
	const mode = $derived(routine.mode)

	function pick(key: "off" | "review" | "full") {
		if (!modeField || !modeField.editable || key === mode || busy(modeField)) return
		onwrite(modeField, key)
	}

	/** Arrow keys move the choice, as a radio group does. */
	function onTrackKey(e: KeyboardEvent) {
		const at = ROUTINE_MODES.findIndex((m) => m.key === mode)
		const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0
		if (!step) return
		e.preventDefault()
		const next = ROUTINE_MODES[(at + step + ROUTINE_MODES.length) % ROUTINE_MODES.length]!
		pick(next.key)
		const track = e.currentTarget as HTMLElement
		queueMicrotask(() => track.querySelector<HTMLElement>(`[data-mode="${next.key}"]`)?.focus())
	}
</script>

<div
	class="bg-surface-50-950 flex flex-col gap-2 rounded-base p-3"
	role="group"
	aria-labelledby={headingId}
	data-routine={routine.registrationKey}
	data-mode={mode}
>
	<div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
		<!-- 14rem before the track wraps under it: a narrow column (the dock)
		     keeps the words readable rather than squeezing them beside it. -->
		<div class="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
			<h4 id={headingId} class="text-sm font-medium">{routine.label}</h4>
			{#if routine.purpose}
				<p class="text-surface-600-400 text-chip">{routine.purpose}</p>
			{/if}
			<p class="text-surface-600-400 text-xs" data-testid="routine-when">
				When it runs: {when}{ceiling ? ` · ${ceiling}` : ""}
			</p>
			{#if statusLine}
				<p
					class="text-xs {status?.paused || status?.needs ? 'text-warning-700-300' : 'text-surface-600-400'}"
					data-testid="routine-status"
					role="status"
				>
					{statusLine}
				</p>
			{/if}
		</div>

		{#if modeField?.editable}
			<!-- Off · Review · Full (R37): one value from a short fixed set. -->
			<!-- svelte-ignore a11y_interactive_supports_focus -->
			<div
				class="bg-surface-100-900 flex shrink-0 gap-0.5 rounded-base p-0.5"
				role="radiogroup"
				aria-label="{routine.label}: mode"
				tabindex="-1"
				onkeydown={onTrackKey}
			>
				{#each ROUTINE_MODES as m (m.key)}
					{@const on = mode === m.key}
					<button
						type="button"
						role="radio"
						aria-checked={on}
						tabindex={on ? 0 : -1}
						title={m.hint}
						data-mode={m.key}
						class="min-h-11 rounded-lg px-3 text-chip pointer-fine:min-h-8 {on
							? 'preset-pressed font-medium'
							: 'hover:bg-surface-200-800'}"
						disabled={busy(modeField)}
						onclick={() => pick(m.key)}
					>
						{m.label}
					</button>
				{/each}
			</div>
		{:else if modeField}
			<p class="text-sm">{ROUTINE_MODES.find((m) => m.key === mode)?.label ?? mode}</p>
		{/if}
	</div>

	{#if modeField && !modeField.editable && modeField.readOnlyReason}
		<p class="text-surface-600-400 text-xs">{modeField.readOnlyReason}</p>
	{/if}
	{#if modeField && refusal(modeField)}
		<p class="text-error-600-400 text-xs" role="alert">{refusal(modeField)}</p>
	{/if}
	{#if modeField?.editable && modeField.source === "session"}
		<p class="text-surface-600-400 text-xs">
			Set for this session.
			<button
				type="button"
				class="anchor inline-flex min-h-11 items-center pointer-fine:min-h-0"
				disabled={busy(modeField)}
				onclick={() => onwrite(modeField!, null)}
			>
				Reset
			</button>
			to {ROUTINE_MODES.find((m) => m.key === modeField!.inherited)?.label ?? "the preset's"}.
		</p>
	{/if}

	{#if cadenceField}
		<!-- 🚧 R52: after each turn or after each round — anyone with the settings. -->
		<SessionSettingField
			field={cadenceField}
			{viewer}
			busy={busy(cadenceField)}
			refusal={refusal(cadenceField)}
			onwrite={(v) => onwrite(cadenceField!, v)}
		/>
	{/if}

	{#if extra.length}
		<!-- An administrator's (R36): the cadence's options, Allow stacking, the cron caps. -->
		<details class="group">
			<summary class="text-surface-600-400 min-h-11 cursor-pointer text-xs pointer-fine:min-h-0">
				Cadence · {routine.cadence.name} · {extra.length === 1 ? "1 setting" : `${extra.length} settings`}
			</summary>
			<div class="mt-2 flex flex-col gap-3">
				{#each extra as f (f.id)}
					<SessionSettingField
						field={f}
						{viewer}
						busy={busy(f)}
						refusal={refusal(f)}
						onwrite={(v) => onwrite(f, v)}
					/>
				{/each}
			</div>
		</details>
	{/if}
</div>
