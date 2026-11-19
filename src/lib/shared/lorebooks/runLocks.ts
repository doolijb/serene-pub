/** 🚧 Whether runs may not write this entry (the entry lock). The one place the rule is read; a wider lock widens here. */
export function entryLockedAgainstRuns(row: {
	entryLock?: boolean | null
}): boolean {
	return row.entryLock === true
}

/** 🚧 The same for a scene (the scene lock). */
export function sceneLockedAgainstRuns(row: {
	sceneLock?: boolean | null
}): boolean {
	return row.sceneLock === true
}

/** 🚧 The same for a cast member (the cast member lock): its details, words, art and durable sheet. */
export function castMemberLockedAgainstRuns(row: {
	castMemberLock?: boolean | null
}): boolean {
	return row.castMemberLock === true
}

/** 🚧 Provisional copy: the owner has not seen these sentences. */
export const RUN_LOCK_SENTENCES = Object.freeze({
	/** A run's note when it left a locked cast member as it is. */
	castMember: (name: string) =>
		`${name} is locked, so this run left it as it is.`,
	/** A run's note when it left a locked entry as it is. */
	entry: (title: string) => `${title} is locked, so this run left it as it is.`,
	/** A run's note when it left a locked scene as it is. */
	scene: (name: string) => `${name} is locked, so this run left it as it is.`,
	/** The Apply review's line on a held change to a locked entry. */
	held: (title: string) =>
		`${title} is locked, so this change waits here until you Apply or Take back.`
})
