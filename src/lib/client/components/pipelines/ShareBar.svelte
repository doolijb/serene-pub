<script lang="ts">
	/**
	 * A normalised split, as one bar.
	 *
	 * The control this replaced was a single number — "trim to 4096" — which
	 * answered a question nobody asks. What people want to say is "lore matters
	 * more than old history in this chat", and that is a ratio, not a count.
	 *
	 * Because the underlying `share` is normalised, **there is no invalid
	 * state**: the total is always 100%, dragging a divider takes from one
	 * neighbour and gives to the other, and zero is a band's off switch. So
	 * there is nothing to validate, nothing to explain, and no error message
	 * this control can ever need to show.
	 *
	 * The bands come from the declaration — label, description and colour index
	 * — so a plugin's own share parameter renders here with no change, and a
	 * sixth retrieval source gets a labelled band without anyone editing this
	 * file.
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
		readonly?: boolean
		/** Tokens the split divides, when the window is known. */
		windowTokens?: number
		onchange: (next: Record<string, number>) => void
	}

	let { members, value, readonly = false, windowTokens, onchange }: Props =
		$props()

	/**
	 * One colour per band, by index, wrapping.
	 *
	 * Fixed hues at a single lightness/chroma so no band shouts louder than
	 * another — a band's colour is an identity, not a severity. Stated in
	 * `oklch` so the set stays evenly spaced perceptually rather than in the
	 * RGB cube, and legible against both themes without a second palette.
	 */
	const TONES = [
		"oklch(0.72 0.13 250)",
		"oklch(0.72 0.13 160)",
		"oklch(0.72 0.13 60)",
		"oklch(0.72 0.13 20)",
		"oklch(0.72 0.13 310)",
		"oklch(0.72 0.13 200)"
	]
	const toneOf = (m: Member, i: number) =>
		TONES[(m.tone ?? i) % TONES.length]

	const shares = $derived.by<Record<string, number>>(() => {
		const out: Record<string, number> = {}
		for (const m of members) out[m.key] = Number(value?.[m.key] ?? 0) || 0
		return out
	})
	const total = $derived(
		members.reduce((sum, m) => sum + Math.max(0, shares[m.key] ?? 0), 0)
	)
	const pct = (key: string) =>
		total > 0 ? (Math.max(0, shares[key] ?? 0) / total) * 100 : 0

	const active = $derived(members.filter((m) => (shares[m.key] ?? 0) > 0))

	function emit(next: Record<string, number>) {
		if (readonly) return
		onchange(next)
	}

	/** Set one band's percentage, taking the difference from the others pro rata. */
	function setPercent(key: string, percent: number) {
		const want = Math.min(100, Math.max(0, percent))
		const others = members.filter((m) => m.key !== key)
		const othersTotal = others.reduce(
			(sum, m) => sum + Math.max(0, shares[m.key] ?? 0),
			0
		)
		const next: Record<string, number> = { [key]: want }
		for (const m of others)
			// Rescale what is left so the ratios *between* the other bands are
			// untouched — moving one slider must not silently reorder the rest.
			next[m.key] =
				othersTotal > 0
					? (Math.max(0, shares[m.key] ?? 0) / othersTotal) *
						(100 - want)
					: (100 - want) / Math.max(1, others.length)
		emit(round(next))
	}

	function toggle(key: string) {
		if ((shares[key] ?? 0) > 0) {
			// Off is `share: 0`, which the model already expresses — so a
			// toggle needs no second field remembering what it used to be.
			const next = { ...shares, [key]: 0 }
			if (Object.values(next).every((n) => n <= 0)) return
			emit(round(next))
		} else {
			// Back on at an even slice of the current total.
			setPercent(key, total > 0 ? 100 / (active.length + 1) : 100)
		}
	}

	/** Four decimals: enough to hold an even three-way split without drift. */
	const round = (r: Record<string, number>): Record<string, number> =>
		Object.fromEntries(
			Object.entries(r).map(([k, v]) => [k, Math.round(v * 10000) / 10000])
		)

	const tokensFor = (key: string) =>
		windowTokens ? Math.floor((pct(key) / 100) * windowTokens) : undefined
</script>

<div class="flex flex-col gap-2">
	<div
		class="flex h-6 w-full overflow-hidden rounded"
		role="img"
		aria-label={members
			.map((m) => `${m.label ?? m.key} ${Math.round(pct(m.key))}%`)
			.join(", ")}
	>
		{#each members as m, i (m.key)}
			{#if pct(m.key) > 0}
				<div
					class="h-full"
					style="width:{pct(m.key)}%; background:{toneOf(m, i)}"
					title="{m.label ?? m.key} — {Math.round(pct(m.key))}%"
				></div>
			{/if}
		{/each}
		{#if total <= 0}
			<div class="h-full w-full bg-surface-300-700"></div>
		{/if}
	</div>

	<!--
		The bar is the picture; these rows are the control. A drag handle alone
		would be unusable by keyboard and imprecise by mouse, and this is a
		setting people will want to type an exact number into.
	-->
	<ul class="flex flex-col gap-1">
		{#each members as m, i (m.key)}
			<li class="flex items-center gap-2 text-xs">
				<button
					type="button"
					class="size-3 shrink-0 rounded-sm"
					style="background:{(shares[m.key] ?? 0) > 0
						? toneOf(m, i)
						: 'transparent'}; border:1px solid {toneOf(m, i)}"
					disabled={readonly}
					aria-pressed={(shares[m.key] ?? 0) > 0}
					title={(shares[m.key] ?? 0) > 0
						? `Leave ${m.label ?? m.key} out`
						: `Include ${m.label ?? m.key}`}
					onclick={() => toggle(m.key)}
				></button>
				<span class="min-w-0 flex-1 truncate" title={m.description}>
					{m.label ?? m.key}
				</span>
				{#if tokensFor(m.key) != null}
					<span class="opacity-60 tabular-nums">
						~{tokensFor(m.key)} tokens
					</span>
				{/if}
				<input
					type="number"
					class="input w-20 text-right"
					min="0"
					max="100"
					step="1"
					disabled={readonly}
					aria-label="{m.label ?? m.key} share, percent"
					value={Math.round(pct(m.key))}
					onchange={(e) =>
						setPercent(m.key, parseFloat(e.currentTarget.value))}
				/>
				<span class="w-3 opacity-60">%</span>
			</li>
		{/each}
	</ul>
</div>
