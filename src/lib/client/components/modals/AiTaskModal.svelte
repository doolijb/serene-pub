<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import type { Snippet } from "svelte"

	export type AiTaskStep = "confirm" | "running" | "review" | "error"

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		title: string
		runningTitle?: string
		reviewTitle?: string
		badge?: string
		step: AiTaskStep
		progressPercent?: number
		progressLabel?: string
		canStart?: boolean
		startLabel?: string
		canSave?: boolean
		saveLabel?: string
		isSaving?: boolean
		errorMessage?: string
		hasReviewContent?: boolean
		retryLabel?: string
		onStart: () => void
		onSave: () => void
		onCancel: () => void
		onMinimize?: () => void
		onRetry: () => void
		onStartOver?: () => void
		onDiscard?: () => void
		onBack?: () => void
		onRerun?: () => void
		onViewLastResult?: () => void
		confirm?: Snippet
		preview?: Snippet
		review?: Snippet
		reviewExtra?: Snippet
		errorExtra?: Snippet
		debug?: Snippet
		size?: "md" | "lg"
	}

	let {
		open,
		onOpenChange,
		title,
		runningTitle,
		reviewTitle,
		badge,
		step,
		progressPercent = 0,
		progressLabel,
		canStart = true,
		startLabel = "Start",
		canSave = false,
		saveLabel = "Save",
		isSaving = false,
		errorMessage,
		hasReviewContent = false,
		retryLabel = "Retry",
		onStart,
		onSave,
		onCancel,
		onMinimize,
		onRetry,
		onStartOver,
		onDiscard,
		onBack,
		onRerun,
		onViewLastResult,
		confirm,
		preview,
		review,
		reviewExtra,
		errorExtra,
		debug,
		size = "md"
	}: Props = $props()
</script>

<Dialog {open} {onOpenChange}>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 p-6 shadow-xl {size === 'lg' ? 'w-[min(95vw,720px)]' : 'w-[min(95vw,600px)]'} max-h-[90vh] overflow-y-auto">
		{#if step === "confirm"}
			<header class="mb-4 flex items-center justify-between">
				<h2 class="h3">{title}</h2>
				{#if badge}<span class="badge preset-tonal-secondary text-xs">{badge}</span>{/if}
			</header>

			{@render confirm?.()}

			<footer class="mt-6 flex gap-3">
				<button class="btn preset-filled-surface-400-600" onclick={onCancel}>Cancel</button>
				<button class="btn preset-filled-primary-500 ml-auto" disabled={!canStart} onclick={onStart}>
					<Icons.Sparkles size={16} /> {startLabel}
				</button>
			</footer>

		{:else if step === "running"}
			<header class="mb-4">
				<h2 class="h3">{runningTitle ?? title + "…"}</h2>
			</header>

			<div class="space-y-2">
				<div class="flex items-center justify-between text-sm">
					<span class="text-surface-700-300">{progressLabel ?? "Working…"}</span>
					<span class="font-mono text-sm">{progressPercent}%</span>
				</div>
				<div class="bg-surface-300-700 h-2 w-full overflow-hidden rounded-full">
					<div
						class="bg-primary-500 h-full rounded-full transition-all duration-300"
						style="width: {progressPercent}%"
					></div>
				</div>
			</div>

			{#if preview}
				<div class="mt-4">{@render preview()}</div>
			{/if}

			{#if debug}
				<div class="mt-4">{@render debug()}</div>
			{/if}

			<footer class="mt-6 flex gap-3">
				<button class="btn preset-tonal-error" onclick={onCancel}>
					<Icons.Square size={16} /> Cancel
				</button>
				{#if onMinimize}
					<button class="btn preset-filled-surface-400-600 ml-auto" onclick={onMinimize}>
						<Icons.Minimize2 size={16} /> Minimize
					</button>
				{/if}
			</footer>

		{:else if step === "review"}
			<header class="mb-4 flex items-center justify-between">
				<h2 class="h3">{reviewTitle ?? "Review & Edit"}</h2>
				{#if badge}<span class="badge preset-tonal-secondary text-xs">{badge}</span>{/if}
			</header>

			{@render review?.()}

			{#if debug}
				<div class="mt-4">{@render debug()}</div>
			{/if}

			<footer class="mt-6 flex flex-wrap gap-3">
				<button class="btn preset-tonal-error" onclick={onDiscard ?? onCancel}>
					<Icons.Trash2 size={16} /> Discard
				</button>
				{#if onBack}
					<button class="btn preset-filled-surface-400-600" onclick={onBack}>
						<Icons.ChevronLeft size={16} /> Back
					</button>
				{/if}
				{#if onRerun}
					<button class="btn preset-filled-surface-400-600" onclick={onRerun}>
						<Icons.RefreshCw size={16} /> Re-run
					</button>
				{/if}
				{@render reviewExtra?.()}
				<div class="ml-auto">
					<button class="btn preset-filled-primary-500" disabled={!canSave || isSaving} onclick={onSave}>
						{#if isSaving}
							<Icons.Loader size={16} class="animate-spin" />
						{:else}
							<Icons.Save size={16} />
						{/if}
						{saveLabel}
					</button>
				</div>
			</footer>

		{:else if step === "error"}
			<header class="mb-4">
				<h2 class="h3 text-error-500">{badge ? badge + " — " : ""}Generation Failed</h2>
			</header>

			<div class="flex items-start gap-3 rounded-lg border border-error-500/30 bg-error-500/10 p-3 text-sm">
				<Icons.AlertCircle size={16} class="text-error-500 mt-0.5 shrink-0" />
				<span>{errorMessage ?? "An unknown error occurred."}</span>
			</div>

			{#if errorExtra}
				<div class="mt-3">{@render errorExtra()}</div>
			{/if}

			{#if debug}
				<div class="mt-4">{@render debug()}</div>
			{/if}

			<footer class="mt-6 flex flex-wrap gap-3">
				<button class="btn preset-filled-surface-400-600" onclick={onCancel}>Cancel</button>
				{#if hasReviewContent && onViewLastResult}
					<button class="btn preset-filled-surface-400-600" onclick={onViewLastResult}>
						<Icons.Eye size={16} /> View Last Result
					</button>
				{/if}
				{#if onStartOver}
					<button class="btn preset-filled-surface-400-600 ml-auto" onclick={onStartOver}>
						<Icons.RotateCcw size={16} /> Start Over
					</button>
				{/if}
				<button
					class="btn preset-filled-primary-500 {onStartOver ? '' : 'ml-auto'}"
					onclick={onRetry}
				>
					<Icons.RefreshCw size={16} /> {retryLabel}
				</button>
			</footer>
		{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
