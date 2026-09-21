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
	 *
	 * **Answered once** (U5d review, W7): a form the host has stamped
	 * `answered` shows the answer in place of its buttons, greyed; a form
	 * put to somebody the viewer does not portray shows no buttons at all —
	 * `canAnswer` is the viewer's verdict, handed down from the page, which
	 * mirrors the server's resolver (`utils/formAnswer.ts`). An affordance
	 * only: the server refuses regardless.
	 *
	 * **Superseded** (plans/29 R-15 *Staleness and order*; U5f): a form the
	 * channel has moved past — unanswered, and a newer message on its row's
	 * channel than the `head` it was issued at — collapses to one quiet line,
	 * no question and no buttons (the row's body already showed the question).
	 * `isStale` is the verdict, handed down from the message
	 * (`utils/formAnswer.ts` `staleOf`, the server's rule over the list the
	 * client holds). Answered beats stale.
	 */
	import * as Icons from "@lucide/svelte"
	import MessageBlocksView from "./MessageBlocksView.svelte"
	import { renderMarkdownWithQuotedText } from "$lib/client/utils/markdownToHTML"
	import { t } from "$lib/client/i18n/state.svelte"
	import { answeredChoiceLabel, answeredOf } from "$lib/client/utils/formAnswer"

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
		/**
		 * May the viewer answer a form put to this addressee? Absent, every
		 * addressed form shows its buttons and the server judges the press.
		 */
		canAnswer?: (addressee: string | undefined) => boolean
		/**
		 * Has the channel moved past this form (U5f)? Absent, no form is
		 * drawn superseded and the server refuses a stale press.
		 */
		isStale?: (block: { head?: unknown; answered?: unknown }) => boolean
	}

	let { blocks, onAction, depth = 1, bodyText, canAnswer, isStale }: Props = $props()

	/** Whether the form is superseded — never when answered. */
	const superseded = (b: { head?: unknown; answered?: unknown }): boolean =>
		!answeredOf(b) && !!isStale && isStale(b)

	/** The addressee, when the block has one. */
	const addresseeOf = (b: { addressee?: unknown }): string | undefined =>
		typeof b?.addressee === "string" && b.addressee ? b.addressee : undefined

	/** Whether this viewer's buttons show on the form. */
	const mayAnswer = (b: { addressee?: unknown }): boolean =>
		!canAnswer || canAnswer(addresseeOf(b))

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
		{:else if block?.kind === "choices" && superseded(block)}
			<!-- Superseded (U5f): the conversation moved on; one quiet line, no buttons. -->
			<p
				class="flex flex-wrap items-center gap-1 text-sm opacity-60"
				data-superseded="true"
			>
				<Icons.History size={14} aria-hidden="true" />
				<span>{t("Superseded — the conversation moved on")}</span>
			</p>
		{:else if block?.kind === "choices"}
			{@const answered = answeredOf(block)}
			<div
				class="flex flex-col gap-1"
				class:opacity-60={!!answered}
				role="group"
				aria-label={typeof block.question === "string" && block.question
					? block.question
					: t("Choices")}
				data-answered={answered ? "true" : undefined}
			>
				{#if caption(block)}
					<p class="text-sm italic opacity-80">{caption(block)}</p>
				{/if}
				{#if answered}
					<!-- Answered once: the answer stands in for the buttons. -->
					<p class="flex items-center gap-1 text-sm">
						<Icons.Check size={14} aria-hidden="true" />
						<span class="font-medium">{t("Answered")}</span>
						{#if answeredChoiceLabel(block, answered)}
							<span>· {answeredChoiceLabel(block, answered)}</span>
						{/if}
					</p>
				{:else if !mayAnswer(block)}
					<!-- Somebody else's to answer: no buttons for this viewer. -->
					<p class="text-sm opacity-70">{t("Awaiting an answer")}</p>
				{:else}
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
				{/if}
			</div>
		{:else if block?.kind === "form" && superseded(block)}
			<!-- Superseded (U5f): the conversation moved on; one quiet line, no buttons. -->
			<p
				class="flex flex-wrap items-center gap-1 text-sm opacity-60"
				data-superseded="true"
			>
				<Icons.History size={14} aria-hidden="true" />
				<span>{t("Superseded — the conversation moved on")}</span>
			</p>
		{:else if block?.kind === "form" && answeredOf(block)}
			<div class="flex w-full max-w-sm flex-col gap-2 text-sm opacity-60" data-answered="true">
				{#if caption(block)}
					<p class="italic opacity-80">{caption(block)}</p>
				{/if}
				<p class="flex items-center gap-1">
					<Icons.Check size={14} aria-hidden="true" />
					<span class="font-medium">{t("Answered")}</span>
				</p>
			</div>
		{:else if block?.kind === "form" && !mayAnswer(block)}
			<div class="flex w-full max-w-sm flex-col gap-2 text-sm">
				{#if caption(block)}
					<p class="italic opacity-80">{caption(block)}</p>
				{/if}
				<p class="opacity-70">{t("Awaiting an answer")}</p>
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
				<MessageBlocksView
					blocks={block.blocks}
					{onAction}
					{bodyText}
					{canAnswer}
					{isStale}
					depth={depth + 1}
				/>
			</div>
		{/if}
	{/each}
</div>
