// The ten people who can sign in. Names are not secret; passwords are what protect the accounts.
// Each name maps to a Supabase account with the email  <key>@<domain>.
export const DOMAIN = import.meta.env.VITE_EMAIL_DOMAIN || 'patriotreview.example';

export const ROSTER = [
  { key: 'chloe', name: 'Chloe / Mrs. Stafford' },
  { key: 'elijah', name: 'Elijah' },
  { key: 'isabella', name: 'Isabella' },
  { key: 'jack', name: 'Jack' },
  { key: 'josie', name: 'Josie' },
  { key: 'lina', name: 'Lina' },
  { key: 'lucy', name: 'Lucy' },
  { key: 'lydia', name: 'Lydia' },
  { key: 'nathan', name: 'Nathan' },
  { key: 'sophia', name: 'Sophia' },
];

export const emailFor = (person) => `${person.key}@${DOMAIN}`;
