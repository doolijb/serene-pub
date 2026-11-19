/**
 * 🚧 (m2e-F-D) The sentence a person is told when they try to edit a **live
 * provided lorebook** (any kind: a primer row or a plugin's provided book; its
 * own provided mark, owner present): it is read-only; make your own copy. `null` is core ("the pub"); a plugin's row names
 * the plugin. Pure, so the server's refusal (`primerRowEditProblem`,
 * `plugins/providedMarks.ts`) and the client's read-only line say the same.
 * Not `PROVIDED_BOOK_DELETE_REFUSAL` (the delete refusal, for every provided
 * book) and not `STARTER_KIT_SENTENCES.shippedKeep` (the kit rows' own keep).
 */
export function primerRowEditRefusal(pluginName: string | null): string {
	return `This lorebook comes with ${pluginName === null ? "the pub" : pluginName}: make your own copy to change it.`
}
