-- Add chat_type column to chats table
ALTER TABLE chats ADD COLUMN IF NOT EXISTS chat_type TEXT NOT NULL DEFAULT 'roleplay';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_chats_chat_type ON chats(chat_type);

-- Update any NULL values to 'roleplay' (shouldn't be any, but safety check)
UPDATE chats SET chat_type = 'roleplay' WHERE chat_type IS NULL;
