/**
 * The sending identity keys send-sms recognizes (ZOOM_FROM_NUMBER,
 * ZOOM_FROM_NUMBER_2, _3, _4 server-side). Not every key is necessarily
 * configured in a given environment — the edge functions fall back to unused
 * slots being blank and simply excluded from a bulk auto-split — but the
 * client has no visibility into which are actually live, so every slot is
 * offered here for manual single-number picks (a reply, or a one-lead send).
 */
export const SMS_NUMBER_KEYS = ['1', '2', '3', '4'] as const;
export type SmsNumberKey = (typeof SMS_NUMBER_KEYS)[number];
