/**
 * What an `ok` reply's generate node said where a halt reason would be — on
 * receipts written **before** the one road (09-B B4, 2026-09-15).
 *
 * Until then a reply halted at the pre-call substrate and the connection
 * adapter sent the prompt from outside the run; `recordReplyOutcome` patched
 * this sentence onto the generate node afterwards. Every reply runs its oracle
 * now and nothing writes it any more. It stays because those receipts are
 * still in the run history, and the run inspector's verdict still has to name
 * WHO sent a prompt the pipeline only compiled when it opens one of them.
 */
export const REPLY_SENT_BY_ADAPTER = "sent by the reply adapter"
