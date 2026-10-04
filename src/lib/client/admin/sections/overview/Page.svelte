<script lang="ts">
	/**
	 * The admin Overview (the admin overhaul, 2026-09-27; STYLE-GUIDE §6.11).
	 *
	 * Two things, in order: what needs you — the error and act-on-it items
	 * gathered across sections, each with the button that fixes it — and one
	 * card per area answering "is this all right?", each linking to its
	 * section. Everything comes from `admin:overview` through `adminHealth`,
	 * the same read the Admin view's dots come from, so the two cannot
	 * disagree. Asked again every time this page opens.
	 */
	import { getContext, onMount } from "svelte"
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import * as Icons from "@lucide/svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import { adminHealth } from "$lib/client/admin/adminHealth.svelte"
	import { appVersionDisplay } from "$lib/shared/constants/version"

	const userCtx: { user: SelectUser } = getContext("userCtx")

	onMount(() => {
		const disconnect = adminHealth.connect(!!userCtx.user?.isAdmin)
		// `connect` asks on the first consumer only; the Overview opening is
		// always worth a fresh read.
		if (!adminHealth.loading) adminHealth.refresh()
		return disconnect
	})

	let ov = $derived(adminHealth.overview)
	let attention = $derived(adminHealth.attention)
	let firstErrorId = $derived(attention.find((a) => a.level === "error")?.id)

	type Tone = "error" | "primary" | "success" | "surface"
	const DOT: Record<Tone, string> = {
		error: "bg-error-500",
		primary: "bg-primary-500",
		success: "bg-success-500",
		surface: "bg-surface-500"
	}

	const plural = (n: number, one: string, many = one + "s") =>
		`${n} ${n === 1 ? one : many}`

	function duration(seconds: number): string {
		const m = Math.floor(seconds / 60)
		if (m < 1) return "under a minute"
		if (m < 60) return plural(m, "minute")
		const h = Math.floor(m / 60)
		if (h < 48) return plural(h, "hour")
		return plural(Math.floor(h / 24), "day")
	}

	function ago(iso: string): string {
		const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
		return s < 60 ? "just now" : `${duration(s)} ago`
	}

	let purpose = $derived.by(() => {
		const parts = [`Serene Pub ${ov?.app.version || appVersionDisplay}`]
		if (ov) {
			parts.push(
				ov.app.accountsEnabled
					? plural(ov.people.userCount, "account")
					: "single-user mode"
			)
			parts.push(`running for ${duration(ov.app.uptimeSeconds)}`)
		}
		return parts.join(" · ")
	})

	interface Line {
		tone: Tone
		text: string
	}
	interface Card {
		title: string
		href: string
		icon: keyof typeof Icons
		lines: Line[]
		progress?: { value: number; max: number; label: string }
	}

	let cards = $derived.by((): Card[] => {
		if (!ov) return []
		const m = ov.models
		const p = ov.pipelines
		const n = ov.network
		const d = ov.data
		const x = ov.extensions
		const backupAge = d.lastBackupAt
			? Date.now() - Date.parse(d.lastBackupAt)
			: Infinity
		const staleBackup = backupAge > 48 * 60 * 60 * 1000

		return [
			{
				title: "Models",
				href: "/admin/defaults",
				icon: "Target",
				// Deliberately no fraction and no bar (docs/connections.md):
				// most jobs are optional and off is a fine answer, so only a
				// job a pipeline needs is counted.
				lines: [
					m.missing.length
						? {
								tone: "error",
								text: `${m.missing.length} needed by a pipeline and not set`
							}
						: {
								tone: "success",
								text: "Everything a pipeline needs is set"
							}
				]
			},
			{
				title: "People",
				href: ov.app.accountsEnabled
					? "/admin/users"
					: "/admin/sessions",
				icon: "Users",
				lines: [
					ov.app.accountsEnabled
						? {
								tone: "success",
								text: `Accounts on · ${plural(ov.people.userCount, "account")}`
							}
						: { tone: "surface", text: "Single-user mode" },
					{
						tone: "surface",
						text: plural(ov.people.sessionCount, "session")
					}
				]
			},
			{
				title: "Network",
				href: "/admin/network",
				icon: "Globe",
				lines: [
					!n.tunnelAvailable
						? {
								tone: "surface",
								text: "Tunnels are not available here"
							}
						: n.tunnelRunning
							? {
									tone: "success",
									text: `Tunnel running${n.tunnelHostname ? ` · ${n.tunnelHostname}` : ""}`
								}
							: n.tunnelConfigured
								? ov.app.accountsEnabled
									? { tone: "surface", text: "Tunnel off" }
									: {
											tone: "primary",
											text: "Tunnel needs accounts"
										}
								: { tone: "surface", text: "No tunnel" },
					n.wildcard
						? { tone: "primary", text: "Every host is allowed" }
						: {
								tone: "success",
								text: plural(n.allowedHostCount, "allowed host")
							}
				]
			},
			{
				title: "Data and backups",
				href: "/admin/data",
				icon: "Database",
				lines: [
					d.lastBackupAt
						? {
								tone:
									staleBackup && d.dailyBackups
										? "primary"
										: "success",
								text: `Last backup ${ago(d.lastBackupAt)}`
							}
						: {
								tone: d.dailyBackups ? "primary" : "surface",
								text: "No backups yet"
							},
					d.dailyBackups
						? { tone: "success", text: "Daily backups on" }
						: { tone: "surface", text: "Daily backups off" }
				]
			},
			{
				title: "Pipelines",
				href: "/admin/pipelines",
				icon: "Workflow",
				lines: [
					{
						tone: p.enabled > 0 ? "success" : "surface",
						text: `${p.enabled} of ${p.published} published enabled`
					},
					p.runs24h.total === 0
						? { tone: "surface", text: "No runs in the last day" }
						: p.runs24h.failed > 0
							? {
									tone: "error",
									text: `${plural(p.runs24h.failed, "run")} failed in the last day`
								}
							: {
									tone: "success",
									text: `${plural(p.runs24h.total, "run")} in the last day, none failed`
								}
				],
				...(p.runs24h.total > 0
					? {
							progress: {
								value: p.runs24h.ok,
								max: p.runs24h.total,
								label: "Runs that finished ok"
							}
						}
					: {})
			},
			{
				title: "Extensions",
				href: "/admin/plugins",
				icon: "Puzzle",
				lines: [
					x.sandboxEnabled
						? { tone: "success", text: "Plugin sandbox on" }
						: {
								tone: x.pluginCount > 0 ? "primary" : "surface",
								text: "Plugin sandbox off"
							},
					{
						tone: "surface",
						text: `${plural(x.pluginCount, "plugin")} · ${plural(x.scriptCount, "script")} · ${plural(x.componentCount, "component")}`
					}
				]
			}
		]
	})
</script>

<!-- A reading width, like the rest of the admin area: at 4K the cards
     would otherwise stretch across 3000px. -->
<div class="mx-auto w-full max-w-[1120px]">
	<AdminPageHeader title="Your pub" {purpose}>
		{#snippet actions()}
			{#if page.data?.isNewerReleaseAvailable && page.data?.canUpdateInApp}
				<!-- The launcher can apply it: Admin › Updates downloads,
				     verifies and restarts into it. -->
				<a href="/admin/updates" class="btn preset-filled-primary-500">
					<Icons.Download size={16} aria-hidden="true" />
					Update to {page.data?.latestReleaseTag ?? "the new version"}
				</a>
			{:else if page.data?.isNewerReleaseAvailable}
				<a
					href="https://github.com/doolijb/serene-pub/releases"
					target="_blank"
					rel="noopener"
					class="btn preset-tonal"
				>
					<Icons.Download size={16} aria-hidden="true" />
					Get {page.data?.latestReleaseTag ?? "the update"}
				</a>
			{/if}
		{/snippet}
	</AdminPageHeader>

	<div class="overview flex flex-col gap-3 @min-[700px]/content:gap-4">
		<section class="panel-card" aria-labelledby="needs-you-heading">
			<div class="mb-3 flex items-center gap-2">
				<h2 id="needs-you-heading" class="text-sm font-medium">
					Needs you
				</h2>
				{#if attention.length}
					<span class="text-surface-600-400 text-[11px]">
						{attention.length}
					</span>
				{/if}
			</div>
			{#if !ov}
				<p class="text-surface-600-400 flex items-center gap-2 text-sm">
					<Icons.Loader2
						size={16}
						class="animate-spin"
						aria-hidden="true"
					/>
					Checking…
				</p>
			{:else if attention.length === 0}
				<p class="flex items-center gap-2 text-sm">
					<span
						class="bg-success-500 size-2 shrink-0 rounded-full"
						aria-hidden="true"
					></span>
					Nothing needs you.
				</p>
			{:else}
				<ul class="flex flex-col gap-3">
					{#each attention as item (item.id)}
						<li class="flex flex-wrap items-start gap-3">
							<span
								class="mt-1.5 size-2 shrink-0 rounded-full {item.level ===
								'error'
									? 'bg-error-500'
									: 'bg-primary-500'}"
								aria-hidden="true"
							></span>
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium">
									<span class="sr-only">
										{item.level === "error"
											? "Problem:"
											: "To do:"}
									</span>
									{item.title}
								</p>
								<p class="text-surface-600-400 text-xs">
									{item.detail}
								</p>
							</div>
							<a
								href={item.action.href}
								class="btn btn-sm shrink-0 {item.id ===
								firstErrorId
									? 'preset-filled-primary-500'
									: 'preset-tonal'}"
							>
								{item.action.label}
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		{#if cards.length}
			<div class="overview-grid grid gap-3 @min-[700px]/content:gap-4">
				{#each cards as card (card.title)}
					{@const IconCmp = Icons[card.icon] as any}
					<a
						href={card.href}
						class="panel-card hover:border-surface-400-600 focus-visible:outline-primary-500 flex flex-col gap-3 transition-colors focus-visible:outline-2"
					>
						<div class="flex items-center gap-2">
							<IconCmp
								size={18}
								class="text-surface-600-400 shrink-0"
								aria-hidden="true"
							/>
							<h2
								class="min-w-0 flex-1 truncate text-sm font-medium"
							>
								{card.title}
							</h2>
							<Icons.ChevronRight
								size={16}
								class="text-surface-500 shrink-0"
								aria-hidden="true"
							/>
						</div>
						<ul class="flex flex-col gap-1.5">
							{#each card.lines as line, i (i)}
								<li class="flex items-start gap-2 text-[13px]">
									<span
										class="mt-[5.5px] size-2 shrink-0 rounded-full {DOT[
											line.tone
										]}"
										aria-hidden="true"
									></span>
									<span class="overview-line min-w-0 break-words">
										{line.text}
									</span>
								</li>
							{/each}
						</ul>
						{#if card.progress && card.progress.max > 0}
							<div
								class="bg-surface-200-800 mt-auto h-1.5 overflow-hidden rounded-full"
								role="progressbar"
								aria-label={card.progress.label}
								aria-valuemin={0}
								aria-valuemax={card.progress.max}
								aria-valuenow={card.progress.value}
							>
								<div
									class="bg-primary-500 h-full rounded-full"
									style="width: {(card.progress.value /
										card.progress.max) *
										100}%"
								></div>
							</div>
						{/if}
					</a>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	/* Measured on the admin content pane (`content`), never the window. */
	.overview-grid {
		grid-template-columns: minmax(0, 1fr);
	}
	/* One column (the dock): a fact wraps rather than losing its tail,
	   which is where a hostname or a count sits. In columns it truncates so
	   the cards in a row stay the same height. */
	@container content (min-width: 700px) {
		.overview-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.overview-line {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
	@container content (min-width: 1000px) {
		.overview-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
</style>
