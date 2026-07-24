import client from '@/services/client.service'
import { Event, Filter } from 'nostr-tools'
import { getTagRelayUrls, TRUST_RELAY_URLS } from './config'

/**
 * Relay routing for the tagging feature — two lanes:
 *  - tags/taggings (kind 39999): tag-hub relays ∪ the user's read/write relays
 *  - house trust artifacts (30382/3039x): the house trust relays (they are NOT
 *    on the hub) ∪ the tag read lane
 * All reads/writes go through Jumble's existing pool (client service) — no
 * second websocket pool.
 */

async function userRelayList() {
  if (!client.pubkey) return null
  try {
    return await client.fetchRelayList(client.pubkey)
  } catch {
    return null
  }
}

export async function tagReadRelays(): Promise<string[]> {
  const relayList = await userRelayList()
  return Array.from(new Set([...getTagRelayUrls(), ...(relayList?.read ?? [])]))
}

export async function tagWriteRelays(): Promise<string[]> {
  const relayList = await userRelayList()
  return Array.from(new Set([...getTagRelayUrls(), ...(relayList?.write ?? [])]))
}

/**
 * Keep only the latest event per replaceable coordinate (kind, pubkey, d-tag).
 * Every event kind this feature reads (39999, 30382, 30394) is
 * parameterized-replaceable, so this must run before any classification —
 * it is also what makes apply→dispute stance toggles resolve (same d, latest wins).
 */
export function latestByCoord(events: Event[]): Event[] {
  const latest = new Map<string, Event>()
  for (const event of events) {
    const d = event.tags.find((tag) => tag[0] === 'd')?.[1] ?? ''
    const coord = `${event.kind}:${event.pubkey}:${d}`
    const prev = latest.get(coord)
    if (!prev || event.created_at > prev.created_at) {
      latest.set(coord, event)
    }
  }
  return Array.from(latest.values())
}

/** One-shot query across the tag read lane, deduped to latest-per-coordinate. */
export async function fetchTagEvents(filter: Filter | Filter[]): Promise<Event[]> {
  const relays = await tagReadRelays()
  const events = await client.fetchEvents(relays, filter)
  return latestByCoord(events)
}

/** One-shot query across the trust lane (house trust relays ∪ tag read lane). */
export async function fetchTrustEvents(filter: Filter | Filter[]): Promise<Event[]> {
  const relays = await tagReadRelays()
  const events = await client.fetchEvents(
    Array.from(new Set([...TRUST_RELAY_URLS, ...relays])),
    filter
  )
  return latestByCoord(events)
}
