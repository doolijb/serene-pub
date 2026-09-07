<script lang="ts">
	/**
	 * Independent strengths, one bar each — and **deliberately not `ShareBar`**.
	 *
	 * The two sit within a few rows of each other on the ranking step, and the
	 * whole risk this component exists to remove is a reader carrying the wrong
	 * arithmetic from one to the other:
	 *
	 * | | `ShareBar` | this |
	 * |---|---|---|
	 * | The picture | **one** bar, divided | **one bar per member**, each on its own track |
	 * | Raising a member | takes from the others | takes from nothing |
	 * | The total | always 100% | meaningless, and never shown |
	 * | Zero means | leave this source out | this mechanism does not count |
	 * | The question | how is the budget split | how much does this count |
	 *
	 * Drawing them alike — one stacked bar with the normalisation switched off —
	 * would say "these compete" in the only language a stacked bar has. So they
	 * are separate shapes, and the unfilled remainder of each track is drawn
	 * plainly to make "up to a maximum" the visible reading rather than "a slice
	 * of a whole".
	 *
	 * ⚠ **1 is neutral, not maximum**, wherever this is used for a multiplier —
	 * the declaration says so in its description and the marker below draws it.
	 * A control whose default sits at the right-hand end reads as "turned all the
	 * way up", which is the opposite of what neutral means.
	 *
	 * Everything renders from the declaration — label, description, colour index,
	 * range — so a plugin declaring its own `strengths` parameter arrives here
	 * with nothing to change.
	 */
	interface Member {
		key: string
		label?: string
		description?: string
		tone?: number
	}

	interface Props {
		members: readonly Member[]
		value: Record<string, number> | undefined
		/** Author defaults, so the neutral marker knows where neutral is. */
		authorDefault?: Record<string, number> | undefined
		readonly?: boolean
		min?: number
		max?: number
		onchange: (next: Record<string, number>) => void
	}

	let {
		members,
		value,
		authorDefault,
		readonly = false,
		min = 0,
		max = 1,
		onchange
	}: Props = $props()

	/**
	 * The same palette `ShareBar` uses, and the same reason for it: a band's
	 * colour is an identity rather than a severity, so the hues sit at one
	 * lightness and chroma and stay evenly spaced perceptually.
	 *
	 * Shared by copy rather than by import, because the two controls are
	 * deliberately different components and a shared constants module between
	 * them would be the first step back toward being one.
	 */
	const TONES = [
		"oklch(0.72 0.13 250)",
		"oklch(0.72 0.13 160)",
		"oklch(0.72 0.13 60)",
		"oklch(0.72 0.13 20)",
		"oklch(0.72 0.13 310)",
		"oklch(0.72 0.13 200)"
	]
	const toneOf = (m: Member, i: number) => TONES[(m.tone ?? i) % TONES.length]

	const span = $derived(Math.max(1e-9, max - min))

	const strengths = $derived.by<Record<string, number>>(() => {
		const out: Record<string, number> = {}
		for (const m of members) {
			const raw = Number(value?.[m.key] ?? authorDefault?.[m.key] ?? 0)
			out[m.key] = Number.isFinite(raw)
				? Math.min(max, Math.max(min, raw))
				: 0
		}
		return out
	})

	const pct = (key: string) => (((strengths[key] ?? 0) - min) / span) * 100

	/** Where the author's default sits, as a percentage — usually neutral. */
	const neutralPct = (key: string) => {
		const d = Number(authorDefault?.[key])
		if (!Number.isFinite(d)) return null
		const p = ((d - min) / span) * 100
		// Only worth drawing when it is somewhere a reader could mistake for an
		// extreme; a default at either end explains itself.
		return p > 1 && p < 99 ? p : null
	}

	function set(key: string, next: number) {
		if (readonly) return
		if (!Number.isFinite(next)) return
		onchange({
			...strengths,
			[key]: Math.round(Math.min(max, Math.max(min, next)) * 100) / 100
		})
	}

	/** Percent for display, so the number is one a person types. */
	const asPercent = (key: string) => Math.round(pct(key))
</script>

<ul class="flex flex-col gap-2">
	{#each members as m, i (m.key)}
		<li class="flex flex-col gap-1">
			<div class="flex items-baseline gap-2 text-xs">
				<span class="min-w-0 flex-1 truncate" title={m.description}>
					{m.label ?? m.key}
				</span>
				<input
					type="number"
					class="input w-20 text-right"
					min={0}
					max={100}
					step="5"
					disabled={readonly}
					aria-label="{m.label ?? m.key} strength, percent"
					value={asPercent(m.key)}
					onchange={(e) =>
						set(
							m.key,
							min +
								(parseFloat(e.currentTarget.value) / 100) * span
						)}
				/>
				<span class="w-3 opacity-60">%</span>
			</div>
			<!--
				A track per member, never a shared one. The empty remainder is
				what says "this could be higher" rather than "the others took
				it", which is the whole distinction from the split above.
			-->
			<div
				class="bg-surface-300-700 relative h-2 w-full overflow-hidden rounded"
				role="img"
				aria-label="{m.label ?? m.key} at {asPercent(m.key)} percent"
			>
				<div
					class="h-full"
					style="width:{pct(m.key)}%; background:{toneOf(m, i)}"
				></div>
				{#if neutralPct(m.key) != null}
					<!-- Where the shipped default sits. On a multiplier that is
					     "counts as much as it always did", and a reader who
					     cannot see it has no way to get back to it. -->
					<span
						class="bg-surface-900-100 absolute top-0 h-full w-px opacity-50"
						style="left:{neutralPct(m.key)}%"
						title="Default"
					></span>
				{/if}
			</div>
			{#if m.description}
				<p class="text-surface-600-400 text-[0.7rem] leading-snug">
					{m.description}
				</p>
			{/if}
		</li>
	{/each}
</ul>
