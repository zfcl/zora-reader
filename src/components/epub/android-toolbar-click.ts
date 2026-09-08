/** Must run in capture phase, before button handlers execute. */
export function suppressDuplicateAndroidToolbarClick(
  event: Pick<MouseEvent, 'isTrusted' | 'preventDefault' | 'stopImmediatePropagation'>,
  android: boolean,
  suppressUntil: number,
  now = Date.now(),
): void {
  if (android && event.isTrusted && now < suppressUntil) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}
