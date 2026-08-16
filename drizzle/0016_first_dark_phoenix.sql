-- Custom SQL migration file, put your code below! --

-- Data migration: Copy theme and darkMode from users table to userSettings table for user 1
-- This migration handles the case where user 1 exists and has userSettings

-- If user 1 exists, update all tags to belong to user 1

UPDATE user_settings 
SET 
    theme = users.theme,
    dark_mode = users.dark_mode
FROM users 
WHERE user_settings.user_id = users.id 
    AND users.id = 1 
    AND user_settings.user_id = 1;