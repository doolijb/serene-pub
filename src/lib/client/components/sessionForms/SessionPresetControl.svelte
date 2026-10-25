<!--
	🚧 The session's **preset** in its settings (PLAN-genre-restructure §3-5,
	§5-3, ruled 2026-10-19): which of its genre's presets it runs, or
	**Custom** once a choice the preset pins (Chat's tools) differs from the
	preset's. Picking a preset — or **Back to** the
	session's own — applies at once and clears those choices, so the preset's
	pins apply again. Shown only when the genre offers more than one preset.
-->
<script lang="ts">
	import { requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"

	type PresetRow = Sockets.SessionAdmin.PresetRow

	interface Props {
		sessionId: number
		genreId: string
		presetId: number | null
		/** The form's genre fields, as edited (unsaved choices count). */
		fields: Record<string, unknown>
		presets: PresetRow[]
		disabled?: boolean
		/** After a switch: the form drops its own copies of the pinned choices. */
		onapplied: (presetId: number) => void
	}
	let { sessionId, genreId, presetId, fields, presets, disabled = false, onapplied }: Props = $props()

	const options = $derived(presets.filter((p) => p.genreId === genreId && p.enabled && !(p as any).withdrawnAt))
	const current = $derived(options.find((p) => p.id === presetId) ?? null)

	/** Does anything the preset pins differ from what the session holds? */
	const custom = $derived.by(() => {
		if (!current) return presetId == null
		const pins = (current.settings ?? {}) as Record<string, unknown>
		if (fields.tools !== undefined && pins.tools !== undefined) {
			const a = [...((fields.tools as string[]) ?? [])].sort().join(",")
			const b = [...((pins.tools as string[]) ?? [])].sort().join(",")
			if (a !== b) return true
		}
		return false
	})

	let busy = $state(false)
	function apply(id: number) {
		if (disabled || busy) return
		busy = true
		const release = requestWithInterest("sessions:setSessionPreset", { sessionId, presetId: id }, (res) => {
			release()
			busy = false
			if (res.error) {
				toaster.error({ title: "Preset", description: res.error })
				return
			}
			onapplied(id)
		})
	}

	/** What a turn costs, derived from what the preset registers (lane 5b), ⏳ else its stored number. */
	const cost = (p: PresetRow) => {
		const n = p.derived?.callsPerTurn ?? p.callsPerTurn
		return typeof n === "number" ? (n === 1 ? "1 call per turn" : `${n} calls per turn`) : ""
	}
</script>

{#if options.length > 1}
	<div class="mb-4 flex flex-col gap-2" data-testid="session-preset-control">
		<div class="flex flex-wrap items-baseline justify-between gap-2">
			<span class="text-sm font-medium" id="session-preset-heading">Preset · Applies at once</span>
			{#if custom}
				<span class="text-surface-600-400 text-xs" data-testid="session-preset-custom">
					Custom
					{#if current}
						·
						<button type="button" class="anchor" onclick={() => apply(current.id)} {disabled}>Back to {current.name}</button>
					{/if}
				</span>
			{/if}
		</div>
		<div class="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="session-preset-heading">
			{#each options as p (p.id)}
				{@const selected = p.id === presetId && !custom}
				<button
					type="button"
					role="radio"
					aria-checked={selected}
					class="btn btn-sm min-h-11 flex-col items-start {selected ? 'preset-filled-primary-500' : 'preset-tonal-surface'}"
					title={p.description ?? ""}
					onclick={() => apply(p.id)}
					disabled={disabled || busy}
					data-session-preset={p.id}
				>
					<span>{p.name}</span>
					{#if cost(p)}<span class="text-meta opacity-80">{cost(p)}</span>{/if}
				</button>
			{/each}
		</div>
	</div>
{/if}
