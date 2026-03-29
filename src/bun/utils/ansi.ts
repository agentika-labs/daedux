/**
 * Strip all ANSI escape sequences from a string.
 * Handles CSI (colors, cursor), OSC (title), DCS/PM/APC, character set selection,
 * keypad mode, and control characters (except tab, newline, carriage return).
 */
export const stripAnsi = (input: string): string =>
  input
    .replaceAll(/\u001B\[[0-9;?]*[a-zA-Z]/g, "") // CSI sequences (colors, cursor)
    .replaceAll(/\u001B\][^\u0007]*\u0007/g, "") // OSC sequences (title, etc)
    .replaceAll(/\u001B[PX^_][^\u001B]*\u001B\\/g, "") // DCS/PM/APC sequences
    .replaceAll(/\u001B[()][AB012]/g, "") // Character set selection
    .replaceAll(/\u001B[=>]/g, "") // Keypad mode
    .replaceAll(/[\u0000-\u0008\u000B\u000C\u000E-\u001A]/g, ""); // Control chars except \t\n\r
