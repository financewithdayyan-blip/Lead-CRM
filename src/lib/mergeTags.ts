interface MergeSource {
  firstName: string;
  lastName: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/** Same {{token}} syntax as the SMS templates (see MergeTagButtons), rendered
 * client-side here since document generation never leaves the browser. */
export function renderMergeTags(template: string, lead: MergeSource): string {
  return template
    .replace(/\{\{first_name\}\}/g, lead.firstName ?? '')
    .replace(/\{\{last_name\}\}/g, lead.lastName ?? '')
    .replace(/\{\{address\}\}/g, lead.address ?? '')
    .replace(/\{\{city\}\}/g, lead.city ?? '')
    .replace(/\{\{state\}\}/g, lead.state ?? '')
    .replace(/\{\{zip\}\}/g, lead.zip ?? '');
}
