import type { ScriptAnswers } from '@/types/domain';
import { LIEN_TAG_NAMES } from '@/hooks/useAiReplyConfig';

export interface ScriptSubQuestion {
  key: keyof ScriptAnswers;
  prompt: string;
}

export interface ScriptStepDef {
  title: string;
  questions: ScriptSubQuestion[];
}

// Re-exported so callers only need one import to decide whether a given
// lead's steps should include Mortgage — same tag list LIEN_ADDENDUM uses
// server-side to decide whether the AI asks these questions at all.
export { LIEN_TAG_NAMES };

const STEPS_BEFORE_MORTGAGE: ScriptStepDef[] = [
  {
    title: 'Confirmation',
    questions: [
      { key: 'confirmation_owner', prompt: 'Are you the owner of the property, or someone who can speak for them?' },
    ],
  },
  {
    title: 'Motivation',
    questions: [
      { key: 'motivation_owned', prompt: 'How long have you owned it?' },
      { key: 'motivation_reason', prompt: "What's the motivation for you to sell?" },
    ],
  },
  {
    title: 'Condition',
    questions: [
      { key: 'condition_general', prompt: 'Tell me a bit more about the condition of your property.' },
      { key: 'condition_rating', prompt: 'What would you rate it out of 10 if you were in my shoes?' },
      { key: 'condition_issues', prompt: 'Any major issues that I should know about?' },
      { key: 'condition_hvac', prompt: 'What about HVAC?' },
      { key: 'condition_electrical', prompt: 'What about the electrical, is it updated or still older wiring?' },
      { key: 'condition_plumbing', prompt: 'Is Plumbing PVC or Iron Cast?' },
      { key: 'condition_roof', prompt: 'How old is the Roof?' },
      { key: 'condition_foundation', prompt: 'Any issues with the foundation, cracks or settling?' },
      { key: 'condition_leaks', prompt: 'Any leaks or water damage anywhere in the house?' },
      { key: 'condition_mold', prompt: 'Any mold that you know of?' },
    ],
  },
  {
    title: 'Timeline',
    questions: [
      { key: 'timeline', prompt: 'When would you like to close? Is there a specific date you are working toward?' },
    ],
  },
  {
    title: 'Price',
    questions: [
      { key: 'price_asking', prompt: 'What are you hoping to get for the property?' },
      { key: 'price_reasoning', prompt: 'How did you arrive at that number?' },
    ],
  },
];

/** Foreclosure/lis pendens/auction leads only — see LIEN_ADDENDUM in
 * useAiReplyConfig.ts, which is what actually tells the AI to ask these on
 * these tags. Deliberately left out of the default step list so a normal
 * lead's framework isn't stuck permanently "incomplete" waiting on mortgage
 * questions nobody's meant to ask them. */
const MORTGAGE_STEP: ScriptStepDef = {
  title: 'Mortgage',
  questions: [
    { key: 'mortgage_payment', prompt: "What's your monthly mortgage payment?" },
    { key: 'mortgage_balance', prompt: "What's the total remaining balance owed on the mortgage?" },
    { key: 'mortgage_rate', prompt: "What's your interest rate?" },
    { key: 'mortgage_statement', prompt: 'Could you email a copy of your mortgage statement to dayyan@bluebirdacquisition.com?' },
  ],
};

const STEPS_AFTER_MORTGAGE: ScriptStepDef[] = [
  {
    title: 'Decision',
    questions: [
      { key: 'decision', prompt: 'Is anyone else involved in making the decision?' },
    ],
  },
  {
    title: 'Photo Request',
    questions: [
      {
        key: 'photo_request',
        prompt:
          'Great, I really appreciate your time today. So our team can evaluate the property properly, could you send a few photos of the interior and exterior? You can send them to me — any photos of interior and exterior from your phone work great.',
      },
    ],
  },
  {
    title: 'Callback',
    questions: [{ key: 'callback', prompt: 'When is a good time to call you back?' }],
  },
];

/** The default framework — no Mortgage step, matching every lead without a
 * foreclosure/lis pendens/auction tag. Kept as a plain export (rather than
 * only the function below) since most callers don't have tag context handy
 * for a quick reference. */
export const SCRIPT_STEPS: ScriptStepDef[] = [...STEPS_BEFORE_MORTGAGE, ...STEPS_AFTER_MORTGAGE];

/** The real steps for a given lead — insert Mortgage right after Price
 * (before Decision) when they're tagged Lis Pendens, Pre-Foreclosure,
 * Foreclosure, or Auction, exactly where LIEN_ADDENDUM places it in the
 * conversation itself. */
export function getScriptSteps(hasMortgageStep: boolean): ScriptStepDef[] {
  return hasMortgageStep ? [...STEPS_BEFORE_MORTGAGE, MORTGAGE_STEP, ...STEPS_AFTER_MORTGAGE] : SCRIPT_STEPS;
}
