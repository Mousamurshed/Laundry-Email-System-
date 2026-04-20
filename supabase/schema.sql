-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─── Profiles ────────────────────────────────────────────────────────────────
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  full_name text,
  gmail_access_token text,
  gmail_refresh_token text,
  gmail_token_expiry timestamptz,
  gmail_email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── Contacts ────────────────────────────────────────────────────────────────
create table contacts (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  email text not null,
  address text,
  phone text,
  company text,
  tags text[] default '{}',
  do_not_contact boolean default false,
  status text default 'prospect' check (status in ('active','inactive','prospect','customer')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── Contact Notes ────────────────────────────────────────────────────────────
create table contact_notes (
  id uuid default uuid_generate_v4() primary key,
  contact_id uuid references contacts on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  content text not null,
  created_at timestamptz default now()
);

-- ─── Email Templates ─────────────────────────────────────────────────────────
create table email_templates (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  subject text not null,
  body text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── Email History ────────────────────────────────────────────────────────────
create table email_history (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users on delete cascade not null,
  contact_id uuid references contacts on delete set null,
  template_id uuid references email_templates on delete set null,
  to_email text not null,
  to_name text,
  subject text not null,
  body text not null,
  status text default 'sent' check (status in ('sent','failed','scheduled','cancelled')),
  sent_at timestamptz,
  scheduled_at timestamptz,
  error_message text,
  created_at timestamptz default now()
);

-- ─── Row Level Security ───────────────────────────────────────────────────────
alter table profiles enable row level security;
alter table contacts enable row level security;
alter table contact_notes enable row level security;
alter table email_templates enable row level security;
alter table email_history enable row level security;

create policy "profiles_own" on profiles for all using (auth.uid() = id);
create policy "contacts_own" on contacts for all using (auth.uid() = user_id);
create policy "notes_own" on contact_notes for all using (auth.uid() = user_id);
create policy "templates_own" on email_templates for all using (auth.uid() = user_id);
create policy "history_own" on email_history for all using (auth.uid() = user_id);

-- ─── Auto-create profile on signup ───────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─── Updated_at trigger ───────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger contacts_updated_at before update on contacts
  for each row execute procedure set_updated_at();
create trigger templates_updated_at before update on email_templates
  for each row execute procedure set_updated_at();
create trigger profiles_updated_at before update on profiles
  for each row execute procedure set_updated_at();

-- ─── Useful indexes ───────────────────────────────────────────────────────────
create index contacts_user_id_idx on contacts (user_id);
create index contacts_email_idx on contacts (email);
create index email_history_user_id_idx on email_history (user_id);
create index email_history_status_idx on email_history (status);
create index email_history_scheduled_at_idx on email_history (scheduled_at) where status = 'scheduled';
