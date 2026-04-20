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

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({ confirmationUrl }: RecoveryEmailProps) => (
  <Html lang="he" dir="rtl">
    <Head />
    <Preview>איפוס סיסמה ב-{BRAND.name}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.logoWrap}>
          <Img src={BRAND.logoUrl} alt={BRAND.name} style={styles.logo} />
        </Section>
        <Section style={styles.card}>
          <Heading style={styles.h1}>איפוס סיסמה</Heading>
          <Text style={styles.text}>
            קיבלנו בקשה לאיפוס הסיסמה לחשבונך ב-{BRAND.name}. לחצ/י על הכפתור
            כדי לבחור סיסמה חדשה:
          </Text>
          <Section style={styles.buttonWrap}>
            <Button style={styles.button} href={confirmationUrl}>
              איפוס סיסמה
            </Button>
          </Section>
          <Text style={styles.textMuted}>
            אם לא ביקשת איפוס סיסמה, ניתן להתעלם מהודעה זו — הסיסמה הנוכחית
            תישאר בתוקף.
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

export default RecoveryEmail
