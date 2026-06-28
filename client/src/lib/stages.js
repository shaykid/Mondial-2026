export const MATCH_STAGES = [
  { key: 'group', label_he: 'שלב הבתים', label_en: 'Group Stage', label_ar: 'دور المجموعات', order: 0 },
  { key: 'round_of_32', label_he: '32 האחרונות', label_en: 'Round of 32', label_ar: 'دور الـ32', order: 1 },
  { key: 'round_of_16', label_he: 'שמינית הגמר', label_en: 'Round of 16', label_ar: 'دور الـ16', order: 2 },
  { key: 'quarter_final', label_he: 'רבע הגמר', label_en: 'Quarter-finals', label_ar: 'ربع النهائي', order: 3 },
  { key: 'semi_final', label_he: 'חצי הגמר', label_en: 'Semi-finals', label_ar: 'نصف النهائي', order: 4 },
  { key: 'third_place', label_he: 'מקום 3', label_en: 'Third-place Match', label_ar: 'مباراة المركز الثالث', order: 5 },
  { key: 'final', label_he: 'הגמר', label_en: 'Final', label_ar: 'النهائي', order: 6 }
];

export function getStageMeta(stage) {
  return MATCH_STAGES.find((item) => item.key === stage) || null;
}

export function stageLabel(stage, lang = 'he') {
  const meta = getStageMeta(stage);
  if (!meta) return stage || '';
  return meta[`label_${lang}`] || meta.label_he || meta.label_en || meta.label_ar || stage;
}
