<script lang="ts">
	/**
	 * The minimap: the whole line as dots, one row per node, a square per
	 * clause with a row per branch, nested clauses indented — small enough
	 * that a spec of 130 nodes six junctions deep still fits beside the line
	 * (PLAN-pipeline-canvas-and-genre-authoring §3). Beside the line it runs
	 * down; under 720px of workspace it runs across as a scrubber with
	 * names only on clauses.
	 *
	 * It is a navigator: a click selects, the band shows the selection, and
	 * the overlay's colours reach it through `colorOf`. It draws nothing the
	 * line does not also draw.
	 */
	import type { LineModel, LineRow } from "./lineModel"
	import type { DiffMark } from "./lineModel"
	import { MARK_VAR } from "./canvasTokens"

	interface Props {
		model: LineModel
		selected: string | null
		/** The colour of a key's dot — the kind's, or the overlay's. */
		colorOf: (key: string, kind: string) => string
		/** A diff overlay's mark for a key, or null. */
		markOf?: (key: string) => DiffMark | null
		onSelect: (key: string) => void
		orientation?: "vertical" | "horizontal"
	}

	let {
		model,
		selected,
		colorOf,
		markOf = () => null,
		onSelect,
		orientation = "vertical"
	}: Props = $props()

	type Glyph =
		| { t: "node"; key: string; kind: string; x: number; y: number; label: string; depth: number }
		| { t: "clause"; key: string; x: number; y: number; label: string; count: number; depth: number }
		| { t: "branch"; key: string; x: number; y: number; label: string; dots: { key: string; kind: string }[]; depth: number }

	const PITCH = 14
	const MX = 22
	const INDENT = 12
	const WIDTH = 230

	/** Vertical layout: a glyph per row, in run order, with the band's extent. */
	const vertical = $derived.by(() => {
		const glyphs: Glyph[] = []
		let y = 12
		const found: { band: { from: number; to: number } | null } = { band: null }
		const walk = (rows: LineRow[], depth: number) => {
			const x = MX + depth * INDENT
			for (const r of rows) {
				if (r.kind === "node") {
					if (r.key === selected) found.band = { from: y - PITCH / 2, to: y + PITCH / 2 }
					glyphs.push({ t: "node", key: r.key, kind: r.node.kind, x, y, label: r.node.key.split(".").pop() ?? r.key, depth })
					y += PITCH
					continue
				}
				const start = y - PITCH / 2
				const count = r.branches.reduce((n, b) => n + b.rows.length, 0)
				glyphs.push({ t: "clause", key: r.key, x, y, label: r.key.split(".").pop() ?? r.key, count, depth })
				y += PITCH
				for (const b of r.branches) {
					const direct = b.rows.filter((row) => row.kind === "node") as Extract<LineRow, { kind: "node" }>[]
					glyphs.push({
						t: "branch",
						key: `${r.key}.${b.name}`,
						x,
						y,
						label: b.name,
						dots: direct.map((d) => ({ key: d.key, kind: d.node.kind })),
						depth
					})
					y += PITCH
					const nested = b.rows.filter((row) => row.kind === "clause")
					if (nested.length) walk(nested, depth + 1)
				}
				if (r.key === selected) found.band = { from: start, to: y - PITCH / 2 }
			}
		}
		walk(model.rows, 0)
		return { glyphs, height: y + 4, band: found.band }
	})

	/** Horizontal layout: dots along one line, clauses as squares with a name above. */
	const horizontal = $derived.by(() => {
		const glyphs: Glyph[] = []
		let x = 12
		const y = 30
		const found: { band: { from: number; to: number } | null } = { band: null }
		const walk = (rows: LineRow[]) => {
			for (const r of rows) {
				if (r.kind === "node") {
					if (r.key === selected) found.band = { from: x - 5, to: x + 5 }
					glyphs.push({ t: "node", key: r.key, kind: r.node.kind, x, y, label: "", depth: 0 })
					x += 9
					continue
				}
				const start = x - 5
				const count = r.branches.reduce((n, b) => n + b.rows.length, 0)
				glyphs.push({ t: "clause", key: r.key, x, y, label: r.key.split(".").pop() ?? r.key, count, depth: 0 })
				x += 9
				for (const b of r.branches) walk(b.rows)
				if (r.key === selected) found.band = { from: start, to: x - 4 }
			}
		}
		walk(model.rows)
		return { glyphs, width: x + 8, band: found.band }
	})

	const labelOf = (g: Glyph) => (g.t === "node" ? g.label : g.label)

	function keydown(e: KeyboardEvent, key: string) {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault()
			onSelect(key)
		}
	}
</script>

{#if orientation === "vertical"}
	{@const v = vertical}
	<div class="h-full overflow-y-auto overflow-x-hidden">
		<svg
			class="text-surface-800-200 block w-full"
			viewBox="0 0 {WIDTH} {v.height}"
			style="height: {v.height}px"
			role="group"
			aria-label="Pipeline minimap"
		>
			{#if v.band}
				<rect
					x="4"
					y={v.band.from}
					width={WIDTH - 8}
					height={v.band.to - v.band.from}
					rx="6"
					style="fill: var(--color-primary-500); opacity: .14"
				/>
			{/if}
			<path
				d="M{MX} 6 V{v.height - 8}"
				style="stroke: var(--color-surface-400); stroke-width: 2; fill: none"
			/>
			{#each v.glyphs as g (g.key)}
				{#if g.t === "node"}
					<g
						role="button"
						tabindex="-1"
						class="cursor-pointer"
						aria-label={g.key}
						onclick={() => onSelect(g.key)}
						onkeydown={(e) => keydown(e, g.key)}
					>
						<circle cx={g.x} cy={g.y} r="3" style="fill: {colorOf(g.key, g.kind)}" />
						{#if markOf(g.key)}
							<circle cx={g.x} cy={g.y} r="5.5" style="fill: none; stroke: {MARK_VAR[markOf(g.key)!]}; stroke-width: 1.5" />
						{/if}
						<text
							x={g.x + 10}
							y={g.y + 4}
							font-size="9.5"
							class="font-mono"
							fill="currentColor"
							style={g.key === selected ? "font-weight: 600" : ""}>{g.label}</text
						>
					</g>
				{:else if g.t === "clause"}
					<g
						role="button"
						tabindex="-1"
						class="cursor-pointer"
						aria-label="{g.key} clause"
						onclick={() => onSelect(g.key)}
						onkeydown={(e) => keydown(e, g.key)}
					>
						{#if g.depth > 0}
							<path d="M{g.x - INDENT} {g.y} H{g.x}" style="stroke: var(--color-surface-500); stroke-width: 1; fill: none" />
						{/if}
						<rect
							x={g.x - 3.5}
							y={g.y - 3.5}
							width="7"
							height="7"
							style="fill: {g.key === selected ? 'var(--color-primary-500)' : 'currentColor'}"
						/>
						{#if markOf(g.key)}
							<rect x={g.x - 6.5} y={g.y - 6.5} width="13" height="13" rx="2" style="fill: none; stroke: {MARK_VAR[markOf(g.key)!]}; stroke-width: 1.5" />
						{/if}
						<text
							x={g.x + 10}
							y={g.y + 4}
							font-size="10"
							font-weight="600"
							class="font-mono"
							fill={g.key === selected ? "var(--color-primary-500)" : "currentColor"}>{g.label}</text
						>
					</g>
				{:else}
					{@const lw = g.label.length * 5.2}
					<g class="text-surface-600-400">
						<path
							d="M{g.x} {g.y} H{g.x + 8} M{g.x + 14 + lw} {g.y} H{g.x + 16 + lw + g.dots.length * 11}"
							style="stroke: var(--color-surface-500); stroke-width: 1; fill: none"
						/>
						<text x={g.x + 12} y={g.y + 3.5} font-size="8.5" class="font-mono" fill="currentColor">{g.label}</text>
						{#each g.dots as d (d.key)}
							{@const i = g.dots.indexOf(d)}
							<g
								role="button"
								tabindex="-1"
								class="cursor-pointer"
								aria-label={d.key}
								onclick={() => onSelect(d.key)}
								onkeydown={(e) => keydown(e, d.key)}
							>
								<circle cx={g.x + 18 + lw + i * 11} cy={g.y} r="2.5" style="fill: {colorOf(d.key, d.kind)}" />
								{#if markOf(d.key)}
									<circle cx={g.x + 18 + lw + i * 11} cy={g.y} r="5" style="fill: none; stroke: {MARK_VAR[markOf(d.key)!]}; stroke-width: 1.5" />
								{/if}
							</g>
						{/each}
					</g>
				{/if}
			{/each}
		</svg>
	</div>
{:else}
	{@const h = horizontal}
	<svg
		class="text-surface-800-200 block h-11 w-full"
		viewBox="0 0 {h.width} 44"
		preserveAspectRatio="xMinYMid meet"
		role="group"
		aria-label="Pipeline minimap"
	>
		{#if h.band}
			<rect x={h.band.from} y="8" width={h.band.to - h.band.from} height="30" rx="5" style="fill: var(--color-primary-500); opacity: .16" />
		{/if}
		<path d="M6 30 H{h.width - 6}" style="stroke: var(--color-surface-400); stroke-width: 2; fill: none" />
		{#each h.glyphs as g (g.key)}
			<g
				role="button"
				tabindex="-1"
				class="cursor-pointer"
				aria-label={g.key}
				onclick={() => onSelect(g.key)}
				onkeydown={(e) => keydown(e, g.key)}
			>
				{#if g.t === "node"}
					<circle cx={g.x} cy={g.y} r="2.5" style="fill: {colorOf(g.key, g.kind)}" />
				{:else if g.t === "clause"}
					<rect x={g.x - 3} y={g.y - 3} width="6" height="6" style="fill: {g.key === selected ? 'var(--color-primary-500)' : 'currentColor'}" />
					<text x={g.x} y="16" font-size="8.5" font-weight="600" text-anchor="middle" class="font-mono" fill="currentColor">{labelOf(g)}</text>
				{/if}
			</g>
		{/each}
	</svg>
{/if}
