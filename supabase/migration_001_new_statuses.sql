-- Run this in your Supabase SQL Editor to support the new contact statuses.

-- Drop existing check constraint and replace with updated one
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_status_check;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_status_check
  CHECK (status IN ('active','inactive','prospect','customer','responded','interested','not_interested'));
