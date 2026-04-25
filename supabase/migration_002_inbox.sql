-- Run in Supabase SQL Editor.
-- Creates inbox_messages table for storing Gmail replies from contacts.

create table if not exists inbox_messages (
  id                  uuid default uuid_generate_v4() primary key,
  user_id             uuid references auth.users on delete cascade not null,
  contact_id          uuid references contacts(id) on delete set null,
  gmail_message_id    text not null,
  gmail_thread_id     text not null,
  gmail_rfc_message_id text,           -- RFC822 Message-ID header, for In-Reply-To
  from_email          text not null,
  from_name           text,
  subject             text,
  body_preview        text,
  body_full           text,
  received_at         timestamptz not null,
  is_read             boolean default false,
  created_at          timestamptz default now(),
  unique(user_id, gmail_message_id)
);

alter table inbox_messages enable row level security;
create policy "inbox_own" on inbox_messages for all using (auth.uid() = user_id);
