import client from '@/services/client.service'
import { Event } from 'nostr-tools'
import { tagWriteRelays } from './relays'

/**
 * Publish a signed tagging event to the tag write lane (tag-hub relays ∪ the
 * user's write relays). Success = accepted by at least one relay; per-relay
 * failures are collected so callers can report partial results the way Jumble
 * reports other publish outcomes.
 */
export async function publishTagEvent(signed: Event): Promise<{
  successes: string[]
  failures: { url: string; error: string }[]
}> {
  const relays = await tagWriteRelays()
  const results = await Promise.allSettled(
    // One publish per relay: client.publishEvent's success quota is relative to
    // the relay-set size, and the tagging contract is "accepted by ≥1 relay".
    relays.map((url) => client.publishEvent([url], signed))
  )
  const successes: string[] = []
  const failures: { url: string; error: string }[] = []
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      successes.push(relays[i])
    } else {
      const reason = result.reason
      const message =
        reason instanceof AggregateError
          ? reason.errors.map((e) => (e instanceof Error ? e.message : String(e))).join('; ')
          : reason instanceof Error
            ? reason.message
            : String(reason)
      failures.push({ url: relays[i], error: message })
    }
  })
  if (successes.length === 0) {
    throw new Error(
      failures.map(({ url, error }) => `${url}: ${error}`).join('; ') || 'No relays accepted the event'
    )
  }
  return { successes, failures }
}
