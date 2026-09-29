<script lang="ts">
	/**
	 * The support report (`admin:supportReport`) — one redacted Markdown
	 * document describing this install, to paste into a bug report or hand
	 * to an AI assistant. Built when the card opens and again on Refresh;
	 * never stored. The browser adds only what the server cannot know: its
	 * user agent, language, time zone and window size.
	 */
	import { untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import {
		declareInterest,
		requestWithInterest
	} from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"

	type Report = Sockets.Admin.SupportReport.Response

	let report: Report | null = $state(null)
	let loading = $state(false)
	let failed: string | null = $state(null)
	let release: (() => void) | null = null
	/** Resolvers waiting on the report in flight (a Copy pressed while it loads). */
	let waiting: Array<(r: Report | null) => void> = []

	function browserFacts(): Sockets.Admin.SupportReport.Params {
		let timeZone: string | undefined
		try {
			timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
		} catch {
			timeZone = undefined
		}
		return {
			userAgent: navigator.userAgent,
			language: navigator.language,
			timeZone,
			viewport: `${window.innerWidth}×${window.innerHeight}`
		}
	}

	function settle(r: Report | null) {
		loading = false
		release?.()
		release = null
		const w = waiting
		waiting = []
		for (const resolve of w) resolve(r)
	}

	function refresh(): Promise<Report | null> {
		const done = new Promise<Report | null>((resolve) => waiting.push(resolve))
		if (loading) return done
		loading = true
		failed = null
		// Each request its own handler: the registry dedupes by reference.
		const onReply = (data: Report) => {
			report = data
			settle(data)
		}
		release = requestWithInterest("admin:supportReport", browserFacts(), onReply)
		return done
	}

	function onError(data: { error?: string }) {
		if (!loading) return
		failed = data?.error || "The report could not be made."
		settle(null)
	}

	$effect(() => {
		const off = declareInterest<"admin:supportReport:error">(
			"admin:supportReport:error",
			onError
		)
		// Untracked: `refresh` reads `loading`, and this effect must run once.
		untrack(() => refresh())
		return () => {
			off()
			release?.()
		}
	})

	/** `navigator.clipboard` needs a secure context; a LAN address over http is not one. */
	async function writeClipboard(text: string): Promise<boolean> {
		try {
			if (navigator.clipboard && window.isSecureContext) {
				await navigator.clipboard.writeText(text)
				return true
			}
		} catch {
			// Fall through to the selection copy.
		}
		const area = document.createElement("textarea")
		area.value = text
		area.setAttribute("readonly", "")
		area.style.position = "fixed"
		area.style.opacity = "0"
		document.body.appendChild(area)
		area.select()
		let ok = false
		try {
			ok = document.execCommand("copy")
		} catch {
			ok = false
		}
		document.body.removeChild(area)
		return ok
	}

	async function copy() {
		const r = report ?? (await refresh())
		if (!r) return
		if (await writeClipboard(r.markdown))
			toaster.success({ title: "Support report copied" })
		else
			toaster.error({
				title: "Could not copy",
				description: "Select the text in the preview and copy it yourself."
			})
	}

	function stamp(iso: string): string {
		return iso.slice(0, 16).replace("T", "-").replace(":", "")
	}

	async function download() {
		const r = report ?? (await refresh())
		if (!r) return
		const blob = new Blob([r.markdown], { type: "text/markdown;charset=utf-8" })
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		a.download = `serene-pub-support-report-${stamp(r.generatedAt)}.md`
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(url)
	}

	const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`
</script>

<section class="panel-card flex flex-col gap-3" aria-labelledby="support-report-heading">
	<h2 id="support-report-heading" class="text-sm font-medium">Support report</h2>
	<p class="text-surface-600-400 text-sm">
		Everything a bug report needs about this install — versions, settings,
		connections, plugins, recent failures and server warnings — in one
		document you can paste into an issue or give to an AI assistant. Keys,
		passwords, email addresses, user names, addresses and home folder paths
		are removed before it leaves the server. Read it before you share it.
	</p>

	<div class="flex flex-wrap items-center gap-2">
		<button
			type="button"
			class="btn preset-filled-primary-500"
			onclick={copy}
			disabled={loading && !report}
		>
			<Icons.Copy size={16} aria-hidden="true" />
			Copy report
		</button>
		<button
			type="button"
			class="btn preset-tonal-surface"
			onclick={download}
			disabled={loading && !report}
		>
			<Icons.Download size={16} aria-hidden="true" />
			Download .md
		</button>
		<button
			type="button"
			class="btn preset-tonal-surface"
			onclick={() => refresh()}
			disabled={loading}
		>
			<Icons.RefreshCw size={16} aria-hidden="true" class={loading ? "animate-spin" : ""} />
			Refresh
		</button>
		<span class="text-surface-600-400 text-xs" aria-live="polite">
			{#if loading}
				Gathering…
			{:else if report}
				Made {new Date(report.generatedAt).toLocaleTimeString()} · {kb(report.bytes)}
			{/if}
		</span>
	</div>

	{#if failed}
		<p class="text-error-600-400 text-sm" role="alert">{failed}</p>
	{/if}

	{#if report}
		<!-- Focusable so a keyboard can scroll it (a scrollable region with
		     nothing focusable inside is unreachable otherwise). -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<pre
			class="bg-surface-50-950 border-surface-200-800 max-h-96 overflow-auto rounded-[10px] border p-3 font-mono text-xs whitespace-pre-wrap break-words"
			tabindex="0"
			role="region"
			aria-label="Support report preview">{report.markdown}</pre>
	{/if}
</section>
