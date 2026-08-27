<script lang="ts">
	/**
	 * The block renderer (20 §6): plugin message content as data, drawn by
	 * core's own components — themed, accessible, and with nothing to
	 * sanitize, because no markup ever crosses the boundary.
	 *
	 * Interactivity is declared: a `choices` button or a `form` submit names a
	 * function key, and `onAction` carries it (with the entered values as the
	 * payload) up to the page, which fires `sessions:triggerFunction` with the
	 * message as subject — the same audited path as every contributed button.
	 */
	import * as Icons from "@lucide/svelte"
	import MessageBlocksView from "./MessageBlocksView.svelte"
	import { renderMarkdownWithQuotedText } from "$lib/client/utils/markdownToHTML"

	interface Props {
		blocks: any[]
		onAction?: (fn: string, payload?: Record<string, unknown>) => void
		depth?: number
	}

	let { blocks, onAction, depth = 1 }: Props = $props()

	/** Form drafts, keyed by block index within this view. */
	let formDrafts = $state<Record<number, Record<string, unknown>>>({})

	function editField(i: number, key: string, value: unknown) {
		formDrafts[i] = { ...(formDrafts[i] ?? {}), [key]: value }
	}

	function submitForm(i: number, block: any) {
		if (!onAction) return
		// Declared defaults fill what the person didn't touch.
		const values: Record<string, unknown> = {}
		for (const [key, decl] of Object.entries(block.fields ?? {}) as any)
			if (decl?.default !== undefined) values[key] = decl.default
		Object.assign(values, formDrafts[i] ?? {})
		onAction(block.fn, values)
	}

	const fieldLabel = (key: string, decl: any): string =>
		typeof decl?.label === "string" ? decl.label : (decl?.label?.en ?? key)
</script>

<div class="flex flex-col gap-2" class:mt-2={depth === 1}>
	{#each blocks as block, i}
		{#if block?.kind === "md"}
			<div class="rendered-session-message-content">
				{@html renderMarkdownWithQuotedText(String(block.text ?? ""))}
			</div>
		{:else if block?.kind === "kv"}
			<dl class="grid w-fit grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
				{#each block.rows ?? [] as row}
					<dt class="font-medium opacity-70">{row.label}</dt>
					<dd>{row.value}</dd>
				{/each}
			</dl>
		{:else if block?.kind === "table"}
			<div class="overflow-x-auto">
				<table class="table table-compact w-fit text-sm">
					<thead>
						<tr>
							{#each block.columns ?? [] as col}
								<th>{col}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each block.rows ?? [] as row}
							<tr>
								{#each row as cell}
									<td>{cell}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else if block?.kind === "stat"}
			<div class="w-full max-w-xs text-sm">
				<div class="flex justify-between">
					<span class="font-medium">{block.label}</span>
					<span class="tabular-nums">
						{block.value}{block.max != null ? ` / ${block.max}` : ""}
					</span>
				</div>
				{#if block.max}
					<div
						class="bg-surface-300-700 mt-1 h-2 w-full overflow-hidden rounded"
						role="meter"
						aria-label={block.label}
						aria-valuenow={block.value}
						aria-valuemin={0}
						aria-valuemax={block.max}
					>
						<div
							class="bg-primary-500 h-full"
							style:width="{Math.max(
								0,
								Math.min(100, (block.value / block.max) * 100)
							)}%"
						></div>
					</div>
				{/if}
			</div>
		{:else if block?.kind === "image" && block.assetId != null}
			<img
				class="max-h-96 max-w-full rounded"
				src="/session-assets/{block.assetId}"
				alt={block.alt ?? "attachment"}
			/>
		{:else if block?.kind === "choices"}
			<div class="flex flex-wrap gap-2">
				{#each block.actions ?? [] as action}
					<button
						type="button"
						class="btn btn-sm preset-tonal-primary"
						disabled={!onAction}
						onclick={() => onAction?.(action.fn, {})}
					>
						<Icons.Play size={14} aria-hidden="true" />
						{action.label}
					</button>
				{/each}
			</div>
		{:else if block?.kind === "form"}
			<div class="flex w-full max-w-sm flex-col gap-2 text-sm">
				{#each Object.entries(block.fields ?? {}) as [key, decl]}
					{@const d = decl as any}
					<label class="flex flex-col gap-1">
						<span class="font-medium">{fieldLabel(key, d)}</span>
						{#if d.type === "boolean"}
							<input
								type="checkbox"
								class="checkbox"
								checked={!!(formDrafts[i]?.[key] ?? d.default)}
								onchange={(e) =>
									editField(i, key, e.currentTarget.checked)}
							/>
						{:else if d.type === "enum"}
							<select
								class="select select-sm"
								value={formDrafts[i]?.[key] ?? d.default ?? ""}
								onchange={(e) =>
									editField(i, key, e.currentTarget.value)}
							>
								{#each d.of ?? [] as opt}
									<option value={opt}>{opt}</option>
								{/each}
							</select>
						{:else if d.type === "number" || d.type === "integer"}
							<input
								type="number"
								class="input input-sm"
								step={d.type === "integer" ? "1" : "any"}
								value={formDrafts[i]?.[key] ?? d.default ?? ""}
								oninput={(e) => {
									const n = Number(e.currentTarget.value)
									editField(
										i,
										key,
										Number.isFinite(n) ? n : undefined
									)
								}}
							/>
						{:else}
							<input
								type="text"
								class="input input-sm"
								value={String(
									formDrafts[i]?.[key] ?? d.default ?? ""
								)}
								oninput={(e) =>
									editField(i, key, e.currentTarget.value)}
							/>
						{/if}
					</label>
				{/each}
				<button
					type="button"
					class="btn btn-sm preset-tonal-primary w-fit"
					disabled={!onAction}
					onclick={() => submitForm(i, block)}
				>
					{block.label ?? "Submit"}
				</button>
			</div>
		{:else if block?.kind === "group" && Array.isArray(block.blocks) && depth < 3}
			<div
				class="flex gap-2"
				class:flex-row={block.layout === "row"}
				class:flex-wrap={block.layout === "row"}
				class:flex-col={block.layout !== "row"}
			>
				<MessageBlocksView blocks={block.blocks} {onAction} depth={depth + 1} />
			</div>
		{/if}
	{/each}
</div>
