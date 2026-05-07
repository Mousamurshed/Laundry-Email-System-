-- Strip leading "and " / "& " from names that lost the first person during split
-- e.g. "and Penelope McCreath" → "Penelope McCreath"
UPDATE contacts
SET name = TRIM(REGEXP_REPLACE(name, '^(and|&)\s+', '', 'i'))
WHERE name ~* '^(and|&)\s';

-- Normalize " and " (all cases) to " & " for consistent multi-person display
-- e.g. "David Haase and Penelope McCreath" → "David Haase & Penelope McCreath"
UPDATE contacts
SET name = TRIM(REGEXP_REPLACE(name, '\s+and\s+', ' & ', 'ig'))
WHERE name ~* '\s+and\s+';
