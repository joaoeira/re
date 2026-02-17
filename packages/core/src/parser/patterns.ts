/**
 * Match metadata lines, accounting for optional \r from CRLF line endings.
 * When splitting on \n, CRLF files leave trailing \r on each line.
 *
 * Captures the content between <!--@ and -->
 */
export const METADATA_LINE_PATTERN = /^<!--@ (.+)-->\r?$/;
