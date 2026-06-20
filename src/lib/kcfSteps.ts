export interface KcfQuestion {
  text: string;
  key: string;
  answerType: 'yesno' | 'input' | 'choice' | 'yesno_input';
  inputPlaceholder?: string;
  choices?: string[];
}

export interface KcfField {
  key: string;
  label: string;
  placeholder: string;
  type: 'text' | 'textarea';
}

export interface KcfStep {
  id: string;
  title: string;
  prompt: string;
  questions: KcfQuestion[];
  fields: KcfField[];
}

export const KCF_STEPS: KcfStep[] = [
  {
    id: 'intro',
    title: 'Step 1 — Introduction & Permission',
    prompt:
      '"Hi, is this [Seller Name]? My name is [Your Name]. I\'m calling about the property at [Address]. Do you have a few minutes to talk about it?"\n\n"So we are basically fix and flippers and have hired a private investigator to find us properties — he\'s given us your address and number. We are interested in buying your house."',
    questions: [],
    fields: [],
  },
  {
    id: 'confirm',
    title: 'Step 2 — Confirm They Want to Sell',
    prompt: 'Ask if they are open to selling.',
    questions: [{ text: 'Are you interested in selling your house for the right price?', key: 'q_confirm_1', answerType: 'yesno' }],
    fields: [{ key: 'confirmNotes', label: 'Additional notes', placeholder: 'e.g. Very motivated, timeline is tight…', type: 'textarea' }],
  },
  {
    id: 'rapport',
    title: 'Step 3 — Build Rapport & Discover Motivation',
    prompt: 'Don\'t jump to price — build rapport and find their real "why".',
    questions: [
      { text: 'Tell me a little about the property. How long have you owned it?', key: 'q_rapport_1', answerType: 'input', inputPlaceholder: 'How long owned / property details…' },
      { text: "What's prompting you to sell? Why are you looking to sell now?", key: 'q_rapport_2', answerType: 'input', inputPlaceholder: 'Their reason for selling…' },
    ],
    fields: [{ key: 'motivation', label: 'Summary — motivation / situation', placeholder: 'Reason for selling, timeline pressure…', type: 'textarea' }],
  },
  {
    id: 'condition',
    title: 'Step 4 — Property Condition',
    prompt: '"Tell me a bit more about the condition of your property."',
    questions: [
      { text: 'Tell me a bit more about the condition of your property.', key: 'q_cond_open', answerType: 'input', inputPlaceholder: 'General condition overview…' },
      { text: 'What would you rate it out of 10?', key: 'q_cond_rating', answerType: 'choice', choices: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] },
      { text: 'Any plumbing, electrical, HVAC, foundational, or roof issues?', key: 'q_cond_systems', answerType: 'yesno_input', inputPlaceholder: 'Describe any issues found…' },
    ],
    fields: [{ key: 'condition', label: 'Condition summary', placeholder: 'Rating, systems status, major issues…', type: 'textarea' }],
  },
  {
    id: 'timeline',
    title: 'Step 5 — Timeline',
    prompt: 'Understand their urgency and ideal closing window.',
    questions: [{ text: "Is there a specific date you're working toward?", key: 'q_time_2', answerType: 'yesno_input', inputPlaceholder: 'Target date / deadline…' }],
    fields: [{ key: 'timeline', label: 'Their timeline summary', placeholder: 'e.g. ASAP, 60 days, flexible…', type: 'text' }],
  },
  {
    id: 'price',
    title: 'Step 6 — Price Questions',
    prompt: '"What are you hoping to get for the property?" — If they ask your number first: "Before I throw out a number, I\'d like to understand where you were hoping to be. What price did you have in mind?"',
    questions: [{ text: 'What are you hoping to get for the property?', key: 'q_price_1', answerType: 'input', inputPlaceholder: 'Their price expectation…' }],
    fields: [{ key: 'askingPrice', label: 'Their asking price ($)', placeholder: 'e.g. 150,000', type: 'text' }],
  },
  {
    id: 'pricelogic',
    title: 'Step 7 — Understand Their Number',
    prompt: "Probe what's behind their asking price after they give you a number.",
    questions: [{ text: 'How did you arrive at that number?', key: 'q_pl_1', answerType: 'input', inputPlaceholder: 'Zillow, agent advice, neighbor sold…' }],
    fields: [{ key: 'priceLogic', label: 'Their reasoning summary', placeholder: 'Zillow, agent told them, neighbor sold for…', type: 'textarea' }],
  },
  {
    id: 'negotiation',
    title: 'Step 8 — Negotiation',
    prompt: 'Note any negotiation leverage or priorities the seller mentions.',
    questions: [],
    fields: [{ key: 'negotiationNotes', label: 'Negotiation notes', placeholder: 'Speed, convenience, covering costs…', type: 'textarea' }],
  },
  {
    id: 'commitment',
    title: 'Step 9 — Commitment',
    prompt: 'Confirm who is involved in the decision.',
    questions: [{ text: 'Is anyone else involved in making the decision?', key: 'q_com_2', answerType: 'yesno_input', inputPlaceholder: 'Who else is involved?' }],
    fields: [{ key: 'commitmentNotes', label: 'Decision makers summary', placeholder: 'Spouse involved, needs attorney, ready to sign…', type: 'textarea' }],
  },
  {
    id: 'close',
    title: 'Step 10 — Property Photos & Follow-Up',
    prompt:
      '"Great, I really appreciate your time today. So our team can evaluate the property properly, could you send a few photos of the interior and exterior? You can send them to dayyan@bluebirdacquisition.com — any photos from your phone work great."',
    questions: [{ text: 'What is the best time to call you back?', key: 'q_close_callback', answerType: 'input', inputPlaceholder: 'e.g. Tomorrow morning after 10am, weekdays after 3pm…' }],
    fields: [
      { key: 'finalPrice', label: 'Final / bottom-line price ($)', placeholder: 'e.g. 95,000', type: 'text' },
      { key: 'callbackTime', label: 'Best callback time (summary)', placeholder: 'e.g. Tomorrow morning after 10am', type: 'text' },
    ],
  },
];

export function substitutePromptVars(prompt: string, sellerName: string, address: string) {
  return prompt
    .replace(/\[Seller Name\]/g, sellerName)
    .replace(/\[Address\]/g, address)
    .replace(/\[Your Name\]/g, '[Your Name]');
}
