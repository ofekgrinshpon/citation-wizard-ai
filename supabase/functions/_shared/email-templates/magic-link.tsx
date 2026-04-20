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

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({ confirmationUrl }: MagicLinkEmailProps) => (
  <Html lang="he" dir="rtl">
    <Head />
    <Preview>קישור התחברות ל-{BRAND.name}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.logoWrap}>
          <Img src={BRAND.logoUrl} alt={BRAND.name} style={styles.logo} />
        </Section>
        <Section style={styles.card}>
          <Heading style={styles.h1}>קישור התחברות חד-פעמי</Heading>
          <Text style={styles.text}>
            לחצ/י על הכפתור כדי להתחבר ל-{BRAND.name}. הקישור תקף לזמן מוגבל.
          </Text>
          <Section style={styles.buttonWrap}>
            <Button style={styles.button} href={confirmationUrl}>
              התחברות ל-{BRAND.name}
            </Button>
          </Section>
          <Text style={styles.textMuted}>
            אם לא ביקשת להתחבר, ניתן להתעלם מהודעה זו.
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

export default MagicLinkEmail
