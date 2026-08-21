/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import { BRAND, styles } from '../email-templates/_brand.ts'
import type { TemplateEntry } from './registry.ts'

interface ContactMessageProps {
  fullName?: string
  senderEmail?: string
  message?: string
  submittedAt?: string
  messageId?: string
}

const ContactMessageEmail = ({
  fullName,
  senderEmail,
  message,
  submittedAt,
  messageId,
}: ContactMessageProps) => (
  <Html lang="he" dir="rtl">
    <Head />
    <Preview>פנייה חדשה מטופס יצירת הקשר{fullName ? ` — ${fullName}` : ''}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.logoWrap}>
          <Img src={BRAND.logoUrl} alt={BRAND.name} style={styles.logo} />
        </Section>
        <Section style={styles.card}>
          <Heading style={styles.h1}>פנייה חדשה מטופס יצירת קשר</Heading>
          <Text style={styles.text}>
            <strong>שם:</strong> {fullName || 'לא צוין'}
          </Text>
          <Text style={styles.text}>
            <strong>מייל לחזרה:</strong>{' '}
            {senderEmail ? (
              <Link href={`mailto:${senderEmail}`} style={styles.link} dir="ltr">
                {senderEmail}
              </Link>
            ) : (
              'לא צוין'
            )}
          </Text>
          {submittedAt ? (
            <Text style={styles.textMuted}>
              <strong>נשלח בתאריך:</strong> {submittedAt}
            </Text>
          ) : null}
          <Text style={{ ...styles.text, whiteSpace: 'pre-wrap' as const }}>
            {message || '(ללא תוכן)'}
          </Text>
          {messageId ? (
            <Text style={styles.textMuted}>מזהה פנייה: {messageId}</Text>
          ) : null}
        </Section>
        <Text style={styles.footer}>
          {BRAND.name} — {BRAND.tagline}
          <br />
          <Link href={BRAND.url} style={styles.footerLink}>
            {BRAND.url}
          </Link>
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ContactMessageEmail,
  subject: (data: ContactMessageProps) =>
    `פנייה חדשה מ-${data?.fullName || 'משתמש'} | ReLex`,
  displayName: 'פנייה מטופס יצירת קשר',
  previewData: {
    fullName: 'ישראל ישראלי',
    senderEmail: 'israel@example.com',
    message: 'שלום, יש לי שאלה לגבי התוכניות.',
    submittedAt: '21.08.2026',
  },
} satisfies TemplateEntry
