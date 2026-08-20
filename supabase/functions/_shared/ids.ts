// Human-typeable random codes. Alphabet excludes 0/O and 1/I/L so a
// participant copying their resume code by hand can't confuse characters.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomChars(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function newParticipantId(): string {
  return `P-${randomChars(6)}`;
}

export function newResumeCode(): string {
  return `${randomChars(4)}-${randomChars(4)}`;
}

export function newSequenceId(): string {
  return crypto.randomUUID();
}
