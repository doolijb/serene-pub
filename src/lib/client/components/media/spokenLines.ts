/** Display helpers for the folded Spoken lines row. */

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
	return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** "Spoken lines · 3 files · 4.2 MB", or the empty reading. */
export function spokenLinesLabel(count: number, bytes: number): string {
	if (count === 0) return "No spoken lines stored"
	return `Spoken lines · ${count} ${count === 1 ? "file" : "files"} · ${formatBytes(bytes)}`
}
