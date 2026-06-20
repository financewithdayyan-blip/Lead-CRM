import type { CallLogEntry, Lead } from '@/types/domain';
import { STATUS_CONFIG } from '@/types/domain';

export interface LeadScoreResult {
  score: number;
  reasons: string[];
}

const STATUS_BONUS: Partial<Record<Lead['status'], number>> = {
  followup: 6,
  followup2: 8,
  followup3: 10,
  contract: 10,
  onhold: 3,
};

export function computeLeadScore(lead: Lead, callLog: CallLogEntry[]): LeadScoreResult {
  let score = 0;
  const reasons: string[] = [];

  if (lead.rating >= 5) {
    score += 25;
    reasons.push('5★ rating');
  } else if (lead.rating >= 4) {
    score += 18;
    reasons.push('4★ rating');
  } else if (lead.rating >= 3) {
    score += 10;
    reasons.push('3★ rating');
  } else if (lead.rating >= 1) {
    score += 4;
    reasons.push('rated');
  }

  const propertyRating = lead.propertyRating ?? 0;
  if (propertyRating >= 8) {
    score += 20;
    reasons.push('great condition');
  } else if (propertyRating >= 5) {
    score += 12;
    reasons.push('fair condition');
  } else if (propertyRating >= 1) {
    score += 5;
    reasons.push('condition noted');
  }

  const mot = (lead.motivation ?? '').toLowerCase();
  if (mot.includes('high') || mot.includes('urgent') || mot.includes('asap') || mot.includes('immediately')) {
    score += 20;
    reasons.push('high motivation');
  } else if (mot.includes('medium') || mot.includes('moderate') || mot.includes('open')) {
    score += 10;
    reasons.push('medium motivation');
  } else if (mot.length > 2) {
    score += 4;
    reasons.push('motivation noted');
  }

  if (lead.arv && lead.asIs) {
    const equityPct = (lead.arv - lead.asIs) / lead.arv;
    if (equityPct >= 0.35) {
      score += 15;
      reasons.push('35%+ equity');
    } else if (equityPct >= 0.2) {
      score += 10;
      reasons.push('20%+ equity');
    } else if (equityPct >= 0.1) {
      score += 5;
      reasons.push('10%+ equity');
    }
  }

  const callCount = callLog.filter((c) => c.leadId === lead.id).length;
  if (callCount >= 3) {
    score += 10;
    reasons.push('3+ call interactions');
  } else if (callCount >= 2) {
    score += 6;
    reasons.push('2 call interactions');
  } else if (callCount >= 1) {
    score += 2;
    reasons.push('1 call logged');
  }

  const statusBonus = STATUS_BONUS[lead.status];
  if (statusBonus) {
    score += statusBonus;
    reasons.push(STATUS_CONFIG[lead.status]?.label ?? lead.status);
  }

  if (lead.followupDate) {
    score += 5;
    reasons.push('follow-up scheduled');
  }

  if (lead.note && lead.note.trim().length > 10) {
    score += 3;
    reasons.push('notes logged');
  }

  score = Math.min(100, Math.max(0, score));
  return { score, reasons };
}

export type ScoreTier = 'hot' | 'warm' | 'cold' | 'none';

export function getScoreTier(lead: Lead, callLog: CallLogEntry[]): { tier: ScoreTier; score: number; reasons: string[] } {
  if (!lead.calledAt && !lead.rating && !lead.propertyRating && !lead.motivation) {
    return { tier: 'none', score: 0, reasons: [] };
  }
  const { score, reasons } = computeLeadScore(lead, callLog);
  const tier: ScoreTier = score >= 60 ? 'hot' : score >= 30 ? 'warm' : 'cold';
  return { tier, score, reasons };
}
