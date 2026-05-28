ALTER TABLE contacts ADD COLUMN IF NOT EXISTS responded_at timestamptz;

-- Backfill contacts already marked responded
UPDATE contacts SET responded_at = updated_at
WHERE status = 'responded' AND responded_at IS NULL;
