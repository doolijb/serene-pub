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
	 * The block's `action` — the identity of the declaration it fires,
	 * stamped by the outlet that wrote it (U5c review, W-E) — rides along
	 * verbatim, so the server holds the press to THAT declaration's audience;
	 * a block carrying none is fired as the legacy shape and gets the owner
	 * floor. This view never invents one.
	 *
	 * A **form** (R-15 *Forms*; U5d) is a `choices` or `form` block with an
	 * `addressee`: its `id` rides the press as `blockId`, so the server reads
	 * the block off the row and holds the press to the addressee — the person
	 * portraying them may answer, nobody else; when the AI portrays them the
	 * answer pipeline already answered. A choice's `choice` key is the
	 * payload. The question is shown above the options unless the message
	 * body already says it (`bodyText`), which is how the narrator's Ask
	 * reads: the question once, then the buttons.
	 */
	import * as Icons from "@lucide/svelte"
	import MessageBlocksView from "./MessageBlocksView.svelte"
	import { renderMarkdownWithQuotedText } from "$lib/client/utils/markdownToHTML"
	import { t } from "$lib/client/i18n/state.svelte"

	interface Props {
		blocks: any[]
		onAction?: (
			fn: string,
			payload?: Record<string, unknown>,
			action?: string,
			blockId?: string
		) => void
		depth?: number
		/** The message body, so a form's question is not shown twice. */
		bodyText?: string
	}

	let { blocks, onAction, depth = 1, bodyText }: Props = $props()

	/** A form's question, when the body does not already carry it. */
	const caption = (b: { question?: unknown }): string | null => {
		if (typeof b?.question !== "string" || !b.question.trim()) return null
		const q = b.question.trim()
		return bodyText && bodyText.trim().includes(q) ? null : q
	}

	/** The block's id, when the host stamped one. */
	const blockIdOf = (b: { id?: unknown }): string | undefined =>
		typeof b?.id === "string" && b.id ? b.id : undefined

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
		onAction(block.fn, values, identityOf(block), blockIdOf(block))
	}

	/** The block's stamped identity, when it carries a well-formed one. */
	const identityOf = (b: { action?: unknown }): string | undefined =>
		typeof b?.action === "string" && b.action ? b.action : undefined

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
			<div
				class="flex flex-col gap-1"
				role="group"
				aria-label={typeof block.question === "string" && block.question
					? block.question
					: t("Choices")}
			>
				{#if caption(block)}
					<p class="text-sm italic opacity-80">{caption(block)}</p>
				{/if}
				<div class="flex flex-wrap gap-2">
					{#each block.actions ?? [] as action}
						<button
							type="button"
							class="btn btn-sm preset-tonal-primary"
							disabled={!onAction}
							onclick={() =>
								onAction?.(
									action.fn,
									typeof action.choice === "string"
										? { choice: action.choice }
										: {},
									identityOf(action),
									blockIdOf(block)
								)}
						>
							<Icons.Play size={14} aria-hidden="true" />
							{action.label}
						</button>
					{/each}
				</div>
			</div>
		{:else if block?.kind === "form"}
			<div class="flex w-full max-w-sm flex-col gap-2 text-sm">
				{#if caption(block)}
					<p class="italic opacity-80">{caption(block)}</p>
				{/if}
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
