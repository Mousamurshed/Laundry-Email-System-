-- Add 'confirmed' as a valid contact status.
-- Run in Supabase SQL Editor.

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_status_check;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_status_check
  CHECK (status IN (
    'new', 'active', 'inactive', 'prospect', 'customer',
    'responded', 'interested', 'not_interested', 'confirmed'
  ));
