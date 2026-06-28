export function getMatchTeamName(match, side, pickText) {
  const name = pickText?.(match?.[`${side}_name`], match?.[`${side}_name_en`], match?.[`${side}_name_ar`]);
  if (name) return { name, placeholder: false };

  const label = pickText?.(match?.[`${side}_label_he`], match?.[`${side}_label_en`], match?.[`${side}_label_ar`]);
  if (label) return { name: label, placeholder: true };

  return { name: match?.[`${side}_code`] || 'TBD', placeholder: true };
}

export function getStageTabTitle(t, stageKey) {
  return t(`stages.${stageKey}`);
}
