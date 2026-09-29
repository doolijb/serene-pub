/**
 * The sentence an overwrite-import's confirmation shows about what it will
 * delete that the file cannot bring back (`conflict.losses` from
 * `lorebooks:import`). Null when there is nothing of that kind to lose, so the
 * prompt says nothing rather than "deletes 0 branches".
 */
export function describeOverwriteLosses(
	losses: Sockets.Lorebooks.OverwriteLosses | null | undefined
): string | null {
	if (!losses) return null
	const plural = (n: number, one: string, many: string) =>
		`${n} ${n === 1 ? one : many}`
	const parts = [
		losses.amendments > 0 &&
			plural(losses.amendments, "dated change", "dated changes"),
		losses.presences > 0 &&
			plural(losses.presences, "presence", "presences"),
		losses.branches > 0 && plural(losses.branches, "branch", "branches"),
		losses.sceneLinks > 0 &&
			plural(
				losses.sceneLinks,
				"scene captured from a session",
				"scenes captured from a session"
			)
	].filter((p): p is string => !!p)
	if (parts.length === 0) return null
	const list =
		parts.length === 1
			? parts[0]
			: `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
	const total =
		losses.amendments + losses.presences + losses.branches + losses.sceneLinks
	return total === 1
		? `Overwriting also deletes ${list}. The file does not carry it, so it cannot come back.`
		: `Overwriting also deletes ${list}. The file does not carry them, so they cannot come back.`
}
