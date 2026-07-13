/** Discord server nicknames use the first whitespace-delimited part of the
 * participant's full profile name. The full name remains in WTA data. */
export function discordFirstName(fullName: string): string {
  return String(fullName ?? '').trim().split(/\s+/)[0]?.slice(0, 32) ?? '';
}
