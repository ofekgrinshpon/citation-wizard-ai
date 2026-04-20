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
import { BRAND, styles } from './_brand.ts'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="he" dir="rtl">
    <Head />
    <Preview>קוד אימות חד-פעמי ל-{BRAND.name}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.logoWrap}>
          <Img src={BRAND.logoUrl} alt={BRAND.name} style={styles.logo} />
        </Section>
        <Section style={styles.card}>
          <Heading style={styles.h1}>קוד אימות חד-פעמי</Heading>
          <Text style={styles.text}>
            כדי להמשיך ב-{BRAND.name}, יש להזין את קוד האימות הבא:
          </Text>
          <Text style={styles.code}>{token}</Text>
          <Text style={styles.textMuted}>
            הקוד תקף לזמן קצר. אם לא ביקשת את הפעולה הזו, ניתן להתעלם
            מהודעה זו.
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

export default ReauthenticationEmail
