<script lang="ts">
	/**
	 * "Layouts in this template" (W5): every laid-out variable the template
	 * reads, with the layout it is written with, changed in one go.
	 *
	 * An inline short list, not a modal. A row's value starts as what the
	 * template writes now — the pub's layout, one named layout, or *Mixed*
	 * (left as it is on Apply). Apply hands the edits to the editor as one
	 * transaction. Nothing here toasts or touches a socket.
	 */
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import {
		bareOffer,
		laidOutOccurrences,
		rewriteChanges,
		titledOffer
	} from "./templateLayoutRewrite"

	interface Props {
		engine: string
		source: string
		variableLayouts: readonly Sockets.Pipelines.VariableLayouts.TemplateKey[]
		/** The edits Apply makes — the editor dispatches them as one transaction. */
		onapply: (
			changes: { from: number; to: number; insert: string }[]
		) => void
		uid: string
	}

	let { engine, source, variableLayouts, onapply, uid }: Props = $props()

	const BARE = "::pub"
	const MIXED = "::mixed"

	let open = $state(false)
	/** Row key → chosen value. Filled when the list opens. */
	let picks = $state<Record<string, string>>({})
	let initial = $state<Record<string, string>>({})

	/** The keys the template reads, in first-occurrence order. */
	const rows = $derived.by(() => {
		const keys = variableLayouts.map((k) => k.key)
		const seen: string[] = []
		for (const o of laidOutOccurrences(engine, source, keys))
			if (!seen.includes(o.key)) seen.push(o.key)
		return seen.map((key) => variableLayouts.find((k) => k.key === key)!)
	})

	function readNow(key: string, offers: { reference: string }[]): string {
		const refs = laidOutOccurrences(engine, source, [key]).map(
			(o) => o.reference
		)
		const first = refs[0]
		if (refs.every((r) => r === first))
			return first === null || first === undefined
				? BARE
				: offers.some((o) => o.reference === first)
					? first
					: MIXED
		return MIXED
	}

	function toggle() {
		if (!open) {
			const now: Record<string, string> = {}
			for (const r of rows) now[r.key] = readNow(r.key, r.offers)
			initial = now
			picks = { ...now }
		}
		open = !open
	}

	const canBare = $derived(rows.some((r) => bareOffer(r.offers)))
	const canTitled = $derived(rows.some((r) => titledOffer(r.offers)))

	function setAll(pick: typeof bareOffer) {
		const next = { ...picks }
		for (const r of rows) {
			const offer = pick(r.offers)
			if (offer) next[r.key] = offer.reference
		}
		picks = next
	}

	function apply() {
		const targets = new Map<string, string | null>()
		for (const r of rows) {
			const p = picks[r.key]
			if (p === undefined || p === MIXED || p === initial[r.key]) continue
			targets.set(r.key, p === BARE ? null : p)
		}
		const changes = targets.size
			? rewriteChanges(engine, source, [...targets.keys()], (o) =>
					targets.has(o.key) ? targets.get(o.key) : undefined
				)
			: []
		if (changes.length) onapply(changes)
		open = false
	}

	const optionsFor = (r: (typeof rows)[number]) => [
		...(initial[r.key] === MIXED
			? [{ value: MIXED, label: "Mixed — leave as it is" }]
			: []),
		{ value: BARE, label: "The pub's layout" },
		...r.offers.map((o) => ({ value: o.reference, label: o.label }))
	]
</script>

{#if rows.length}
	<div class="flex flex-col gap-1">
		<div class="flex justify-end">
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface pointer-coarse:min-h-11"
				aria-expanded={open}
				aria-controls="{uid}-layouts"
				onclick={toggle}
			>
				<Icons.ChevronRight
					size={12}
					class="transition-transform {open ? 'rotate-90' : ''}"
					aria-hidden="true"
				/>
				Layouts in this template
			</button>
		</div>
		{#if open}
			<div
				id="{uid}-layouts"
				class="border-surface-200-800 flex flex-col gap-2 rounded border p-2"
			>
				{#if canBare || canTitled}
					<div class="flex flex-wrap gap-1">
						{#if canBare}
							<button
								type="button"
								class="btn btn-sm preset-tonal-surface pointer-coarse:min-h-11"
								onclick={() => setAll(bareOffer)}
							>
								All bare
							</button>
						{/if}
						{#if canTitled}
							<button
								type="button"
								class="btn btn-sm preset-tonal-surface pointer-coarse:min-h-11"
								onclick={() => setAll(titledOffer)}
							>
								All titled
							</button>
						{/if}
					</div>
				{/if}
				<ul class="flex flex-col gap-2">
					{#each rows as r (r.key)}
						<li class="flex flex-wrap items-center gap-x-3 gap-y-1">
							<span class="flex min-w-0 flex-1 flex-col text-xs">
								<span class="font-medium">
									{r.variableLabel}
								</span>
								<span class="text-surface-600-400 font-mono">
									{r.key}
								</span>
							</span>
							<Select
								label="Layout for {r.variableLabel}"
								labelHidden
								class="w-56 max-w-full"
								options={optionsFor(r)}
								value={picks[r.key]}
								onValueChange={(v) => (picks[r.key] = v)}
							/>
						</li>
					{/each}
				</ul>
				<div class="flex justify-end">
					<button
						type="button"
						class="btn btn-sm preset-filled-primary-500 pointer-coarse:min-h-11"
						onclick={apply}
					>
						Apply
					</button>
				</div>
			</div>
		{/if}
	</div>
{/if}
