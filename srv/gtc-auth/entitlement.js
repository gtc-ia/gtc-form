const ACTIVE_STATUSES = ['active', 'trialing'];

export function isEntitlementActive(record) {
  if (!record) return false;
  const status = record.status ? String(record.status).toLowerCase() : '';
  if (!ACTIVE_STATUSES.includes(status)) return false;
  if (!record.end_date) return true;
  const expiresAt = new Date(record.end_date);
  if (Number.isNaN(expiresAt.getTime())) return true;
  return expiresAt.getTime() > Date.now();
}

export { ACTIVE_STATUSES };
