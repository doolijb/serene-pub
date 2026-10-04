/**
 * The toast a lorebook import that saved its book shows (plan A13): a plain
 * success, or — when something after the save did not finish (the reply's
 * `warnings`: the list refresh, the cast's names, a link from the file) — a
 * warning that says the book is in and names what did not finish. Never an
 * error: the book exists, and a retry would only meet it as a conflict.
 */
export function lorebookImportedToast(warnings: string[] | undefined): {
	kind: "success" | "warning"
	title: string
	description?: string
} {
	if (!warnings?.length) return { kind: "success", title: "Lorebook imported" }
	return {
		kind: "warning",
		title: "Lorebook imported with warnings",
		description: warnings.join(" ")
	}
}
