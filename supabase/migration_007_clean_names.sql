-- Strip parenthetical content from contact names
-- "(John Smith)" → "John Smith"
-- "John Smith (guarantor)" → "John Smith"
-- Uses regexp_replace to remove parenthetical suffixes, then trim

UPDATE contacts
SET name = TRIM(REGEXP_REPLACE(
  REGEXP_REPLACE(name, '\s*\([^)]*\)\s*', ' ', 'g'),
  '^\((.+)\)$', '\1'
))
WHERE name ~ '\(';
