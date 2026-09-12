/**
 * Shortest password the console accepts.
 *
 * Short enough not to annoy, long enough that guessing costs more than it is worth. The relay
 * enforces its own rule; this only keeps a doomed request from being sent at all.
 */
export const MIN_PASSWORD_LENGTH = 8;
