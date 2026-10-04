<script lang="ts">
	import { docsHref } from "$lib/shared/utils/docsHref"
	/**
	 * Pub › Network: plan 26, how this instance becomes reachable from
	 * outside, and which origins it trusts. `/admin/servers` redirects here.
	 *
	 * Two modes, not a provider dropdown. "Easy" is one switch and no account;
	 * "Custom domain" is the persistent one. The mode split is the product
	 * decision — `provider` and `mode` are derived from it rather than picked,
	 * so nobody can save a combination the supervisor can't run.
	 */
	import { onDestroy } from "svelte"
	import { adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import * as Icons from "@lucide/svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import SettingSwitch from "$lib/client/components/admin/pub/SettingSwitch.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import {
		DEFAULT_TUNNEL_TTL_SECONDS,
		MAX_TUNNEL_TTL_SECONDS,
		MIN_TUNNEL_TTL_SECONDS,
		TUNNEL_TTL_PRESET_HOURS,
		TunnelProviders
	} from "$lib/shared/constants/Tunnels"

	const socket = useTypedSocket()
	// The admin-only half of the registry (plan ruling 6b): `tunnels:` and
	// `allowedHosts:` are RESTRICTED interest families, and this context
	// exists only inside the admin tree, which already turns non-admins away.
	const interest = getAdminInterestContext()

	let tunnel = $state<Sockets.Tunnels.TunnelView | null>(null)
	let available = $state(true)
	let unavailableReason = $state<string | undefined>(undefined)
	let accountsEnabled = $state(false)
	let loading = $state(true)
	let busy = $state(false)
	/**
	 * Set while a start is in flight.
	 *
	 * Starting a tunnel means downloading cloudflared on first run, spawning
	 * it, and waiting for Cloudflare to hand back a URL — up to a minute, with
	 * the socket handler awaiting the whole thing. Without an indicator the
	 * page simply sits there and reads as broken.
	 */
	let starting = $state(false)
	let pollTimer: ReturnType<typeof setInterval> | null = null

	let allowedHosts = $state<Sockets.AllowedHosts.HostEntry[]>([])
	let wildcard = $state(false)

	function handleAllowedHosts(res: Sockets.AllowedHosts.Get.Response) {
		allowedHosts = res.hosts
		wildcard = res.wildcard
	}

	const SOURCE_LABELS: Record<string, string> = {
		builtin: "Built in",
		env: "ALLOWED_ORIGINS",
		tunnel: "Active tunnel"
	}

	// Form state, kept separate from the row so an unsaved edit is never
	// mistaken for saved configuration.
	let mode: "easy" | "custom" = $state("easy")
	let hostnameField = $state("")
	let tokenField = $state("")
	let autoStart = $state(false)
	let ttlEnabled = $state(true)
	/** Edited in hours — the unit people actually think in for this. */
	let ttlHours = $state(DEFAULT_TUNNEL_TTL_SECONDS / 3600)

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer)
			pollTimer = null
		}
	}

	/**
	 * The configuration form as Save sends it. `tunnels:get` is re-sent while
	 * a tunnel starts (the poll below) and after every write, so the form
	 * follows the row only while it is clean — a poll landing mid-edit used
	 * to overwrite what was being typed.
	 */
	type TunnelForm = {
		mode: "easy" | "custom"
		hostname: string
		ttlSeconds: number | null
		autoStart: boolean
		/** Write-only: never repopulated, so anything typed is an edit. */
		credential: string
	}
	const edits = new UnsavedEdits(
		(): TunnelForm => ({
			mode,
			hostname: mode === "custom" ? hostnameField.trim() : "",
			ttlSeconds: ttlEnabled ? ttlSecondsValue : null,
			autoStart,
			credential: tokenField.trim()
		})
	)
	adminUnsavedEdits(() => edits.dirty)

	function tunnelFormOf(t: Sockets.Tunnels.TunnelView | null): TunnelForm {
		if (!t)
			// 26 §13.1: Easy defaults TTL on, Custom defaults it off —
			// persistence is the entire reason to choose a named tunnel.
			return {
				mode: "easy",
				hostname: "",
				ttlSeconds: DEFAULT_TUNNEL_TTL_SECONDS,
				autoStart: false,
				credential: ""
			}
		const m = t.provider === TunnelProviders.CLOUDFLARE_QUICK ? "easy" : "custom"
		return {
			mode: m,
			hostname: m === "custom" ? (t.hostname ?? "") : "",
			ttlSeconds: t.ttlSeconds,
			autoStart: t.autoStart,
			credential: ""
		}
	}
	function applyTunnelForm(f: TunnelForm, hostname: string | null) {
		mode = f.mode
		hostnameField = hostname ?? ""
		autoStart = f.autoStart
		ttlEnabled = f.ttlSeconds !== null
		if (f.ttlSeconds !== null) ttlHours = f.ttlSeconds / 3600
		tokenField = ""
	}

	function handleGet(res: Sockets.Tunnels.Get.Response) {
		tunnel = res.tunnel
		available = res.available
		unavailableReason = res.unavailableReason
		accountsEnabled = res.accountsEnabled
		loading = false
		edits.adoptSaved(tunnelFormOf(res.tunnel), (f) =>
			applyTunnelForm(f, res.tunnel?.hostname ?? null)
		)

		// The supervisor owns `status`, so it is the authority on whether a
		// start is still in progress — not the click that began it.
		if (res.tunnel?.status !== "starting") {
			starting = false
			stopPolling()
		}
	}

	function handleError(res: Sockets.ErrorResponse) {
		busy = false
		starting = false
		stopPolling()
		toaster.error({ title: res.error })
	}

	// One error event per operation, not a wildcard: the socket layer emits
	// `{event}:error`, and each of these carries a message worth showing
	// verbatim (accounts are off, the token was rejected, bad hostname).
	const ERROR_EVENTS = [
		"tunnels:get:error",
		"tunnels:updateConfig:error",
		"tunnels:enable:error",
		"tunnels:disable:error",
		"allowedHosts:get:error"
	] as const

	/**
	 * One key per refusal, declared in a loop at init — the same list the
	 * `socket.on` loop walked. `:error` events are never gated (plan ruling
	 * 2), so these are held for the page's life and simply toast whatever
	 * arrives. BARE: a tunnel is the instance's.
	 */
	for (const e of ERROR_EVENTS) {
		interest.useInterest<"tunnels:get:error">(e, handleError)
	}

	/**
	 * The two reads, each asked for and listened for in one, and both
	 * STANDING: `tunnels:get` is re-asked by the poll below and re-emitted by
	 * the server after enable/disable/updateConfig, and `allowedHosts:get`
	 * changes when a tunnel does.
	 */
	$effect(() => {
		const releases = [
			interest.requestWithInterest("tunnels:get", {}, handleGet),
			interest.requestWithInterest(
				"allowedHosts:get",
				{},
				handleAllowedHosts
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	onDestroy(stopPolling)

	const ttlSecondsValue = $derived(Math.round((ttlHours || 0) * 3600))
	const ttlOutOfRange = $derived(
		ttlEnabled &&
			(ttlSecondsValue < MIN_TUNNEL_TTL_SECONDS ||
				ttlSecondsValue > MAX_TUNNEL_TTL_SECONDS)
	)

	const isRunning = $derived(
		tunnel?.status === "running" || tunnel?.status === "starting"
	)
	const publicUrl = $derived(
		tunnel?.hostname ? `https://${tunnel.hostname}` : null
	)

	/**
	 * The deadline of the *current run*, not the saved preference — a running
	 * tunnel should show when it actually stops rather than restating the
	 * setting. A deadline nobody can see is how a tunnel dies mid-session with
	 * no warning.
	 */
	const expiresAtLabel = $derived.by(() => {
		if (!tunnel?.expiresAt || !isRunning) return null
		return new Date(tunnel.expiresAt).toLocaleString()
	})

	// The one state plan 26 §5 makes unreachable, surfaced rather than hidden:
	// the Start button explains itself in one line, with a link to the fix
	// where the fix is somewhere else, instead of failing on click.
	const enableBlocked = $derived.by(
		(): { reason: string; fix?: { href: string; label: string } } | null => {
			if (!available)
				return { reason: unavailableReason ?? "Tunnels are unavailable here." }
			if (!accountsEnabled)
				return {
					reason: "A public address needs user accounts.",
					fix: {
						href: "/admin/general#accounts",
						label: "Turn accounts on first"
					}
				}
			if (!tunnel) return { reason: "Save the configuration first." }
			return null
		}
	)

	/** The status line: a dot plus words, never colour alone. */
	const statusLine = $derived.by((): { dot: string; words: string } => {
		if (starting || tunnel?.status === "starting")
			return { dot: "bg-primary-500", words: "Starting" }
		if (tunnel?.status === "running")
			return { dot: "bg-success-500", words: "Running" }
		if (tunnel?.status === "error")
			return { dot: "bg-error-500", words: "Failed" }
		return { dot: "bg-surface-500", words: tunnel ? "Stopped" : "Not set up" }
	})

	function saveConfig() {
		busy = true
		socket.emit("tunnels:updateConfig", {
			provider:
				mode === "easy"
					? TunnelProviders.CLOUDFLARE_QUICK
					: TunnelProviders.CLOUDFLARE_NAMED,
			mode: mode === "easy" ? "ephemeral" : "persistent",
			hostname: mode === "custom" ? hostnameField.trim() : null,
			ttlSeconds: ttlEnabled ? Math.round(ttlHours * 3600) : null,
			autoStart,
			// Omitted when blank so a save never wipes a stored token — the
			// field is write-only, so the client cannot round-trip it.
			...(tokenField.trim() ? { credential: tokenField.trim() } : {})
		})
		// Sent; the field is write-only, so the echo cannot fill it back in.
		tokenField = ""
		busy = false
	}

	function toggleTunnel(next: boolean) {
		busy = true
		if (next) {
			starting = true
			// The enable ack does not arrive until the tunnel is up or has
			// failed, so poll for the row's own status in the meantime — that
			// is what surfaces a restart or an error while waiting.
			stopPolling()
			pollTimer = setInterval(() => socket.emit("tunnels:get", {}), 2000)
		}
		socket.emit(next ? "tunnels:enable" : "tunnels:disable", {})
		busy = false
		// A tunnel coming up or going down changes which hostname this
		// instance answers on, so the list below is stale the moment it does.
		socket.emit("allowedHosts:get", {})
	}

	async function copyLink() {
		if (!publicUrl) return
		await navigator.clipboard.writeText(publicUrl)
		toaster.success({ title: "Link copied" })
	}
</script>

<div class="mx-auto flex w-full max-w-[820px] flex-col">
	<AdminPageHeader
		title="Network"
		doc={docsHref("system-settings", "network")}
		purpose="How this pub is reached from outside your network, and which addresses it trusts."
	/>

	<div class="flex flex-col gap-4">
		{#if wildcard}
			<!-- Deliberately above the tunnel card and outside the loading
			     branch. Letting an admin read a carefully attributed host list
			     that is not being consulted at all is worse than not showing
			     the list. -->
			<div
				class="panel-card border-warning-500 flex items-start gap-3"
				role="note"
			>
				<Icons.TriangleAlert
					size={20}
					class="text-warning-600-400 mt-0.5 shrink-0"
				/>
				<div class="text-sm">
					<p class="font-medium">
						The origin allowlist is switched off entirely.
					</p>
					<p class="text-surface-600-400">
						<code>ALLOWED_ORIGINS=*</code>
						is set in this pub's environment, so every origin is
						accepted and the hosts listed below have no effect. This is
						a legitimate choice when a reverse proxy or Docker port
						mapping already decides what can reach this pub — but
						it is not the app's default, and nothing here will narrow it
						until that variable changes.
					</p>
				</div>
			</div>
		{/if}

		{#if loading}
			<p class="text-surface-600-400 text-sm">Loading…</p>
		{:else if !available}
			<section class="panel-card flex flex-col gap-2" aria-labelledby="tunnel-heading">
				<h2 id="tunnel-heading" class="text-sm font-medium">Tunnel</h2>
				<p class="text-surface-600-400 text-sm">{unavailableReason}</p>
			</section>
		{:else}
			<section class="panel-card flex flex-col gap-4" aria-labelledby="tunnel-heading">
				<div class="flex flex-col gap-1">
					<h2 id="tunnel-heading" class="text-sm font-medium">Tunnel</h2>
					<p class="text-surface-600-400 text-sm">
						Make this pub reachable from outside your network,
						without port forwarding.
					</p>
				</div>

				<!-- Status line -->
				<div class="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
					<span class="size-2 shrink-0 rounded-full {statusLine.dot}" aria-hidden="true"></span>
					<span class="font-medium">{statusLine.words}</span>
					{#if publicUrl && tunnel?.status === "running"}
						<span class="text-surface-600-400">at</span>
						<a
							href={publicUrl}
							target="_blank"
							rel="noreferrer"
							class="anchor max-w-full min-w-0 truncate"
						>
							{publicUrl}
						</a>
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface shrink-0"
							onclick={copyLink}
						>
							<Icons.Copy size={14} /> Copy link
						</button>
					{/if}
				</div>
				{#if tunnel?.lastError}
					<p class="text-error-600-400 text-sm">{tunnel.lastError}</p>
				{/if}

				<!-- Mode. Switching while something is running would orphan
				     the live process, so it is locked until the tunnel stops. -->
				<div class="flex flex-col gap-2">
					<span id="tunnel-mode-label" class="text-surface-600-400 text-xs">Mode</span>
					<div class="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="tunnel-mode-label">
						{#each [{ id: "easy", label: "Easy" }, { id: "custom", label: "Custom domain" }] as opt (opt.id)}
							<button
								type="button"
								role="radio"
								aria-checked={mode === opt.id}
								disabled={isRunning}
								class="btn btn-sm {mode === opt.id
									? 'preset-tonal-primary'
									: 'preset-tonal-surface'}"
								onclick={() => (mode = opt.id as "easy" | "custom")}
							>
								{opt.label}
							</button>
						{/each}
					</div>
					{#if mode === "easy"}
						<p class="text-surface-600-400 text-sm">
							A free Cloudflare quick tunnel. No account, no domain —
							but the address is random and <strong>
								changes every time the tunnel restarts
							</strong>
							, so the link you share is good for this session only.
						</p>
					{:else}
						<p class="text-surface-600-400 text-sm">
							Your own domain on a free Cloudflare account. The address
							is stable across restarts. In the Cloudflare dashboard,
							point the tunnel's public hostname at
							<code>http://localhost:{"{PORT}"}</code>
							— the same port this page is served on.
						</p>
						<label class="label">
							<span class="label-text text-surface-600-400 text-xs">
								Public hostname
							</span>
							<input
								type="text"
								class="input"
								placeholder="chat.example.com"
								disabled={isRunning}
								bind:value={hostnameField}
							/>
						</label>
						<label class="label">
							<span class="label-text text-surface-600-400 text-xs">
								Connector token
								{#if tunnel?.credentialSet}
									— saved; leave blank to keep it
								{/if}
							</span>
							<input
								type="password"
								class="input"
								placeholder={tunnel?.credentialSet
									? "••••••••"
									: "Paste the connector token"}
								disabled={isRunning}
								bind:value={tokenField}
							/>
						</label>
					{/if}
				</div>

				<!-- Stop after: preset chips, Never, or any hours in range. -->
				<div class="flex flex-col gap-2">
					<span id="tunnel-ttl-label" class="text-surface-600-400 text-xs">
						Stop automatically after
					</span>
					<div class="flex flex-wrap items-center gap-2" role="group" aria-labelledby="tunnel-ttl-label">
						{#each TUNNEL_TTL_PRESET_HOURS as preset (preset)}
							<button
								type="button"
								disabled={isRunning}
								aria-pressed={ttlEnabled && ttlHours === preset}
								class="btn btn-sm {ttlEnabled && ttlHours === preset
									? 'preset-tonal-primary'
									: 'preset-tonal-surface'}"
								onclick={() => {
									ttlEnabled = true
									ttlHours = preset
								}}
							>
								{preset}h
							</button>
						{/each}
						<button
							type="button"
							disabled={isRunning}
							aria-pressed={!ttlEnabled}
							class="btn btn-sm {!ttlEnabled
								? 'preset-tonal-primary'
								: 'preset-tonal-surface'}"
							onclick={() => (ttlEnabled = false)}
						>
							Never
						</button>
						{#if ttlEnabled}
							<label class="flex items-center gap-2 text-sm">
								<input
									type="number"
									aria-label="Hours before the tunnel stops"
									class="input w-24"
									min={MIN_TUNNEL_TTL_SECONDS / 3600}
									max={MAX_TUNNEL_TTL_SECONDS / 3600}
									step="0.25"
									disabled={isRunning}
									bind:value={ttlHours}
								/>
								hours
							</label>
						{/if}
					</div>
					{#if ttlEnabled && ttlOutOfRange}
						<p class="text-error-600-400 text-sm">
							Choose between {MIN_TUNNEL_TTL_SECONDS / 60} minutes and
							{MAX_TUNNEL_TTL_SECONDS / 86400} days — or choose Never for
							a tunnel that should stay up.
						</p>
					{/if}
					{#if ttlEnabled && expiresAtLabel}
						<p class="text-surface-600-400 text-sm">
							This tunnel stops at {expiresAtLabel}.
						</p>
					{/if}
				</div>

				<div class="flex flex-col gap-1">
					<SettingSwitch
						name="tunnel-autostart"
						label="Start when the app starts"
						checked={autoStart}
						disabled={isRunning}
						onCheckedChange={(e) => (autoStart = e.checked)}
					/>
					{#if autoStart && mode === "easy"}
						<p class="text-surface-600-400 text-sm">
							On Easy mode this brings the tunnel back after a
							restart, but with a new address — the old link stops
							working.
						</p>
					{/if}
				</div>

				{#if isRunning && !starting}
					<p class="text-surface-600-400 text-sm">
						Stop the tunnel to change its configuration.
					</p>
				{/if}

				<div class="flex flex-wrap items-center gap-2">
					<button
						type="button"
						class="btn {isRunning
							? 'preset-tonal-error'
							: 'preset-filled-primary-500'}"
						disabled={busy ||
							starting ||
							(!isRunning && !!enableBlocked)}
						onclick={() => toggleTunnel(!isRunning)}
					>
						{#if starting}
							<Icons.Loader2 size={16} class="animate-spin" />
							Starting…
						{:else if isRunning}
							<Icons.Square size={16} /> Stop tunnel
						{:else}
							<Icons.Play size={16} /> Start tunnel
						{/if}
					</button>
					<button
						type="button"
						class="btn preset-tonal-surface"
						disabled={busy || isRunning || ttlOutOfRange}
						onclick={saveConfig}
					>
						Save configuration
					</button>
					{#if !isRunning && enableBlocked}
						<p class="text-surface-600-400 text-sm">
							{enableBlocked.reason}
							{#if enableBlocked.fix}
								<a class="anchor" href={enableBlocked.fix.href}>
									{enableBlocked.fix.label}
								</a>
							{/if}
						</p>
					{/if}
				</div>

				{#if starting}
					<p class="text-surface-600-400 text-sm">
						Waiting for Cloudflare to assign an address. The first
						start also downloads <code>cloudflared</code>
						, so this can take up to a minute.
					</p>
				{/if}
			</section>

			<section class="panel-card flex flex-col gap-3" aria-labelledby="hosts-heading">
				<div class="flex flex-col gap-1">
					<h2 id="hosts-heading" class="text-sm font-medium">Allowed hosts</h2>
					<p class="text-surface-600-400 text-sm">
						Which origins may open a realtime connection to this
						pub, and where each one comes from.
					</p>
				</div>

				<!-- Stated as a rule, not rendered as a list entry. An Origin
				     matching the request's own Host is allowed without
				     appearing anywhere, so inventing a row for it would name a
				     hostname nobody configured. -->
				<div class="bg-surface-50-950 rounded-[10px] p-3 text-sm">
					<p class="font-medium">Any host you reach this app on</p>
					<p class="text-surface-600-400">
						A page and its realtime connection are served from the
						same address, so a browser tab is always allowed to connect
						back to wherever it loaded from — your LAN IP, a custom
						domain, a tunnel. This needs no configuration and covers
						almost every setup; the entries below are the additions on
						top.
					</p>
				</div>

				<ul class="flex flex-col gap-2">
					{#each allowedHosts as host (host.hostname)}
						<li
							class="bg-surface-50-950 flex items-center justify-between gap-3 rounded-[10px] px-3 py-2"
						>
							<code class="min-w-0 truncate text-sm" title={host.hostname}>{host.hostname}</code>
							<span class="badge preset-tonal-surface shrink-0 text-xs">
								{SOURCE_LABELS[host.source] ?? host.source}
							</span>
						</li>
					{/each}
				</ul>

				<p class="text-surface-600-400 text-xs">
					This list is read-only. Every entry is configured somewhere
					with more authority than this page — the process environment,
					or the tunnel that is currently running — so editing it here
					would only last until the next restart.
				</p>
			</section>
		{/if}
	</div>
</div>
