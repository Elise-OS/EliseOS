import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { t } from '../i18n';
import { colors } from '../theme';

/**
 * Shown once the mobile setup is done: the home and the sensors are configured
 * on a computer, so this invites the user to open the Élise web dashboard.
 */
export function WebHandoffModal({
  visible,
  addresses,
  onClose,
}: {
  visible: boolean;
  addresses: { name: string | null; ip: string | null };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const rows = [
    addresses.name ? { url: addresses.name, label: t('webHandoff.nameLabel') } : null,
    addresses.ip ? { url: addresses.ip, label: t('webHandoff.ipLabel') } : null,
  ].filter((row): row is { url: string; label: string } => row !== null);

  const close = () => {
    setCopied(null);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.content} bounces={false}>
            <View style={styles.icon}>
              <Ionicons name="desktop-outline" size={26} color="#fff" />
            </View>
            <Text style={styles.kicker}>{t('webHandoff.kicker')}</Text>
            <Text style={styles.title}>{t('webHandoff.title')}</Text>
            <Text style={styles.text}>{t('webHandoff.text')}</Text>

            <View style={styles.tasks}>
              {(['home', 'rooms', 'sensors'] as const).map((key) => (
                <View key={key} style={styles.task}>
                  <Ionicons name="checkmark-circle-outline" size={18} color={colors.green} />
                  <Text style={styles.taskText}>{t(`webHandoff.tasks.${key}`)}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.howTo}>{t('webHandoff.howTo')}</Text>
            {rows.length === 0 ? (
              <Text style={styles.text}>{t('webHandoff.noAddress')}</Text>
            ) : (
              rows.map(({ url, label }) => (
                <View key={url} style={styles.addressCard}>
                  <Text style={styles.addressLabel}>{label}</Text>
                  <Text style={styles.addressValue} selectable>
                    {url}
                  </Text>
                  <View style={styles.addressActions}>
                    <Pressable
                      style={[styles.small, copied === url && styles.smallDone]}
                      accessibilityRole="button"
                      onPress={() => void Clipboard.setStringAsync(url).then(() => setCopied(url))}
                    >
                      <Ionicons
                        name={copied === url ? 'checkmark' : 'copy-outline'}
                        size={16}
                        color={copied === url ? '#fff' : colors.navy}
                      />
                      <Text style={[styles.smallText, copied === url && styles.smallTextDone]}>
                        {copied === url ? t('webHandoff.copied') : t('webHandoff.copy')}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={styles.small}
                      accessibilityRole="link"
                      onPress={() => void Linking.openURL(url).catch(() => {})}
                    >
                      <Ionicons name="open-outline" size={16} color={colors.navy} />
                      <Text style={styles.smallText}>{t('webHandoff.open')}</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
            {rows.length > 1 ? <Text style={styles.hint}>{t('webHandoff.fallback')}</Text> : null}

            <Pressable style={styles.primary} accessibilityRole="button" onPress={close}>
              <Text style={styles.primaryText}>{t('webHandoff.done')}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    padding: 18,
  },
  sheet: {
    width: '100%',
    maxWidth: 540,
    maxHeight: '92%',
    alignSelf: 'center',
    borderRadius: 24,
    backgroundColor: colors.paper,
    overflow: 'hidden',
  },
  content: { padding: 22, gap: 12 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kicker: { color: colors.accent, fontSize: 13, fontWeight: '800', letterSpacing: 0.8 },
  title: { color: colors.navy, fontSize: 23, lineHeight: 30, fontWeight: '700' },
  text: { color: colors.muted, fontSize: 16, lineHeight: 23 },
  tasks: { gap: 8, paddingVertical: 4 },
  task: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  taskText: { flex: 1, color: colors.navy, fontSize: 16, fontWeight: '600' },
  howTo: { color: colors.navy, fontSize: 16, lineHeight: 23, fontWeight: '700', marginTop: 4 },
  addressCard: {
    padding: 14,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.greenSoft,
    gap: 8,
  },
  addressLabel: { color: colors.muted, fontSize: 13, fontWeight: '800', letterSpacing: 0.6 },
  addressValue: {
    color: colors.navy,
    fontSize: 20,
    lineHeight: 27,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  addressActions: { flexDirection: 'row', gap: 8 },
  small: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  smallDone: { backgroundColor: colors.green, borderColor: colors.green },
  smallText: { color: colors.navy, fontSize: 15, fontWeight: '700' },
  smallTextDone: { color: '#fff' },
  hint: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  primary: {
    marginTop: 6,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
