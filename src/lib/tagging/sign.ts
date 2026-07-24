import client from '@/services/client.service'
import { Event } from 'nostr-tools'
import type { TUnsignedTagEvent } from './sdk/event-tagging/index.js'

/**
 * Adapter from Jumble's signer abstraction to the SDK orchestrators'
 * `deps.sign(unsigned)` contract. Signing always goes through the logged-in
 * account's signer (NIP-07 et al) — keys are never touched here.
 */

export const now = () => Math.floor(Date.now() / 1000)

export async function signTagEvent(
  unsigned: TUnsignedTagEvent & { pubkey?: string; created_at?: number }
): Promise<Event> {
  const signer = client.signer
  if (!signer) {
    throw new Error('You need to login first')
  }
  return signer.signEvent({
    kind: unsigned.kind,
    tags: unsigned.tags,
    content: unsigned.content,
    created_at: unsigned.created_at ?? now()
  })
}
