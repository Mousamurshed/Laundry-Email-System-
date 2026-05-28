-- 1. Add 'uncontacted' as a valid status (aged-out 'new' contacts land here).
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_status_check;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_status_check
  CHECK (status IN (
    'new', 'uncontacted', 'active', 'inactive', 'prospect', 'customer',
    'responded', 'interested', 'not_interested', 'confirmed'
  ));

-- 2. Age any 'new' contacts that are already older than 48 h.
UPDATE contacts
   SET status = 'uncontacted'
 WHERE status = 'new'
   AND created_at < NOW() - INTERVAL '48 hours';

-- 3. Title-case all existing names (initcap handles ALL-CAPS → Title Case).
--    Only touch rows that differ so the update set is as small as possible.
UPDATE contacts
   SET name = initcap(name)
 WHERE name <> initcap(name);
