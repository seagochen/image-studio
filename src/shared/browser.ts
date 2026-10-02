export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || Boolean(target.closest('[contenteditable]:not([contenteditable="false"])'))
    || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
