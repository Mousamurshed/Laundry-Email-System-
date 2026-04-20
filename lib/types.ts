export type Profile = {
  id: string
  email: string | null
  full_name: string | null
  gmail_access_token: string | null
  gmail_refresh_token: string | null
  gmail_token_expiry: string | null
  gmail_email: string | null
  created_at: string
  updated_at: string
}

export type Contact = {
  id: string
  user_id: string
  name: string
  email: string
  address: string | null
  phone: string | null
  company: string | null
  tags: string[] | null
  do_not_contact: boolean
  status: 'active' | 'inactive' | 'prospect' | 'customer'
  created_at: string
  updated_at: string
}

export type ContactNote = {
  id: string
  contact_id: string
  user_id: string
  content: string
  created_at: string
}

export type EmailTemplate = {
  id: string
  user_id: string
  name: string
  subject: string
  body: string
  created_at: string
  updated_at: string
}

export type EmailHistory = {
  id: string
  user_id: string
  contact_id: string | null
  template_id: string | null
  to_email: string
  to_name: string | null
  subject: string
  body: string
  status: 'sent' | 'failed' | 'scheduled' | 'cancelled'
  sent_at: string | null
  scheduled_at: string | null
  error_message: string | null
  created_at: string
  contacts?: { name: string; email: string } | null
  email_templates?: { name: string } | null
}
