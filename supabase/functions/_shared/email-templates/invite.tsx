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

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ confirmationUrl }: InviteEmailProps) => (
  <Html lang="he" dir="rtl">
    <Head />
    <Preview>הוזמנת להצטרף ל-{BRAND.name}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.logoWrap}>
          <Img src={BRAND.logoUrl} alt={BRAND.name} style={styles.logo} />
        </Section>
        <Section style={styles.card}>
          <Heading style={styles.h1}>הוזמנת ל-{BRAND.name}</Heading>
          <Text style={styles.text}>
            קיבלת הזמנה להצטרף ל-{BRAND.name} — {BRAND.tagline}. לחצ/י על
            הכפתור כדי לקבל את ההזמנה וליצור חשבון:
          </Text>
          <Section style={styles.buttonWrap}>
            <Button style={styles.button} href={confirmationUrl}>
              קבלת ההזמנה
            </Button>
          </Section>
          <Text style={styles.textMuted}>
            אם לא ציפית לקבל הזמנה זו, ניתן להתעלם מהודעה זו.
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

export default InviteEmail
