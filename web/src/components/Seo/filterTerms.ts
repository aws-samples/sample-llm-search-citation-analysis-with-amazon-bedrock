/** Include / exclude filter terms: split on `,` or `+`, trimmed, empty ones dropped. */
export function splitTerms(text: string): string[] {
  return text.split(/[,+]/).map((term) => term.trim()).filter((term) => term !== '');
}
