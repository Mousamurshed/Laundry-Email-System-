-- Fix 1: Replace smart/curly quotes and misused straight double quotes with apostrophes
-- e.g. O"Connor → O'Connor, O'Connor → O'Connor
UPDATE contacts
SET name = replace(replace(replace(replace(replace(
  name,
  chr(8220), chr(39)),   -- " U+201C LEFT DOUBLE QUOTATION MARK
  chr(8221), chr(39)),   -- " U+201D RIGHT DOUBLE QUOTATION MARK
  chr(8216), chr(39)),   -- ' U+2018 LEFT SINGLE QUOTATION MARK
  chr(8217), chr(39)),   -- ' U+2019 RIGHT SINGLE QUOTATION MARK
  '"',       chr(39))    -- straight double quote used as apostrophe
WHERE name <> replace(replace(replace(replace(replace(
  name,
  chr(8220), chr(39)),
  chr(8221), chr(39)),
  chr(8216), chr(39)),
  chr(8217), chr(39)),
  '"', chr(39));

-- Fix 2: Split "Person A & Person B" into separate contact rows.
-- Each person gets their own row with the shared address/email/phone.
-- The original row is kept for person 1; new rows are inserted for persons 2+.

INSERT INTO contacts (user_id, name, email, address, phone, company, tags, do_not_contact, status, created_at)
SELECT
  c.user_id,
  initcap(trim(pname)) AS name,
  c.email,
  c.address,
  c.phone,
  c.company,
  c.tags,
  c.do_not_contact,
  c.status,
  c.created_at
FROM contacts c,
  LATERAL unnest(regexp_split_to_array(c.name, '\s*&\s*')) WITH ORDINALITY AS t(pname, ord)
WHERE c.name LIKE '% & %'
  AND ord > 1
  AND trim(pname) <> '';

-- Update original rows to only person 1's name
UPDATE contacts
SET name = initcap(trim(split_part(name, ' & ', 1)))
WHERE name LIKE '% & %';

-- Fix 3: Title-case all remaining names that are entirely uppercase
-- e.g. "JOHN HENRY BENDER" → "John Henry Bender"
-- Only touches names where every character is uppercase (safe for mixed-case names like McDonald)
UPDATE contacts
SET name = initcap(lower(name))
WHERE name = upper(name)
  AND name <> lower(name);
