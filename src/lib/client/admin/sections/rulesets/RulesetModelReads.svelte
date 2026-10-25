<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	/**
	 * 🚧 **What the model will read** (PLAN-rulesets-functions D8, lane A4,
	 * 2026-10-23): sticky beside every section, the draft AS IT STANDS
	 * (unsaved edits included) read for the scene's party — one text, the way
	 * a prompt holds it — with How strict picked here and a **prompt cost**
	 * meter: its tokens against a guide (`PROMPT_COST_GUIDE`). Nothing is
	 * saved and no model is asked (`rulesets:tryOut`). Under it, **Next, if
	 * you want it**: what the draft could take next.
	 *
	 * ⏳ Until the engine reads the seven sections (lane A1), the server's
	 * stand-in block carries the sentences (`tryOut.ts`, `sections`).
	 */
	import * as Icons from "@lucide/svelte"
	import type { Rigour } from "@serene-pub/sdk"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { rigourLabel } from "$lib/shared/rulesets/rigourLabels"
	import RulesetInlinePick from "./RulesetInlinePick.svelte"
	import type { Json } from "./rulesetFormParts"
	import { refusalOf, runTryOut } from "./rulesetRun"
	import { PROMPT_COST_GUIDE, promptText, promptTokens, type TryOutParams, type TryOutResult } from "./rulesetScene"
	import type { ViewId } from "./rulesetWords"

	interface Props {
		rulesetId: string
		/** The draft as it stands; null runs what is saved (or the rules as written). */
		document: Json | null
		party: NonNullable<TryOutParams["party"]>
		rigour: Rigour
		onRigour: (r: Rigour) => void
		next: readonly { view: ViewId; link: string; why: string }[]
		onGo: (view: ViewId) => void
	}
	let { rulesetId, document, party, rigour, onRigour, next, onGo }: Props = $props()

	const socket = useTypedSocket()
	let result = $state.raw<TryOutResult | null>(null)
	let refusal = $state<{ sentence: string; findings: string[] } | null>(null)
	let running = $state(false)

	const key = $derived(JSON.stringify({ rulesetId, rigour, party, ...(document ? { document } : {}) }))
	let seq = 0

	$effect(() => {
		const sent = key
		const params = JSON.parse(sent) as TryOutParams
		const mine = ++seq
		running = true
		const timer = setTimeout(async () => {
			try {
				const r = await runTryOut(socket, params)
				if (mine !== seq) return
				result = r
				refusal = null
			} catch (e) {
				if (mine !== seq) return
				result = null
				refusal = refusalOf(e)
			} finally {
				if (mine === seq) running = false
			}
		}, 450)
		return () => clearTimeout(timer)
	})

	const text = $derived(promptText(result))
	const tokens = $derived(promptTokens(result))
	const share = $derived(Math.min(100, Math.round((tokens / PROMPT_COST_GUIDE) * 100)))
	const names = $derived(party.map((m) => m.name).filter(Boolean) as string[])
	const RIGOURS: Rigour[] = ["prose", "mechanics", "scripts"]
</script>

<div class="flex min-w-0 flex-col gap-3">
	<aside class="panel-card flex min-w-0 flex-col gap-2.5" aria-labelledby="model-reads-heading" data-model-reads>
		<div class="flex flex-wrap items-baseline justify-between gap-2">
			<h2 id="model-reads-heading" class="text-sm font-medium">What the model will read</h2>
			<span class="text-surface-600-400 flex items-center gap-1 text-xs">
				How strict:
				<RulesetInlinePick
					id="model-reads-strict"
					label="How strict, for what the model will read"
					choices={RIGOURS.map((r) => ({ value: r, label: rigourLabel(r) }))}
					value={rigour}
					onchange={(v) => onRigour(v as Rigour)}
				/>
				{#if running}<Icons.LoaderCircle size={12} class="animate-spin" aria-label="Reading the draft" />{/if}
			</span>
		</div>
		<FieldHelp>
			For {names.length ? (names.length === 1 ? `a sample character, ${names[0]}` : `the scene's party: ${names.join(", ")}`) : "a sample character"}{document
				? ", with your unsaved changes"
				: ""}. Nothing is saved, no model is asked.
		</FieldHelp>
		{#if refusal}
			<div class="flex flex-col gap-1" role="status" data-model-reads-refused>
				<p class="text-warning-700-300 text-sm">{refusal.sentence || "The draft cannot be read yet."}</p>
				{#if refusal.findings.length}
					<ul class="text-surface-600-400 flex list-disc flex-col gap-0.5 pl-4 text-xs">
						{#each refusal.findings.slice(0, 6) as f, i (i)}<li>{f}</li>{/each}
					</ul>
					{#if refusal.findings.length > 6}<FieldHelp>And {refusal.findings.length - 6} more, under Check and publish.</FieldHelp>{/if}
				{/if}
			</div>
		{:else if result}
			<pre class="bg-surface-100-900 max-h-96 overflow-auto rounded-md px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap" data-model-reads-text>{text ||
					"Nothing yet: with nothing declared, the model reads no rules at all."}</pre>
			<div class="flex flex-col gap-1" data-prompt-cost>
				<div class="text-surface-600-400 flex justify-between gap-2 text-xs">
					<span id="prompt-cost-label">Prompt cost</span>
					<span class="tabular-nums">{tokens.toLocaleString("en")} tokens of {PROMPT_COST_GUIDE.toLocaleString("en")} suggested</span>
				</div>
				<div
					class="bg-surface-200-800 h-1.5 overflow-hidden rounded-full"
					role="meter"
					aria-labelledby="prompt-cost-label"
					aria-valuemin={0}
					aria-valuemax={PROMPT_COST_GUIDE}
					aria-valuenow={Math.min(tokens, PROMPT_COST_GUIDE)}
					aria-valuetext="{tokens} tokens"
				>
					<div class="h-full rounded-full {tokens > PROMPT_COST_GUIDE ? 'bg-warning-500' : 'bg-primary-500'}" style="width: {Math.max(share, tokens ? 2 : 0)}%"></div>
				</div>
			</div>
		{:else}
			<p class="text-surface-600-400 text-xs">Reading the draft…</p>
		{/if}
	</aside>
	{#if next.length}
		<div class="panel-card flex flex-col gap-1.5 text-sm" data-next-steps>
			<h3 class="text-sm font-medium">Next, if you want it</h3>
			<ul class="flex list-disc flex-col gap-1 pl-4">
				{#each next as n (n.view + n.link)}
					<li>
						<button type="button" class="text-primary-ink underline underline-offset-2" onclick={() => onGo(n.view)}>{n.link}</button>
						{n.why}
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>
