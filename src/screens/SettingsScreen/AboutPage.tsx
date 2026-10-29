import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {describeDeviceModel, readDeviceModel} from '../../services/deviceModel';
import {QrCode} from '../../components/QrCode';
import {
  APP_VERSION,
  BUILD_DATE,
  BUILD_NUMBER,
  KOFI_URL,
} from '../../config/app';
import {releaseHighlights} from '../../config/releaseNotes';
import {t} from '../../i18n';
import {Page} from './widgets';

const EASTER_EGG_TEXT =
  'For Kimberly — whose love of Star Trek started all of this.';

// Both About codes are version 3 (29 modules plus the quiet zone, 37 in all),
// so 148 gives whole 4-pixel modules.
const QR_SIZE = 148;

export const AboutPage = ({onBack}: {onBack: () => void}) => (
  <Page title={t('settings.about')} onBack={onBack}>
    <View style={styles.about}>
      <Text style={styles.aboutText}>Astra {APP_VERSION}</Text>
      <Text style={styles.aboutText}>
        {t('about.build', {build: BUILD_NUMBER})}
      </Text>
      <Text style={styles.aboutText}>
        {t('about.buildDate', {date: BUILD_DATE})}
      </Text>
      {readDeviceModel().model ? (
        <Text style={styles.aboutText} testID="about-device">
          {t('about.device', {
            device: describeDeviceModel(readDeviceModel()),
          })}
        </Text>
      ) : null}
      <Text style={styles.aboutText}>{t('about.license')}</Text>
      <Text style={styles.aboutText}>{t('about.openSource')}</Text>
      <Text style={styles.aboutText}>{t('about.compatible')}</Text>
      <Text style={styles.aboutText}>{t('about.support')}</Text>
      <Text style={styles.aboutText}>{t('about.website')}</Text>
      <Text style={styles.aboutText}>{t('about.source')}</Text>
      <View style={styles.qrRow}>
        <View style={styles.qrImage}>
          <QrCode size={QR_SIZE} testID="about-kofi-qr" value={KOFI_URL} />
        </View>
        <Image
          source={require('../../assets/source-qr.png')}
          style={styles.qrImage}
        />
      </View>
      <View style={styles.releaseNotes}>
        <Text style={styles.releaseNotesTitle}>
          {t('about.whatsNewIn', {version: APP_VERSION})}
        </Text>
        {releaseHighlights().map((highlight) => (
          <Text key={highlight.slice(0, 24)} style={styles.releaseNotesText}>
            {`\u2022 ${highlight}`}
          </Text>
        ))}
      </View>
      <Text style={styles.easterEgg}>{EASTER_EGG_TEXT}</Text>
    </View>
  </Page>
);

const styles = StyleSheet.create({
  about: {
    backgroundColor: '#182027',
    borderRadius: 8,
    padding: 22,
  },
  aboutText: {
    color: '#DDE7EB',
    fontSize: 22,
    marginBottom: 10,
  },
  releaseNotes: {
    borderTopColor: '#34434B',
    borderTopWidth: 1,
    marginTop: 22,
    paddingTop: 18,
  },
  releaseNotesTitle: {
    color: '#89CFF0',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 12,
  },
  releaseNotesText: {
    color: '#DDE7EB',
    fontSize: 20,
    lineHeight: 28,
    marginBottom: 8,
  },
  easterEgg: {
    color: '#9FB0BA',
    fontSize: 19,
    fontStyle: 'italic',
    marginTop: 16,
    opacity: 0.58,
  },
  qrRow: {
    flexDirection: 'row',
    gap: 18,
    marginTop: 10,
  },
  qrImage: {
    width: QR_SIZE,
    height: QR_SIZE,
    borderRadius: 8,
    overflow: 'hidden',
  },
});
