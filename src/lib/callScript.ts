import type { ScriptAnswers } from '@/types/domain';

export interface ScriptSubQuestion {
  key: keyof ScriptAnswers;
  prompt: string;
}

export interface ScriptStepDef {
  title: string;
  questions: ScriptSubQuestion[];
}

export const SCRIPT_STEPS: ScriptStepDef[] = [
  {
    title: 'Motivation',
    questions: [
      { key: 'motivation_owned', prompt: 'How long have you owned it?' },
      { key: 'motivation_reason', prompt: "What's the motivation for you to sell?" },
      { key: 'motivation_now', prompt: 'Why are you looking to sell now?' },
    ],
  },
  {
    title: 'Condition',
    questions: [
      { key: 'condition_general', prompt: 'Tell me a bit more about the condition of your property.' },
      { key: 'condition_rating', prompt: 'What would you rate it out of 10 if you were in my shoes?' },
      { key: 'condition_issues', prompt: 'Any major issues that I should know about?' },
      { key: 'condition_hvac', prompt: 'What about HVAC?' },
      { key: 'condition_plumbing', prompt: 'Is Plumbing PVC or Iron Cast?' },
      { key: 'condition_roof', prompt: 'How old is the Roof?' },
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
