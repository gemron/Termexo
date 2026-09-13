/**
 * Puts a browser page into full screen, where the browser allows it.
 *
 * Android browsers and iPadOS Safari take any element full screen; Safari on iPhone only does it
 * for video, so there the page is never offered the option. iPadOS still spells the API with the
 * `webkit` prefix, which is why both forms are read.
 */

interface PrefixedFullscreenDocument extends Document {
  readonly webkitFullscreenEnabled?: boolean;
  readonly webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface PrefixedFullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

const FULLSCREEN_CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;

export function pageFullscreenSupported(doc: Document = document): boolean {
  const prefixed = doc as PrefixedFullscreenDocument;
  return Boolean(doc.fullscreenEnabled || prefixed.webkitFullscreenEnabled);
}

export function isPageFullscreen(doc: Document = document): boolean {
  const prefixed = doc as PrefixedFullscreenDocument;
  return Boolean(doc.fullscreenElement ?? prefixed.webkitFullscreenElement);
}

/**
 * Enters full screen, or leaves it when already there.
 *
 * Must run inside the tap that asked for it: browsers refuse full screen without a user gesture.
 * Rejects when the browser refuses, so the caller can say why.
 */
export async function togglePageFullscreen(doc: Document = document): Promise<void> {
  const prefixedDocument = doc as PrefixedFullscreenDocument;
  if (isPageFullscreen(doc)) {
    await (doc.exitFullscreen?.() ?? prefixedDocument.webkitExitFullscreen?.());
    return;
  }
  const root = doc.documentElement as PrefixedFullscreenElement;
  // The browser's own navigation bar would otherwise stay over the bottom of the terminal.
  await (root.requestFullscreen?.({ navigationUI: 'hide' }) ?? root.webkitRequestFullscreen?.());
}

/** Calls `onChange` whenever the page enters or leaves full screen, including by the back key. */
export function watchPageFullscreen(onChange: () => void, doc: Document = document): () => void {
  for (const type of FULLSCREEN_CHANGE_EVENTS) {
    doc.addEventListener(type, onChange);
  }
  return () => {
    for (const type of FULLSCREEN_CHANGE_EVENTS) {
      doc.removeEventListener(type, onChange);
    }
  };
}
