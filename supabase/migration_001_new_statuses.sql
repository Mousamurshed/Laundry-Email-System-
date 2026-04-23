-- Run this in your Supabase SQL Editor.
-- Adds new contact statuses including 'new' (default for imports).

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_status_check;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_status_check
  CHECK (status IN ('new','active','inactive','prospect','customer','responded','interested','not_interested'));

-- Update the column default to 'new'
ALTER TABLE contacts ALTER COLUMN status SET DEFAULT 'new';
