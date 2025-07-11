<script lang="ts">
    import { Modal } from "@skeletonlabs/skeleton-svelte"
    
    interface Props {
        open: boolean;
        onOpenChange: (e: OpenChangeDetails) => void;
        onConfirm: () => void;
        onCancel: () => void;
    }

    let { 
        open = $bindable(),
        onOpenChange, 
        onConfirm,
        onCancel 
    }: Props = $props();
</script>

<Modal
    {open}
    {onOpenChange}
    contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-sm border border-surface-300-700"
    backdropClasses="backdrop-blur-sm"
>
    {#snippet content()}
        <header class="flex justify-between">
            <h2 class="h2">Confirm</h2>
        </header>
        <article>
            <p class="opacity-60">
                Your context configuration has unsaved changes. Are you sure you want to discard them?
            </p>
        </article>
        <footer class="flex justify-end gap-4">
            <button class="btn preset-filled-surface-500" onclick={onCancel}>Cancel</button
            >
            <button class="btn preset-filled-error-500" onclick={onConfirm}>Discard</button
            >
        </footer>
    {/snippet}
</Modal>