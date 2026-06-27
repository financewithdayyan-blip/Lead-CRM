import type { ScriptAnswers } from '@/types/domain';

export interface ScriptStepDef {
  key: keyof ScriptAnswers;
  title: string;
  prompt: string;
  multiline: boolean;
}

export const SCRIPT_STEPS: ScriptStepDef[] = [
  {
    key: 'motivation',
    title: 'Motivation',
    prompt: "Tell me a little about the property. How long have you owned it? What's prompting you to sell? Why are you looking to sell now?",
    multiline: true,
  },
  {
    key: 'condition',
    title: 'Condition',
    prompt:
      'Tell me a bit more about the condition of your property. Any plumbing, electrical, HVAC, foundational, or roof issues? How old is the roof?',
    multiline: true,
  },
  {
    key: 'timeline',
    title: 'Timeline',
    prompt: 'When would you like to close? Is there a specific date you are working toward?',
    multiline: true,
  },
  {
    key: 'price',
    title: 'Price',
    prompt: 'What are you hoping to get for the property? How did you arrive at that number?',
    multiline: true,
  },
  {
    key: 'decision',
    title: 'Decision',
    prompt: 'Is anyone else involved in making the decision?',
    multiline: true,
  },
  {
    key: 'photo_request',
    title: 'Photo Request',
    prompt:
      "Great, I really appreciate your time today. So our team can evaluate the property properly, could you send a few photos of the interior and exterior? You can send them to me — any photos of interior and exterior from your phone work great.",
    multiline: true,
  },
  {
    key: 'callback',
    title: 'Callback',
    prompt: 'When is a good time to call you back?',
    multiline: false,
  },
];
