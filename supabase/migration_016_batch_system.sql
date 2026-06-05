-- Add import_date to contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS import_date date;

-- Create batches table
CREATE TABLE IF NOT EXISTS batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  import_date date,
  contact_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_batches"
  ON batches FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS batches_user_id_idx ON batches (user_id);
CREATE INDEX IF NOT EXISTS contacts_import_date_idx ON contacts (import_date);
