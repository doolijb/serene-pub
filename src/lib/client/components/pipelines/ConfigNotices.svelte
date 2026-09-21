<script lang="ts">
	/**
	 * What publishing a new version did to this configuration.
	 *
	 * A pipeline's tuneable surface is declared by its nodes, so a new version
	 * can remove an option somebody deliberately set. The value is culled —
	 * a row addressing a field that no longer exists resolves to nothing and
	 * reads as corruption — and the cull has always been recorded. Until now
	 * nothing read it: the setting stopped applying, the panel stopped showing
	 * it, and nothing anywhere said why the pipeline started behaving
	 * differently.
	 *
	 * So this sits directly under the configuration picker, next to the thing
	 * it concerns, rather than arriving as a toast that scrolls away: the value
	 * that is gone belongs to the configuration named above it. Back-fills
	 * appear here too, quieter — they answer the same question ("why is this
	 * different today") and a reader who has to look in two places will look in
	 * neither.
	 *
	 * Dismissing writes `acknowledged_at` on the row, so a notice stays
	 * dismissed across tabs, reloads and reboots. Nothing here is remembered
	 * client-side.
	 */
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		slug: string
		/** The configuration whose notices these are; nothing renders without one. */
		configId: number | null | undefined
	}

	let { slug, configId }: Props = $props()

	const socket = useTypedSocket()

	let notices = $state<Sockets.Pipelines.ConfigNotice[]>([])

	const onNotices = (res: Sockets.Pipelines.ConfigNotices.Response) => {
		if (res.error) {
			toaster.error({ title: res.error })
			return
		}
		// A shared channel, and the picker above moves: an answer for the
		// configuration the user just switched away from is dropped rather
		// than shown against the one they are looking at now.
		if (res.configId == null || res.configId !== configId) return
		notices = res.notices ?? []
	}

	// The refusals are written for a person, so they are shown rather than
	// replaced with a status — the same rule the option writes follow.
	const showRefusal = (res: { error?: string }) => {
		if (res?.error) toaster.error({ title: res.error })
	}

	/**
	 * A STANDING interest, not a one-shot folded into the request below.
	 *
	 * `pipelines:configNotices` is also what the server cascades after an
	 * acknowledge — the re-read is how a dismissed notice leaves the panel —
	 * so the key has to be held while this component is mounted rather than
	 * only around the request it makes itself. BARE: the event has no entry in
	 * `SCOPED_EVENTS`, and `onNotices`'s own `res.configId !== configId` check
	 * stays the filter.
	 */
	useInterest<"pipelines:configNotices">("pipelines:configNotices", onNotices)
	// Never gated (plan ruling 2 — an error is not an output to skip), but the
	// registry is the only listener path, so both refusals are declared here.
	useInterest<"pipelines:configNotices:error">(
		"pipelines:configNotices:error",
		showRefusal
	)
	useInterest<"pipelines:acknowledgeConfigNotices:error">(
		"pipelines:acknowledgeConfigNotices:error",
		showRefusal
	)

	// Asked for per configuration, and re-asked when the picker moves: the
	// notices belong to the configuration, not to the pipeline. Nothing this
	// effect writes is read back inside it, so switching configurations is one
	// request rather than a pair chasing each other.
	$effect(() => {
		const id = configId
		notices = []
		if (id == null) return
		socket.emit("pipelines:configNotices", { slug, configId: id })
	})

	function dismiss(noticeId?: number) {
		if (configId == null) return
		socket.emit("pipelines:acknowledgeConfigNotices", {
			slug,
			configId,
			...(noticeId != null ? { noticeId } : {})
		})
	}

	/** A value, said briefly — the same compression the Changes table uses. */
	const fmtVal = (v: unknown): string => {
		if (v == null) return "—"
		if (typeof v === "string")
			return v.length > 80 ? `${v.slice(0, 77)}…` : v || "—"
		if (typeof v === "object") {
			const s = JSON.stringify(v)
			return s.length > 80 ? `${s.slice(0, 77)}…` : s
		}
		return String(v)
	}

	const when = (iso: string) => new Date(iso).toLocaleString()

	const culled = $derived(notices.filter((n) => n.kind === "culled"))
	const unbound = $derived(notices.filter((n) => n.kind === "unbound"))

	/** The badge word per kind — what happened, in one word. */
	const badge = (kind: Sockets.Pipelines.ConfigNotice["kind"]) =>
		kind === "culled" ? "removed" : kind === "unbound" ? "cannot run" : "added"
</script>

{#if notices.length}
	<section
		class="card preset-filled-surface-100-900 border-warning-500 space-y-2 border-l-4 p-3"
		aria-label="What the last version change did to this configuration"
	>
		<div class="flex flex-wrap items-center gap-2">
			<h3 class="flex items-center gap-1 text-sm font-semibold">
				<Icons.TriangleAlert size={15} class="text-warning-500" />
				This configuration changed with a new version
			</h3>
			{#if notices.length > 1}
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface ml-auto"
					onclick={() => dismiss()}
				>
					Dismiss all
				</button>
			{/if}
		</div>
		<p class="text-surface-600-400 text-xs">
			{#if culled.length}
				A published version no longer has {culled.length === 1
					? "a setting this configuration held"
					: "settings this configuration held"}, so
				{culled.length === 1 ? "its value was" : "their values were"}
				removed. What {culled.length === 1 ? "it" : "they"} held is kept
				below.
			{:else if unbound.length}
				This pipeline places {unbound.length === 1 ? "a node" : "nodes"}
				this build does not run. A run stops there until the node is
				bound or taken out of the pipeline.
			{:else}
				New settings arrived at the values the pipeline ships.
			{/if}
		</p>
		<ul class="flex flex-col gap-1">
			{#each notices as n (n.id)}
				<li
					class="preset-tonal-surface flex flex-wrap items-center gap-2 rounded p-2 text-sm"
				>
					<span
						class="{n.kind === 'culled' || n.kind === 'unbound'
							? 'preset-tonal-warning'
							: 'preset-tonal-surface'} rounded-full px-2 py-0.5 text-[0.68rem]"
					>
						{badge(n.kind)}
					</span>
					<span class="font-medium">{n.label}</span>
					{#if n.kind === "culled"}
						<span class="text-surface-600-400 text-xs">
							was
							<code class="font-mono">
								{fmtVal(n.previousValue)}
							</code>
						</span>
					{/if}
					<span
						class="text-surface-600-400 ml-auto text-xs whitespace-nowrap"
					>
						{when(n.at)}
					</span>
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface"
						title="Dismiss this notice for good"
						onclick={() => dismiss(n.id)}
					>
						<Icons.Check size={14} /> Dismiss
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}
