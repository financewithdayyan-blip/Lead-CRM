import type { ContractInstance } from '@/hooks/useContractInstances';

export type ContractBucket = 'draft' | 'sent' | 'yourTurn' | 'completed';

/** The one party who can actually act right now on a given envelope —
 * signing is strictly sequential, so at most one party is ever both
 * pending and unlocked. */
export function findPendingParty(instance: ContractInstance) {
  const ordered = [...instance.parties].sort((a, b) => a.signOrder - b.signOrder);
  return ordered.find(
    (p) => p.status === 'pending' && !ordered.some((other) => other.signOrder < p.signOrder && other.status !== 'signed'),
  );
}

/** "Your Turn" means the next unlocked signer is our own side of the deal —
 * the built-in 'buyer' role, or any extra role the template itself labels
 * "Buyer" (Cash Deal's second, countersigning slot — see the Blue Docs
 * contract-flow plan). Every other in-flight envelope (waiting on the
 * seller or an outside party) is "Sent"; declined/voided/expired ones land
 * there too, still flagged by their own red badge, since the flow stalled
 * rather than actually completing. */
export function bucketFor(instance: ContractInstance): ContractBucket {
  if (instance.status === 'draft') return 'draft';
  if (instance.status === 'signed') return 'completed';
  const pending = findPendingParty(instance);
  if (!pending) return 'sent';
  const isUs =
    pending.role === 'buyer' ||
    instance.templatePartyRoles.find((r) => r.id === pending.role)?.label.trim().toLowerCase() === 'buyer';
  return isUs ? 'yourTurn' : 'sent';
}

/** Latest envelope per template (by created_at) — the Contracts table shows
 * one row per document, reflecting whichever envelope was sent last for it;
 * full history of every send for a reused template stays on the Envelopes
 * board. */
export function latestInstanceByTemplate(instances: ContractInstance[]): Map<string, ContractInstance> {
  const map = new Map<string, ContractInstance>();
  for (const inst of instances) {
    if (!inst.templateId) continue;
    const existing = map.get(inst.templateId);
    if (!existing || inst.createdAt > existing.createdAt) map.set(inst.templateId, inst);
  }
  return map;
}
