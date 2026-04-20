/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
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
import { BRAND, styles } from './_brand.ts'

interface EmailChangeEmailProps {
  siteName: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  email,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <Html lang="he" dir="rtl">
    <Head />
    <Preview>אישור שינוי כתובת אימייל ב-{BRAND.name}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.logoWrap}>
          <Img src={BRAND.logoUrl} alt={BRAND.name} style={styles.logo} />
        </Section>
        <Section style={styles.card}>
          <Heading style={styles.h1}>אישור שינוי כתובת אימייל</Heading>
          <Text style={styles.text}>
            התקבלה בקשה להחליף את כתובת האימייל בחשבון {BRAND.name} שלך —
            מהכתובת{' '}
            <Link href={`mailto:${email}`} style={styles.link}>{email}</Link>{' '}
            לכתובת{' '}
            <Link href={`mailto:${newEmail}`} style={styles.link}>{newEmail}</Link>.
          </Text>
          <Text style={styles.text}>לחצ/י על הכפתור כדי לאשר את השינוי:</Text>
          <Section style={styles.buttonWrap}>
            <Button style={styles.button} href={confirmationUrl}>
              אישור שינוי כתובת
            </Button>
          </Section>
          <Text style={styles.textMuted}>
            אם לא ביקשת לשנות את הכתובת, מומלץ לאבטח את החשבון מיידית
            ולאפס את הסיסמה.
          </Text>
        </Section>
        <Text style={styles.footer}>
          {BRAND.name} — {BRAND.tagline}
          <br />
          <Link href={BRAND.url} style={styles.footerLink}>{BRAND.url}</Link>
        </Text>
      </Container>
    </Body>
  </Html>
)

export default EmailChangeEmail
