<script lang="ts">
    import { Modal } from "@skeletonlabs/skeleton-svelte"

    interface Props {
        open: boolean
        onOpenChange: (e: OpenChangeDetails) => void
        onConfirm: (name: string) => void
        onCancel: () => void
        title?: string
        description?: string
    }

    let {
        open = $bindable(),
        onOpenChange,
        onConfirm,
        onCancel,
        title,
        description
    }: Props = $props()

    let name = $state("")
    let inputRef: HTMLInputElement | null = null
    $effect(() => {
        if (open && inputRef) inputRef.focus()
    })
    let isValid = $derived(!!name.trim())
</script>

<Modal
    {open}
    {onOpenChange}
    contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-sm border border-surface-300-700"
    backdropClasses="backdrop-blur-sm"
>
    {#snippet content()}
        <header class="flex justify-between">
            <h2 class="h2">{title ? title : "Create new"}</h2>
        </header>
        <article>
            {#if description}
                <p class="text-muted-foreground mb-2">{description}</p>
            {/if}
            <input
                bind:this={inputRef}
                bind:value={name}
                class="input w-full"
                type="text"
                placeholder="Enter a name..."
                onkeydown={(e) => {
                    if (e.key === "Enter" && isValid) {
                        onConfirm(name)
                    }
                }}
            />
        </article>
        <footer class="flex justify-end gap-4">
            <button class="btn preset-filled-surface-500" onclick={onCancel}>Cancel</button>
            <button
                class="btn preset-filled-primary-500"
                onclick={() => onConfirm(name)}
                disabled={!isValid}>Confirm</button
            >
        </footer>
    {/snippet}
</Modal>
