<script lang="ts">
	/**
	 * 🚧 **A tie the rules feed** (ties on the graph, screen 3; rulings T2–T4,
	 * lane T2, 2026-10-23) — under the relationship's own fields when its words
	 * come from the rules (`rulesRunId`): each person's side as their session
	 * holds it — the words it reads onto the row (marked _from the rules_,
	 * read-only here) and its numbers, each with **Set…**, which never writes:
	 * it files a change the session reviews, and the row follows only when it
	 * is kept. Below, **How it changed**, read from the runs that wrote the row.
	 *
	 * Member words only: the rules, a side, a tie — never the declarations'
	 * own vocabulary.
	 */
	import { awaitReply, isReplyTimeout } from "$lib/client/utils/awaitReply"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"

	interface Props {
		relationshipId: number
		readOnly?: boolean
		/** A test's own socket; the app's otherwise. */
		socket?: Pick<ReturnType<typeof useTypedSocket>, "emit">
	}
	let { relationshipId, readOnly = false, socket = useTypedSocket() }: Props = $props()

	type Reply = Sockets.NarrativeGraph.TieSides.Response
	let reply = $state<Reply | null>(null)
	let error = $state<string | null>(null)
	/** The number being set: `<owner>|<field>` and its typed value. */
	let setting = $state<{ key: string; value: string } | null>(null)
	let filed = $state<string | null>(null)
	let busy = $state(false)

	async function load(id: number) {
		error = null
		try {
			reply = await awaitReply({
				socket,
				event: "narrativeGraph:tieSides",
				params: { relationshipId: id },
				errorEvent: "narrativeGraph:tieSides:error",
				fallbackError: "The sides of this tie could not be read.",
				match: (d) => d.relationshipId === id
			})
		} catch (e) {
			error = isReplyTimeout(e) ? "The server did not answer in time." : e instanceof Error ? e.message : String(e)
		}
	}
	$effect(() => {
		void load(relationshipId)
	})

	const percent = (n: { value: number | null; min?: number; max?: number }) => {
		const lo = n.min ?? 0
		const hi = n.max ?? 10
		return n.value === null || hi <= lo ? 0 : Math.round(((n.value - lo) / (hi - lo)) * 100)
	}
	const words = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : String(v))
	const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

	async function file(owner: string, field: string, value: string) {
		const n = Number(value)
		if (!value.trim() || !Number.isFinite(n)) {
			error = "Say a number."
			return
		}
		busy = true
		error = null
		try {
			await awaitReply({
				socket,
				event: "narrativeGraph:setTieSide",
				params: { relationshipId, owner, field, value: n },
				errorEvent: "narrativeGraph:setTieSide:error",
				fallbackError: "That number could not be set.",
				match: (d) => d.relationshipId === relationshipId
			})
			filed = `${owner}|${field}`
			setting = null
		} catch (e) {
			error = isReplyTimeout(e) ? "The server did not answer in time." : e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}
</script>

<section class="flex flex-col gap-2" aria-label="The tie's sides" data-tie-sides-block>
	{#if reply && reply.sides.length}
		{#each reply.sides as side (side.owner)}
			<article class="border-surface-200-800 flex flex-col gap-1.5 rounded-md border p-2" data-tie-side={side.owner}>
				<div class="flex flex-wrap items-baseline gap-2">
					<strong class="text-sm">{side.ownerName}'s side</strong>
					{#if side.exposed}<span class="text-surface-600-400 text-xs">shown to others</span>{/if}
				</div>
				<dl class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-x-3 gap-y-1.5 text-sm">
					{#each side.onto as o (o.field)}
						<dt class="text-surface-600-400 text-xs">{o.target === "relationship-name" ? "Name" : "Relationship type"}</dt>
						<dd class="flex flex-wrap items-center gap-1.5" data-tie-onto={o.field}>
							<span class="font-medium">{words(o.value)}</span>
							<span class="border-primary-500 text-primary-ink rounded-full border px-2 text-xs" data-from-the-rules>from the rules</span>
							<span class="text-surface-600-400 text-xs">{o.label} · read-only here</span>
						</dd>
					{/each}
					{#each side.numbers as n (n.field)}
						{@const key = `${side.owner}|${n.field}`}
						<dt class="text-surface-600-400 text-xs">{n.label}</dt>
						<dd class="flex flex-wrap items-center gap-2" data-tie-number={n.field}>
							<span
								class="bg-surface-200-800 block h-2.5 w-full max-w-40 min-w-24 flex-1 overflow-hidden rounded-full"
								role="img"
								aria-label="{n.label} {n.value ?? 'not set'}{n.max !== undefined ? ` of ${n.max}` : ''}"
							>
								<span class="bg-primary-500 block h-full" style="width: {percent(n)}%"></span>
							</span>
							<span data-tie-value>{n.value ?? "—"}</span>
							{#if !readOnly}
								{#if setting?.key === key}
									<label class="sr-only" for="set-{relationshipId}-{key}">New {n.label}</label>
									<input
										id="set-{relationshipId}-{key}"
										class="input w-20 text-sm"
										type="number"
										min={n.min}
										max={n.max}
										bind:value={setting.value}
									/>
									<button type="button" class="btn btn-sm preset-filled-primary-500" disabled={busy} onclick={() => file(side.owner, n.field, String(setting?.value ?? ""))} data-tie-file>
										File for review
									</button>
									<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => (setting = null)}>Cancel</button>
								{:else}
									<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => (setting = { key, value: String(n.value ?? "") })} data-tie-set>
										Set…
									</button>
								{/if}
								<span class="text-surface-600-400 text-xs">{filed === key ? "Filed. It changes once the session keeps it." : "files as a change for review"}</span>
							{/if}
						</dd>
					{/each}
				</dl>
			</article>
		{/each}
		<div class="flex flex-col gap-1" data-tie-history>
			<strong class="text-sm">How it changed</strong>
			{#if reply.history.length}
				<ul class="flex flex-col gap-1 text-xs">
					{#each reply.history as h, i (`${h.runId}:${h.owner}:${i}`)}
						<li class="flex gap-2">
							<span class="text-surface-600-400 shrink-0">{when(h.at)}</span>
							<span>
								{h.ownerName}{h.towardsName ? ` → ${h.towardsName}` : ""}:
								{#if h.made}on the lorebook now{/if}
								{#each h.columns as c, ci (ci)}{ci || h.made ? "; " : ""}{words(c.from)} → <strong>{words(c.to)}</strong>{/each}
								{#each Object.entries(h.moved ?? {}).filter(([, m]) => typeof m.to === "number") as [field, m] (field)}
									({words(m.from)} → {words(m.to)})
								{/each}
							</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-surface-600-400 text-xs">No changes from the rules yet.</p>
			{/if}
		</div>
	{:else if reply}
		<p class="text-surface-600-400 text-xs" data-tie-no-sides>No session holds this tie's sides now.</p>
	{/if}
	{#if error}
		<p class="text-error-600-400 text-xs" role="alert">{error}</p>
	{/if}
</section>
