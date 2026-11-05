import { Ionicons } from '@expo/vector-icons';
import { FLAG_VIEWBOX, FLAGS } from '@elise/i18n';
import { useId, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, { ClipPath, Defs, G, Path, Rect } from 'react-native-svg';
import { LANGUAGES, type Language } from '.';

const ink = '#0B2948';
const muted = '#586574';
const line = '#DDE3DE';
const paper = '#FDFBF7';

/** The flag of a language, the same drawing as on the web dashboard. */
export function FlagIcon({ language, width = 24 }: { language: Language; width?: number }) {
  const { width: boxWidth, height: boxHeight, radius } = FLAG_VIEWBOX;
  // One id per drawing: the menu shows the same flag twice.
  const clip = `flag-${language}-${useId().replace(/:/g, '')}`;
  return (
    <Svg
      width={width}
      height={(width * boxHeight) / boxWidth}
      viewBox={`0 0 ${boxWidth} ${boxHeight}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <ClipPath id={clip}>
          <Rect width={boxWidth} height={boxHeight} rx={radius} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${clip})`}>
        {FLAGS[language].map(({ kind, ...shape }, index) =>
          kind === 'rect' ? (
            <Rect key={index} {...shape} />
          ) : (
            <Path key={index} fill={shape.fill ?? 'none'} {...shape} />
          ),
        )}
      </G>
      <Rect
        width={boxWidth}
        height={boxHeight}
        rx={radius}
        fill="none"
        stroke="rgba(0,0,0,0.15)"
        strokeWidth={20}
      />
    </Svg>
  );
}

function LanguageRow({
  language,
  selected,
  onPress,
  textStyle,
  framed = false,
}: {
  language: (typeof LANGUAGES)[number];
  selected: boolean;
  onPress: () => void;
  textStyle?: StyleProp<TextStyle>;
  framed?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={language.name}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.row,
        framed && styles.rowFramed,
        selected && styles.rowSelected,
        pressed && styles.pressed,
      ]}
    >
      <FlagIcon language={language.code} />
      <Text style={[styles.rowText, selected && styles.rowTextSelected, textStyle]}>
        {language.name}
      </Text>
      {selected ? <Ionicons name="checkmark-circle" size={20} color={ink} /> : null}
    </Pressable>
  );
}

/**
 * Compact choice for a header: the current flag and code; a tap opens the list of languages
 * just below the button.
 */
export function LanguageMenu({
  value,
  onChange,
  label,
  style,
  textStyle,
}: {
  value: Language;
  onChange: (language: Language) => void;
  /** Spoken name of the control ("Langue", "Language"…). */
  label: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const anchor = useRef<View>(null);
  const window = useWindowDimensions();
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null);
  const open = () =>
    anchor.current?.measureInWindow((x, y, width, height) =>
      setMenu({ top: y + height + 6, right: Math.max(12, window.width - x - width) }),
    );
  const choose = (language: Language) => {
    setMenu(null);
    if (language !== value) onChange(language);
  };
  return (
    <>
      <Pressable
        ref={anchor}
        testID="language-menu"
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`${label} : ${LANGUAGES.find(({ code }) => code === value)?.name ?? value}`}
        accessibilityState={{ expanded: Boolean(menu) }}
        style={({ pressed }) => [styles.button, style, pressed && styles.pressed]}
      >
        <FlagIcon language={value} width={22} />
        <Text style={[styles.buttonText, textStyle]}>{value.toUpperCase()}</Text>
        <Ionicons name="chevron-down" size={15} color={muted} />
      </Pressable>
      <Modal
        visible={Boolean(menu)}
        transparent
        animationType="fade"
        onRequestClose={() => setMenu(null)}
      >
        {/* Tapping outside closes the menu; screen readers close it with the escape gesture. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setMenu(null)}
          accessible={false}
        />
        {menu ? (
          <View
            style={[styles.menu, { top: menu.top, right: menu.right }]}
            accessibilityRole="menu"
            accessibilityLabel={label}
            accessibilityViewIsModal
            onAccessibilityEscape={() => setMenu(null)}
          >
            {LANGUAGES.map((language) => (
              <LanguageRow
                key={language.code}
                language={language}
                selected={language.code === value}
                onPress={() => choose(language.code)}
                textStyle={textStyle}
              />
            ))}
          </View>
        ) : null}
      </Modal>
    </>
  );
}

/** Every language as a row, for a settings page. */
export function LanguageList({
  value,
  onChange,
  label,
}: {
  value: Language;
  onChange: (language: Language) => void;
  label: string;
}) {
  return (
    <View style={styles.list} accessibilityLabel={label}>
      {LANGUAGES.map((language) => (
        <LanguageRow
          key={language.code}
          language={language}
          selected={language.code === value}
          onPress={() => {
            if (language.code !== value) onChange(language.code);
          }}
          framed
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: line,
    backgroundColor: '#F1F3EF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  buttonText: { color: ink, fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  pressed: { opacity: 0.75 },
  menu: {
    position: 'absolute',
    minWidth: 190,
    padding: 6,
    gap: 2,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: line,
    backgroundColor: paper,
    shadowColor: ink,
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  list: { gap: 8 },
  row: {
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowFramed: { borderColor: line, backgroundColor: paper },
  rowSelected: { borderColor: line, backgroundColor: '#EEF2EF' },
  rowText: { flex: 1, color: muted, fontSize: 15, fontWeight: '600' },
  rowTextSelected: { color: ink, fontWeight: '800' },
});
