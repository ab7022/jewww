/**
 * Can Jev run on this tab right now? Answered by trying, not by reading a list.
 *
 * `chrome.permissions.contains` answers for the optional permissions the extension
 * requested — but a person can also grant access from Chrome's own extensions menu
 * ("On all sites", "On youtube.com"), and that grant is not always reflected there.
 * Asking the permission list therefore prompted, every run, someone who had already
 * given Jev every site. Injecting a no-op script succeeds exactly when Jev has access,
 * however it was granted, and does nothing to the page.
 */
export async function canRunOn(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => true });
    return true;
  } catch {
    return false;
  }
}
