// Any chat participant can send content that lands in the "always-included
// recent messages" window every infill engine re-renders/re-tokenizes on
// every candidate it evaluates — an oversized message blocks the whole
// single-threaded process for every user on the instance, not just the
// sender's own chat.
export const MAX_CHAT_MESSAGE_LENGTH = 50_000

// A "focus note" (e.g. narrator trigger instructions) isn't a message body
// and shouldn't share the full message budget — matches the existing
// chats:summarize topic field's cap.
export const MAX_NARRATOR_INSTRUCTIONS_LENGTH = 300
