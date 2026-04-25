-- Normalize all contact addresses to:
--   • trimmed outer whitespace
--   • collapsed internal whitespace (double-spaces → single)
--   • Title Case via PostgreSQL initcap()
--
-- initcap() lowercases everything then uppercases the first letter of each
-- alphanumeric word, so "165 EAST 35TH" → "165 East 35th"
-- and "165  east  35th" (double spaces) → "165 East 35th".
--
-- Run in Supabase SQL Editor.

UPDATE contacts
SET address = initcap(regexp_replace(trim(address), '\s+', ' ', 'g'))
WHERE address IS NOT NULL
  AND address IS DISTINCT FROM initcap(regexp_replace(trim(address), '\s+', ' ', 'g'));
