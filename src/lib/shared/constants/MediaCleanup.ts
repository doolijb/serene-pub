/**
 * The typed confirmation for culling originals (0182).
 *
 * Shared rather than duplicated because the server validates against the exact
 * string the UI showed. Two copies of a phrase like this drift, and the failure
 * mode of drift is a destructive action that can never be confirmed — or worse,
 * one that can be confirmed by typing something the warning never said.
 */
export const CULL_ORIGINALS_CONFIRM = "DELETE ORIGINALS"
