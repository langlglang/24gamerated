/**
 * On phones, open the system share sheet (Messages, WhatsApp, ...), which is
 * how people actually send a result or an invite. Elsewhere, copy instead.
 */
export function canNativeShare(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof matchMedia === 'function' &&
    matchMedia('(pointer: coarse)').matches
  );
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export async function shareOrCopy(data: { text: string; url?: string }): Promise<ShareOutcome> {
  if (canNativeShare()) {
    try {
      await navigator.share(data.url ? { text: data.text, url: data.url } : { text: data.text });
      return 'shared';
    } catch (err) {
      // Closing the sheet is a choice, not an error: don't copy behind their back.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(data.url ? `${data.text} ${data.url}` : data.text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
