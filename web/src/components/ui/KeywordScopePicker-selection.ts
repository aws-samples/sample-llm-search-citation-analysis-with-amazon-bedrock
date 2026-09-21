/** Pure id-selection arithmetic for `KeywordScopePicker`; kept apart from the component so the picker stays under the file-length cap. */

export function knownIdsInInputOrder(allIds: readonly string[], selectedIds: readonly string[]): string[] {
  const selected = new Set(selectedIds);
  return [...new Set(allIds)].filter((id) => selected.has(id));
}

export function cappedSectionSelection(
  allIds: readonly string[], selectedIds: readonly string[], sectionIds: readonly string[], maxSelectionCount: number
): string[] {
  const orderedIds = [...new Set(allIds)];
  const selected = new Set(selectedIds);
  const sectionIdSet = new Set(sectionIds);
  const orderedSectionIds = orderedIds.filter((id) => sectionIdSet.has(id));
  const selectedOutsideSection = orderedIds.filter(
    (id) => selected.has(id) && !sectionIdSet.has(id)
  );
  const targetCount = Math.min(
    orderedSectionIds.length,
    Math.max(0, maxSelectionCount - selectedOutsideSection.length)
  );
  const targetIds = orderedSectionIds.slice(0, targetCount);
  const selectedInSection = orderedSectionIds.filter((id) => selected.has(id));
  const targetIsSelected = selectedInSection.length === targetIds.length
    && targetIds.every((id) => selected.has(id));
  if (targetIsSelected) return selectedOutsideSection;
  return knownIdsInInputOrder(orderedIds, [...selectedOutsideSection, ...targetIds]);
}
