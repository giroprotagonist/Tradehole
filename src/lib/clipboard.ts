/**
 * Copy text reliably in Electron (async builds often lose document focus,
 * which makes navigator.clipboard.writeText throw NotAllowedError).
 */
export async function copyText(text: string): Promise<void> {
  if (window.tradehole?.writeClipboard) {
    await window.tradehole.writeClipboard(text);
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* fall through to DOM fallback */
  }

  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) {
    throw new Error("Clipboard copy failed");
  }
}
