-- Store Resend's email ID on every sent email so webhook events (bounce/complaint)
-- can be matched back to the exact email_history row and its contact.
alter table email_history
  add column if not exists resend_email_id text;

create index if not exists email_history_resend_email_id_idx
  on email_history (resend_email_id)
  where resend_email_id is not null;
