// Политика конфиденциальности / пользовательское соглашение (T6.1 поток F, задача 3). Тексты — offline,
// apps/mobile/src/legal/*.ts (перенос docs/legal/*.ru.md). Рендер простой: блоки заголовок/абзац/список/
// таблица/цитата/разделитель, без внешней markdown-библиотеки — parseLegalMarkdown (../legal/index.ts).
import { ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LEGAL_DOCS, splitInline, type LegalBlock } from '../legal';
import type { RootScreenProps } from '../navigation/types';
import { colors, fonts } from '../theme';

type Props = RootScreenProps<'Policy'>;

export function PolicyScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const doc = LEGAL_DOCS[route.params.doc];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}>
      {doc.blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </ScrollView>
  );
}

function Inline({ text, style }: { text: string; style: StyleProp<TextStyle> }) {
  return (
    <Text style={style}>
      {splitInline(text).map((seg, i) => (
        <Text key={i} style={[seg.bold && styles.bold, seg.code && styles.code]}>
          {seg.text}
        </Text>
      ))}
    </Text>
  );
}

function BlockView({ block }: { block: LegalBlock }) {
  switch (block.type) {
    case 'heading':
      return <Inline text={block.text} style={block.level === 1 ? styles.h1 : styles.h2} />;
    case 'paragraph':
      return <Inline text={block.text} style={styles.paragraph} />;
    case 'note':
      return (
        <View style={styles.note}>
          <Inline text={block.text} style={styles.noteText} />
        </View>
      );
    case 'list':
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.listRow}>
              <Text style={styles.bullet}>—</Text>
              <Inline text={item} style={[styles.paragraph, styles.listText]} />
            </View>
          ))}
        </View>
      );
    case 'table':
      return (
        <View style={styles.table}>
          {block.rows.map((row, ri) => (
            <View key={ri} style={[styles.tableRow, ri > 0 && styles.tableRowBorder]}>
              {row.map((cell, ci) => (
                <View key={ci} style={styles.tableCell}>
                  {block.headers[ci] ? <Text style={styles.tableHeader}>{block.headers[ci]}</Text> : null}
                  <Inline text={cell} style={styles.paragraph} />
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    case 'divider':
      return <View style={styles.divider} />;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 14 },
  h1: { fontFamily: fonts.serif, fontSize: 24, lineHeight: 29, color: colors.text, marginBottom: 4 },
  h2: { fontFamily: fonts.serifMedium, fontSize: 18, lineHeight: 23, color: colors.text, marginTop: 6 },
  paragraph: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, color: colors.textMuted },
  bold: { fontFamily: fonts.sansSemi, color: colors.text },
  code: { fontFamily: fonts.mono, fontSize: 12.5, color: colors.accentBright },
  note: { padding: 13, borderRadius: 12, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderStrong },
  noteText: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, color: colors.textMuted },
  list: { gap: 8 },
  listRow: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  listText: { flex: 1 },
  bullet: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, color: colors.textDim },
  table: { borderRadius: 12, borderWidth: 1, borderColor: colors.divider, overflow: 'hidden' },
  tableRow: { padding: 12, gap: 6, backgroundColor: colors.surface },
  tableRowBorder: { borderTopWidth: 1, borderTopColor: colors.divider },
  tableCell: { gap: 2 },
  tableHeader: { fontFamily: fonts.monoRegular, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: colors.textDim },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 4 },
});
