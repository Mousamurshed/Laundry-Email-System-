import { Resend } from 'resend'
import { EMAIL_SIGNATURE } from './gmail'

const resend = new Resend(process.env.RESEND_API_KEY)

export const FROM_ADDRESS = 'The Laundry Day Team <team@laundryday.nyc>'

export async function sendEmail(
  to: string,
  subject: string,
  body: string
): Promise<string> {
  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: [to],
    subject,
    html: body.replace(/\n/g, '<br>') + EMAIL_SIGNATURE,
  })

  if (error) {
    throw new Error(`${(error as { name?: string }).name ?? 'ResendError'}: ${(error as { message?: string }).message ?? 'Send failed'}`)
  }
  if (!data?.id) throw new Error('Resend returned no email ID')
  return data.id
}
