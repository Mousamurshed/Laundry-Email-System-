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

export type ContactStatus = 'new' | 'active' | 'inactive' | 'prospect' | 'customer' | 'responded' | 'not_interested' | 'interested' | 'confirmed'

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
  status: ContactStatus
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

export type InboxMessage = {
  id: string
  user_id: string
  contact_id: string | null
  gmail_message_id: string
  gmail_thread_id: string
  gmail_rfc_message_id: string | null
  from_email: string
  from_name: string | null
  subject: string | null
  body_preview: string | null
  body_full: string | null
  received_at: string
  is_read: boolean
  created_at: string
  contacts?: { name: string; email: string; status: string } | null
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

export type BulkSendJob = {
  id: string
  user_id: string
  template_id: string | null
  subject: string
  body: string
  contact_ids: string[]
  filter_description: string | null
  rate_delay_ms: number
  status: 'scheduled' | 'running' | 'completed' | 'cancelled' | 'failed'
  scheduled_at: string
  started_at: string | null
  completed_at: string | null
  total_count: number
  sent_count: number
  failed_count: number
  current_offset: number
  error_message: string | null
  created_at: string
}
