<script lang="ts">
	/**
	 * Session data (owner-approved 2026-09-26): a look at the session's
	 * annex — for each owner (core, then each plugin) every key it declares,
	 * with its shape, who can see it, who can change it and the value stored
	 * now; then legacy keys no declaration covers. For the session's owner and
	 * administrators; the server refuses anyone else.
	 *
	 * **Editable in place** (lair re-plan R13, 2026-09-28): a text field its
	 * declaration lets people set (`act`) gets an Edit button — the way to
	 * change a value no person's view shows, like the Lair Castellan's
	 * scratchpad. Save presses the field's ready-made action
	 * (`<owner>:annex#<key>`), so the door judges it like any other press,
	 * and a refusal is shown here.
	 *
	 * Refreshed on open and by the refresh button. Not live: the annex push
	 * (`sessions:annex`) is each member's own filtered view, sent only when
	 * someone may see something, so it cannot stand in for this read.
	 */
	import { v4 as uuid } from "uuid"
	import * as Icons from "@lucide/svelte"
	import { SvelteSet } from "svelte/reactivity"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { i18nTextIn } from "$lib/shared/i18n/i18nText"
	import {
		annexAudienceWords,
		annexEditsAsText,
		annexFieldActionOf,
		annexSettersWords,
		annexShapeWords,
		annexValuePreview
	} from "$lib/shared/sessions/annexInspect"

	let { sessionId, cardClass }: { sessionId: number; cardClass: string } = $props()

	const socket = useTypedSocket()
	type View = Sockets.Sessions.AnnexInspect.Response
	let view = $state<View | null>(null)
	let error = $state<string | null>(null)
	let busy = $state(false)
	/** Values shown whole, by their element id. */
	const expanded = new SvelteSet<string>()

	/** The field being edited, by its action identity, and its draft. */
	let editing = $state<string | null>(null)
	let draft = $state("")
	let saving = $state(false)
	let editError = $state<string | null>(null)

	$effect(() => {
		const id = sessionId
		view = null
		error = null
		const take = (res: View) => {
			if (res.sessionId !== id) return
			view = res
			error = null
			busy = false
		}
		const refused = (e: Sockets.Sessions.AnnexInspect.Error) => {
			if (e.sessionId !== undefined && e.sessionId !== id) return
			error = e.error
			busy = false
		}
		const releases = [
			declareInterest<"sessions:annexInspect">(
				interestKey("sessions:annexInspect", id),
				take
			),
			declareInterest<"sessions:annexInspect:error">("sessions:annexInspect:error", refused)
		]
		busy = true
		socket.emit("sessions:annexInspect", { sessionId: id })
		return () => releases.forEach((release) => release())
	})

	// The answer to a Save: a refusal stays in the editor; anything else
	// closes it and reads the annex again.
	$effect(() => {
		const id = sessionId
		return declareInterest<"sessions:fireAction">("sessions:fireAction", (res) => {
			if (res.sessionId !== id || !editing || res.action !== editing) return
			if (res.parked) return
			saving = false
			if (res.error) {
				editError = res.error
				return
			}
			editing = null
			refresh()
		})
	})

	function startEdit(identity: string, value: unknown) {
		editing = identity
		draft = typeof value === "string" ? value : ""
		editError = null
	}

	function save() {
		if (!editing) return
		saving = true
		editError = null
		socket.emit("sessions:fireAction", {
			sessionId,
			action: editing,
			payload: { value: draft },
			runId: uuid()
		})
	}

	function refresh() {
		busy = true
		error = null
		socket.emit("sessions:annexInspect", { sessionId })
	}

	const ownerName = (owner: string) => (owner === "core" ? "Core" : owner)

	const storedCount = $derived(
		view
			? view.groups.reduce((n, g) => n + g.fields.filter((f) => f.hasValue).length, 0) +
					view.legacy.length
			: 0
	)
	const declaredGroups = $derived(view?.groups.filter((g) => g.fields.length) ?? [])
</script>

{#snippet valueOf(id: string, value: unknown)}
	{@const preview = annexValuePreview(value)}
	{@const open = expanded.has(id)}
	<pre
		id={id}
		class="bg-surface-100-900 max-h-80 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap break-all">{open
			? annexValuePreview(value, Infinity).text
			: preview.text}</pre>
	{#if preview.truncated}
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface mt-1"
			aria-expanded={open}
			aria-controls={id}
			onclick={() => (open ? expanded.delete(id) : expanded.add(id))}
		>
			{open ? "Show less" : "Show all"}
		</button>
	{/if}
{/snippet}

<section class={cardClass} aria-busy={busy} aria-labelledby="annex-panel-{sessionId}">
	<div class="mb-1 flex items-center justify-between gap-3">
		<h3 id="annex-panel-{sessionId}" class="text-sm font-medium">Session data</h3>
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface"
			onclick={refresh}
			disabled={busy}
		>
			<Icons.RefreshCw size={14} aria-hidden="true" />
			Refresh
		</button>
	</div>
	<p class="text-surface-600-400 mb-3 text-xs">
		What this session's pipelines keep, grouped by owner. A text value you may change has an
		Edit button.
	</p>

	{#if error}
		<p class="text-error-600-400 text-xs" role="alert">{error}</p>
	{:else if !view}
		<p class="text-surface-600-400 text-sm">Loading…</p>
	{:else}
		{#if storedCount === 0}
			<p class="mb-3 text-sm">This session has no stored data yet.</p>
		{/if}

		{#each declaredGroups as group, gi (group.owner)}
			<h4 class="text-surface-600-400 mt-3 mb-1 text-xs font-medium">{ownerName(group.owner)}</h4>
			<ul class="flex flex-col gap-2" aria-label="{ownerName(group.owner)} data">
				{#each group.fields as field, fi (field.key)}
					{@const label = i18nTextIn(field.label) ?? field.key}
					{@const description = i18nTextIn(field.description)}
					<li class="border-surface-200-800 rounded-md border p-2">
						<div class="flex flex-wrap items-baseline gap-x-2">
							<span class="text-sm font-medium">{label}</span>
							{#if label !== field.key}
								<code class="text-surface-600-400 font-mono text-xs">{field.key}</code>
							{/if}
						</div>
						{#if description}
							<p class="text-surface-600-400 text-xs">{description}</p>
						{/if}
						<dl class="mt-1 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
							<dt class="text-surface-600-400">Shape</dt>
							<dd>{annexShapeWords(field.shape)}</dd>
							<dt class="text-surface-600-400">Who can see it</dt>
							<dd>{annexAudienceWords(field.see)}</dd>
							<dt class="text-surface-600-400">Who can change it</dt>
							<dd>{annexSettersWords(field.act)}</dd>
							<dt class="text-surface-600-400">Value</dt>
							<dd>
								{#if field.withheld}
									Hidden: it is a secret.
								{:else if editing === annexFieldActionOf(group.owner, field.key)}
									{@const inputId = `annex-edit-${sessionId}-${gi}-${fi}`}
									<label class="sr-only" for={inputId}>{label}</label>
									<textarea
										id={inputId}
										class="textarea min-h-24 w-full font-mono text-xs"
										bind:value={draft}
										disabled={saving}
									></textarea>
									{#if editError}
										<p class="text-error-600-400 mt-1 text-xs" role="alert">{editError}</p>
									{/if}
									<div class="mt-1 flex gap-2">
										<button
											type="button"
											class="btn btn-sm preset-filled-primary-500"
											onclick={save}
											disabled={saving}
										>
											{saving ? "Saving…" : "Save"}
										</button>
										<button
											type="button"
											class="btn btn-sm preset-tonal-surface"
											onclick={() => (editing = null)}
											disabled={saving}
										>
											Cancel
										</button>
									</div>
								{:else}
									{#if !field.hasValue}
										<span class="text-surface-600-400">Not set</span>
									{:else}
										{@render valueOf(`annex-${sessionId}-${gi}-${fi}`, field.value)}
									{/if}
									{#if annexEditsAsText(field)}
										<button
											type="button"
											class="btn btn-sm preset-tonal-surface mt-1"
											onclick={() =>
												startEdit(annexFieldActionOf(group.owner, field.key), field.value)}
										>
											<Icons.Pencil size={14} aria-hidden="true" />
											Edit<span class="sr-only"> {label}</span>
										</button>
									{/if}
								{/if}
							</dd>
						</dl>
					</li>
				{/each}
			</ul>
		{/each}

		{#if view.legacy.length}
			<h4 class="text-surface-600-400 mt-3 mb-1 text-xs font-medium">Legacy</h4>
			<p class="text-surface-600-400 mb-1 text-xs">
				Stored before its owner declared it. Only pipelines can read it.
			</p>
			<ul class="flex flex-col gap-2" aria-label="Legacy data">
				{#each view.legacy as row, li (`${row.owner} ${row.key ?? ""}`)}
					<li class="border-surface-200-800 rounded-md border p-2">
						<div class="flex flex-wrap items-baseline gap-x-2">
							<span class="text-sm font-medium">{row.key ?? "Whole entry"}</span>
							<span class="text-surface-600-400 text-xs">{ownerName(row.owner)}</span>
						</div>
						{#if row.withheld}
							<p class="text-xs">Hidden: it is a secret.</p>
						{:else}
							{@render valueOf(`annex-${sessionId}-legacy-${li}`, row.value)}
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>
