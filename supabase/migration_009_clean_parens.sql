-- Clean parentheses from contact names
-- "(Sarah Lufkin) & Timothy Lufkin" → "Sarah Lufkin & Timothy Lufkin"
-- "(John Smith)"                    → "John Smith"
-- Unwraps (content) → content, then collapses double spaces
UPDATE contacts
SET name = TRIM(
  REGEXP_REPLACE(
    REGEXP_REPLACE(TRIM(name), '\(\s*([^)]+?)\s*\)', '\1', 'g'),
    '\s{2,}', ' '
  )
)
WHERE name LIKE '%(%';

-- Clean parentheses from email addresses
-- "(sarahlufkin16@gmail.com)"            → "sarahlufkin16@gmail.com"
-- "(email1@x.com), email2@x.com"         → "email1@x.com, email2@x.com"
-- Also strip any stray angle brackets
UPDATE contacts
SET email = TRIM(
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(TRIM(email), '\(', '', 'g'),
      '\)', '', 'g'),
    '<', '', 'g'),
  '>', '', 'g')
)
WHERE email ~ '[()<>]';
