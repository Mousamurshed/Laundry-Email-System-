-- Run in Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS bulk_send_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id      uuid REFERENCES email_templates(id) ON DELETE SET NULL,
  subject          text NOT NULL,
  body             text NOT NULL,
  contact_ids      jsonb NOT NULL,          -- ordered array of contact UUIDs
  filter_description text,                  -- human-readable, e.g. "All contacts"
  rate_delay_ms    int NOT NULL DEFAULT 60000,
  status           text NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled','running','completed','cancelled','failed')),
  scheduled_at     timestamptz NOT NULL,
  started_at       timestamptz,
  completed_at     timestamptz,
  total_count      int NOT NULL DEFAULT 0,
  sent_count       int NOT NULL DEFAULT 0,
  failed_count     int NOT NULL DEFAULT 0,
  current_offset   int NOT NULL DEFAULT 0,
  error_message    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bulk_send_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own bulk_send_jobs" ON bulk_send_jobs
  FOR ALL USING (auth.uid() = user_id);
