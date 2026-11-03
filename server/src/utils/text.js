const PREVIEW_LENGTH = 140;

/** One-line message preview for lists and live events: at most 140 characters, ellipsis if cut. */
export const preview = (text = '') =>
  text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…` : text;
