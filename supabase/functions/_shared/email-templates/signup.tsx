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

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({ recipient, confirmationUrl }: SignupEmailProps) => (
  <Html lang="he" dir="rtl">
    <Head />
    <Preview>אימות כתובת האימייל שלך ב-{BRAND.name}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.logoWrap}>
          <Img src={BRAND.logoUrl} alt={BRAND.name} style={styles.logo} />
        </Section>
        <Section style={styles.card}>
          <Heading style={styles.h1}>ברוך/ה הבא/ה ל-{BRAND.name}</Heading>
          <Text style={styles.text}>
            תודה שנרשמת! כדי להשלים את ההרשמה ולהפעיל את החשבון שלך
            (<Link href={`mailto:${recipient}`} style={styles.link}>{recipient}</Link>),
            אנא אמת/י את כתובת האימייל בלחיצה על הכפתור:
          </Text>
          <Section style={styles.buttonWrap}>
            <Button style={styles.button} href={confirmationUrl}>
              אימות כתובת האימייל
            </Button>
          </Section>
          <Text style={styles.textMuted}>
            אם לא נרשמת ל-{BRAND.name}, ניתן להתעלם מהודעה זו.
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

export default SignupEmail
