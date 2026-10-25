<!--
	@component
	Prompt Details: the compiled prompt a reply was — or the draft would be —
	built from: the token budget, which messages made it in, what retrieval
	ranked and why, the sources, and the prompt itself. Reports on whatever it
	is handed (`promptDetails`); a finished reply's report names its message,
	which an administrator sees explained from the run's receipt (R55).
-->
<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import MessageRetrievalExplanation from "$lib/client/components/pipelines/workspace/MessageRetrievalExplanation.svelte"
	import type { ComposerFlow } from "$lib/client/components/sessionPage/composerFlow.svelte"

	interface Props {
		open: boolean
		onOpenChange: (open: boolean) => void
		/** The report: a compiled prompt's `meta`, and its prompt or messages. */
		promptDetails: ComposerFlow["promptDetails"]
		/** The report's own budget verdict. */
		detailsExceeded: boolean
		/** The message the report is about; absent for the draft's. */
		reportMessageId?: number
		isAdmin: boolean
	}

	let {
		open,
		onOpenChange,
		promptDetails,
		detailsExceeded,
		reportMessageId,
		isAdmin
	}: Props = $props()
</script>

<Dialog {open} onOpenChange={(details) => onOpenChange(details.open)}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 border-surface-200-800 flex max-h-[90dvh] w-[70em] max-w-full flex-col space-y-4 border p-4 shadow-xl"
			>
				<header class="flex shrink-0 items-center justify-between">
					<h2 class="h2">Prompt Details</h2>
					<button
						class="btn btn-sm"
						onclick={() => onOpenChange(false)}
					>
						<Icons.X size={20} />
					</button>
				</header>

				{#if promptDetails?.meta}
					{@const tokens = promptDetails.meta.tokenCounts}
					{@const msgs = promptDetails.meta.sessionMessages}
					{@const src = {
						characters: [],
						personas: [],
						...promptDetails.meta.sources
					}}
					{@const retrieval = promptDetails.meta.retrieval}
					{@const tokenPct = Math.min(
						100,
						Math.round((tokens.total / tokens.limit) * 100)
					)}
					{@const truncReason = promptDetails.meta.truncationReason}

					<div class="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
						<!-- ── Token Budget ──────────────────────────────────────────────── -->
						<section
							class="bg-surface-200-800 space-y-2 rounded-lg p-3"
						>
							<h3
								class="text-surface-700-300 text-xs font-semibold"
							>
								Token budget
							</h3>
							<div
								class="flex items-center justify-between text-sm"
							>
								<span
									class:text-error-600-400={detailsExceeded}
									class:text-success-500={!detailsExceeded}
								>
									{tokens.total.toLocaleString()} / {tokens.limit.toLocaleString()}
									tokens
								</span>
								<span class="text-surface-700-300 text-xs">
									{tokenPct}%
								</span>
							</div>
							<div
								class="bg-surface-300-700 h-2 w-full overflow-hidden rounded-full"
							>
								<div
									class="h-full rounded-full transition-all {detailsExceeded
										? 'bg-error-500'
										: tokenPct > 85
											? 'bg-warning-500'
											: 'bg-success-500'}"
									style="width: {tokenPct}%"
								></div>
							</div>
							<div
								class="text-surface-700-300 flex flex-wrap gap-4 text-xs"
							>
								<span>
									Format: <span class="text-surface-300-700">
										{promptDetails.meta.promptFormat || "—"}
									</span>
								</span>
								{#if promptDetails.meta.templateName}
									<span>
										Template: <span
											class="text-surface-300-700"
										>
											{promptDetails.meta.templateName}
										</span>
									</span>
								{/if}
								<!--
									One engine now. Which retrieval *mechanism*
									ran — keyword, vector, or both — is a
									per-candidate fact and shows up in the
									Retrieval section's reasoning, not as a
									single label over the whole prompt.
								-->
								<span class="text-surface-400">Pipeline</span>
							</div>
							{#if truncReason}
								<div
									class="bg-warning-500/10 border-warning-500/30 text-warning-400 flex items-center gap-1.5 rounded border px-2 py-1.5 text-xs"
								>
									<Icons.TriangleAlert
										size={12}
										class="shrink-0"
									/>
									<span>
										Truncated: <span class="font-medium">
											{truncReason.replace(/_/g, " ")}
										</span>
									</span>
								</div>
							{/if}
						</section>

						<!-- ── Messages ─────────────────────────────────────────────────── -->
						<section
							class="bg-surface-200-800 space-y-2 rounded-lg p-3"
						>
							<h3
								class="text-surface-700-300 text-xs font-semibold"
							>
								Messages
							</h3>
							<div class="flex items-baseline gap-2 text-sm">
								<span>
									<span class="font-medium">
										{msgs.included}
									</span>
									<span class="text-surface-700-300">
										/ {msgs.total} included
									</span>
								</span>
								{#if msgs.total > msgs.included}
									<span class="text-warning-400 text-xs">
										{msgs.total - msgs.included} excluded
									</span>
								{/if}
							</div>
							{#if msgs.excludedIds?.length > 0}
								<p class="text-surface-700-300 text-xs">
									Excluded message IDs: {msgs.excludedIds.join(
										", "
									)}
								</p>
							{/if}
						</section>

						<!-- ── Retrieval ─────────────────────────────────────────────────── -->
						<!--
							Built on what the pipeline actually records: it scores
							candidates, allocates a budget, and records per block
							why that block is in or out. There are no phase
							counters or score histogram, because the pipeline has
							no phases to count.

							This answers the question the panel is for —
							"why isn't my lore showing up" — directly, per entry.
						-->
						<!--
							The thin list is now the FALLBACK, not the answer.

							It reports "in / out", a source and a token count,
							which says *that* an entry was left out and never
							*why* — the only half anybody opens this report to
							learn. `pipelines:messageExplain` returns the same
							projection the pipeline workspace reads, resolved
							from the message rather than from a run id the
							reader was never given; when nothing was recorded
							for a reply, this is still what there is.
						-->
						{#snippet thinRetrieval()}
							{#if retrieval?.blocks?.length}
								{@const shown = retrieval.blocks}
								{@const kept = shown.filter(
									(b: { included: boolean }) => b.included
								)}
								<section
									class="bg-surface-200-800 space-y-2 rounded-lg p-3"
								>
									<h3
										class="text-surface-700-300 text-xs font-semibold"
									>
										Retrieval
									</h3>
									<p class="text-surface-700-300 text-xs">
										{kept.length} of {shown.length} candidates
										included
									</p>
									<div class="space-y-1">
										{#each shown as b (`${b.source}:${b.id}`)}
											<div
												class="bg-surface-300-700 rounded p-2 text-xs"
											>
												<div
													class="flex items-baseline gap-2"
												>
													<span
														class="font-medium {b.included
															? 'text-primary-400'
															: 'text-surface-400'}"
													>
														{b.included
															? "in"
															: "out"}
													</span>
													<span
														class="min-w-0 flex-1 truncate"
													>
														{b.name ?? b.source}
													</span>
													<span
														class="text-surface-700-300 shrink-0"
													>
														{b.source} · {b.tokens}
														tok
													</span>
												</div>
												{#if b.why?.length}
													<p
														class="text-surface-700-300 mt-1"
													>
														{b.why.join(" · ")}
													</p>
												{/if}
											</div>
										{/each}
									</div>
								</section>
							{/if}
						{/snippet}
						<!-- The run's explanation reads its receipt, an
						     administrator's (R55); everyone else gets the
						     message's own stored record. -->
						{#if reportMessageId != null && isAdmin}
							<MessageRetrievalExplanation
								messageId={reportMessageId}
								fallback={thinRetrieval}
							/>
						{:else}
							{@render thinRetrieval()}
						{/if}

						<!-- ── Sources ───────────────────────────────────────────────────── -->
						<section
							class="bg-surface-200-800 space-y-2 rounded-lg p-3"
						>
							<h3
								class="text-surface-700-300 text-xs font-semibold"
							>
								Sources
							</h3>
							<div
								class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3"
							>
								<div>
									<p class="text-surface-400 mb-1 text-xs">
										Characters
									</p>
									{#if src.characters.length > 0}
										<ul class="space-y-0.5">
											{#each src.characters as char}
												<li
													class="flex items-center gap-1"
												>
													<Icons.User
														size={12}
														class="text-surface-700-300 shrink-0"
													/>
													<span
														class="truncate text-xs"
													>
														{char.name}{char.nickname
															? ` (${char.nickname})`
															: ""}
													</span>
												</li>
											{/each}
										</ul>
									{:else}
										<p class="text-surface-700-300 text-xs">
											None
										</p>
									{/if}
								</div>
								<div>
									<p class="text-surface-400 mb-1 text-xs">
										Personas
									</p>
									{#if src.personas.length > 0}
										<ul class="space-y-0.5">
											{#each src.personas as persona}
												<li
													class="flex items-center gap-1"
												>
													<Icons.User2
														size={12}
														class="text-surface-700-300 shrink-0"
													/>
													<span
														class="truncate text-xs"
													>
														{persona.name}
													</span>
												</li>
											{/each}
										</ul>
									{:else}
										<p class="text-surface-700-300 text-xs">
											None
										</p>
									{/if}
								</div>
								<div>
									<p class="text-surface-400 mb-1 text-xs">
										Scenario
									</p>
									<p class="text-xs capitalize">
										{src.scenario ?? "None"}
									</p>
								</div>
							</div>
						</section>

						<!-- ── Prompt Preview ────────────────────────────────────────────── -->
						<section
							class="bg-surface-200-800 space-y-2 rounded-lg p-3"
						>
							<h3
								class="text-surface-700-300 text-xs font-semibold"
							>
								Prompt preview
							</h3>
							{#if promptDetails.messages && promptDetails.messages.length > 0}
								<!-- Chat format: render each message block -->
								<div class="max-h-96 space-y-2 overflow-y-auto">
									{#each promptDetails.messages as msg, i}
										<div
											class="rounded border {msg.role ===
											'system'
												? 'border-warning-500/30 bg-warning-500/5'
												: msg.role === 'assistant'
													? 'border-primary-500/30 bg-primary-500/5'
													: 'border-surface-400/30 bg-surface-300-700'} overflow-hidden"
										>
											<div
												class="flex items-center gap-2 border-b border-inherit px-2 py-1"
											>
												<span
													class="text-xs font-semibold capitalize {msg.role ===
													'system'
														? 'text-warning-400'
														: msg.role ===
															  'assistant'
															? 'text-primary-400'
															: 'text-surface-400'}"
												>
													{msg.role}
												</span>
												{#if msg.name}
													<span
														class="text-surface-700-300 text-xs"
													>
														({msg.name})
													</span>
												{/if}
												<span
													class="text-surface-600 ml-auto text-xs"
												>
													#{i + 1}
												</span>
											</div>
											<pre
												class="px-2 py-1.5 text-xs leading-relaxed whitespace-pre-wrap">{typeof msg.content ===
												"string"
													? msg.content
													: JSON.stringify(
															msg.content,
															null,
															2
														)}</pre>
										</div>
									{/each}
								</div>
							{:else if promptDetails.prompt}
								<!-- Raw text format -->
								<pre
									class="bg-surface-300-700 max-h-96 overflow-y-auto rounded p-2 text-xs leading-relaxed whitespace-pre-wrap">{promptDetails.prompt}</pre>
							{:else}
								<p class="text-surface-700-300 text-xs">
									No prompt content available.
								</p>
							{/if}
						</section>
					</div>
				{:else}
					<div class="text-surface-700-300 py-8 text-center text-sm">
						No compiled prompt data available.
					</div>
				{/if}

				<footer class="flex shrink-0 justify-end gap-4 pt-2">
					<button
						class="btn preset-tonal-surface"
						onclick={() => onOpenChange(false)}
					>
						Close
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
