// Focus target for the dossier evidence grid. A number is a track index (track buttons),
// and 'kiro' is the Include in Kiro Spec toggle. Kept free of DOM and three.js imports so
// it can be tested under node.
export type DossierFocusTarget = number | 'kiro';

export function focusSelectorFor(target: DossierFocusTarget): string {
  return typeof target === 'number'
    ? `.dosTrackBtn[data-track-idx="${target}"]`
    : '[data-kiro-toggle]';
}
