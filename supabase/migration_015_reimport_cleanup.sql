-- Catch any contacts added after the earlier cleanup migrations ran.

-- Strip parentheses from names: "(Sarah Lufkin)" → "Sarah Lufkin"
UPDATE contacts
SET name = TRIM(REGEXP_REPLACE(
  REGEXP_REPLACE(TRIM(name), '\(\s*([^)]+?)\s*\)', '\1', 'g'),
  '\s{2,}', ' '
))
WHERE name LIKE '%(%';

-- Strip parentheses/brackets from emails: "(sarah@x.com)" → "sarah@x.com"
UPDATE contacts
SET email = TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
  email, '\(', '', 'g'), '\)', '', 'g'), '<', '', 'g'), '>', '', 'g'))
WHERE email ~ '[()<>]';

-- Strip leading "and " or "& " from names: "and Penelope McCreath" → "Penelope McCreath"
UPDATE contacts
SET name = TRIM(REGEXP_REPLACE(name, '^(and|&)\s+', '', 'i'))
WHERE name ~* '^(and|&)\s';

-- Apply title case to any names that aren't already title-cased
UPDATE contacts
SET name = initcap(name)
WHERE name <> initcap(name);
