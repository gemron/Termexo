const ANSI_SEQUENCE =
  /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const MAX_RETAINED_CHARACTERS = 40_000;

/** Turns raw PTY output into plain text so it can be searched, matched against, or stored. */
export function stripTerminalControl(value: string, maxCharacters = MAX_RETAINED_CHARACTERS): string {
  return value
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(ANSI_SEQUENCE, '')
    .replace(/\r/g, '')
    .replace(CONTROL_CHARACTERS, '')
    .slice(-maxCharacters);
}
