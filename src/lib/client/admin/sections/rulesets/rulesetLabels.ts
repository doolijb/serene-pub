/**
 * 🚧 Admin › Rulesets' words for a ruleset's origin, state and who plays it —
 * one place, so the changelist, the change form and its header say them the
 * same way (STYLE-GUIDE §10: one name per thing).
 */
type Row = Sockets.Rulesets.ListRow

/** Shipped first, then the pub's own in the order they move. */
export const STATE_ORDER: readonly Row["state"][] = ["shipped", "draft", "published", "retired"]

/** Serene Pub · the plugin (by its name, else its owner slug, which is its id) · This pub. */
export function originLabel(origin: Row["origin"], rulesetId: string, pluginName?: string | null): string {
	if (origin === "core") return "Serene Pub"
	if (origin === "pub") return "This pub"
	return pluginName || rulesetId.slice(0, Math.max(0, rulesetId.indexOf(":"))) || "A plugin"
}

/** Shipped · Draft · Published · Retired; a published one with draft changes says so. */
export function stateLabel(state: Row["state"], draftChanged: boolean): string {
	switch (state) {
		case "shipped":
			return "Shipped"
		case "draft":
			return "Draft"
		case "published":
			return draftChanged ? "Published, draft changed" : "Published"
		case "retired":
			return "Retired"
	}
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "2 sessions · 1 lorebook", or nothing when nothing plays it. */
export function playedByText(p: Row["playedBy"]): string {
	const parts = [
		p.sessions ? count(p.sessions, "session", "sessions") : "",
		p.lorebooks ? count(p.lorebooks, "lorebook", "lorebooks") : ""
	].filter(Boolean)
	return parts.join(" · ")
}

/** The header's sentence: "Played by 3 sessions and 1 lorebook." */
export function playedBySentence(p: Row["playedBy"]): string {
	if (!p.sessions && !p.lorebooks) return "Nothing plays it yet."
	const parts = [
		p.sessions ? count(p.sessions, "session", "sessions") : "",
		p.lorebooks ? count(p.lorebooks, "lorebook", "lorebooks") : ""
	].filter(Boolean)
	return `Played by ${parts.join(" and ")}.`
}
