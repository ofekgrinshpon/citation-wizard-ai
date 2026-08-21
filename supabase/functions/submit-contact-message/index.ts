import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const SUPPORT_INBOX = 'support@relexlm.com'

interface Payload {
  firstName?: unknown
  lastName?: unknown
  email?: unknown
  message?: unknown
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing environment configuration')
    return json({ error: 'Server configuration error' }, 500)
  }

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const firstName = str(payload.firstName, 80)
  const lastName = str(payload.lastName, 80)
  const email = str(payload.email, 254)
  const message = str(payload.message, 5000)

  const errors: Record<string, string> = {}
  if (!firstName) errors.firstName = 'שם פרטי הוא שדה חובה (עד 80 תווים)'
  if (!lastName) errors.lastName = 'שם משפחה הוא שדה חובה (עד 80 תווים)'
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    errors.email = 'כתובת אימייל תקינה היא שדה חובה'
  }
  if (!message || message.length < 5) {
    errors.message = 'תוכן ההודעה הוא שדה חובה (5–5000 תווים)'
  }
  if (Object.keys(errors).length > 0) {
    return json({ error: 'validation_failed', fields: errors }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  // Best-effort: attach the signed-in user when a valid token is present.
  let userId: string | null = null
  const authHeader = req.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const { data } = await supabase.auth.getUser(authHeader.slice(7).trim())
    userId = data?.user?.id ?? null
  }

  const { data: inserted, error: insertError } = await supabase
    .from('contact_messages')
    .insert({
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      email,
      message,
      metadata: { user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null },
    })
    .select('id, created_at')
    .single()

  if (insertError || !inserted) {
    console.error('Failed to store contact message', insertError)
    return json({ error: 'לא הצלחנו לשמור את הפנייה. נסו שוב בעוד רגע.' }, 500)
  }

  // Notify the support inbox. A delivery failure must not fail the submission.
  try {
    const { error: emailError } = await supabase.functions.invoke('send-transactional-email', {
      body: {
        templateName: 'contact-message',
        recipientEmail: SUPPORT_INBOX,
        idempotencyKey: `contact-message-${inserted.id}`,
        templateData: {
          fullName: `${firstName} ${lastName}`,
          senderEmail: email,
          message,
          submittedAt: new Date(inserted.created_at).toLocaleString('he-IL', {
            timeZone: 'Asia/Jerusalem',
          }),
          messageId: inserted.id,
        },
      },
    })
    if (emailError) {
      console.error('Contact notification email failed', emailError)
    }
  } catch (error) {
    console.error('Contact notification email threw', error)
  }

  return json({ ok: true, id: inserted.id })
})
