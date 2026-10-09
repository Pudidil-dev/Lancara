/** Only the latest user exchange is conversational memory; stored chat is not a change log. */
export function latestExchange<T extends { role: string; text: string }>(history: T[]): T[] {
  const start = history.findLastIndex(turn => turn.role === 'user')
  return start < 0 ? [] : history.slice(start)
}
