-- Custom SQL migration file, put your code below! --

-- Check if user 1 exists and create user settings entry if so
INSERT INTO user_settings (
    user_id, 
    show_home_page_banner, 
    enable_easy_persona_creation, 
    enable_easy_character_creation, 
    show_all_character_fields,
    created_at,
    updated_at
)
SELECT 
    u.id AS user_id,
    COALESCE(ss.show_home_page_banner, true) AS show_home_page_banner,
    COALESCE(ss.enable_easy_persona_creation, true) AS enable_easy_persona_creation,
    COALESCE(ss.enable_easy_character_creation, true) AS enable_easy_character_creation,
    COALESCE(ss.show_all_character_fields, false) AS show_all_character_fields,
    CURRENT_TIMESTAMP AS created_at,
    CURRENT_TIMESTAMP AS updated_at
FROM users u
CROSS JOIN (
    SELECT 
        show_home_page_banner,
        enable_easy_persona_creation,
        enable_easy_character_creation,
        show_all_character_fields
    FROM system_settings 
    LIMIT 1
) ss
WHERE u.id = 1 
  AND EXISTS (SELECT 1 FROM users WHERE id = 1)
  AND NOT EXISTS (
    SELECT 1 FROM user_settings us WHERE us.user_id = u.id
);
--> statement-breakpoint
-- Update user 1 to be admin only if user 1 exists
UPDATE users 
SET is_admin = true 
WHERE id = 1 
  AND EXISTS (SELECT 1 FROM users WHERE id = 1);
--> statement-breakpoint
-- Associate all tags with user 1 if user 1 exists
UPDATE tags 
SET user_id = 1 
WHERE EXISTS (SELECT 1 FROM users WHERE id = 1);