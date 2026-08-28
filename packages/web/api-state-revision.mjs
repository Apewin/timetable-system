function validRevision(value) {
  if (value === null || value === undefined || value === '') return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

export class StateRevisionTracker {
  constructor(initialRevision = null) {
    this.revision = validRevision(initialRevision);
  }

  observe(response, payload) {
    const headerRevision = validRevision(response?.headers?.get?.('x-state-revision'));
    const payloadRevision = validRevision(payload?.data?.revision);
    const observed = [headerRevision, payloadRevision]
      .filter(value => value !== null)
      .reduce((maximum, value) => Math.max(maximum, value), -1);
    if (observed >= 0 && (this.revision === null || observed > this.revision)) {
      this.revision = observed;
    }
    return this.revision;
  }

  ifMatchHeader() {
    return this.revision === null ? null : `"${this.revision}"`;
  }
}

export function mutationNeedsStateRevision(path, method = 'GET') {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod)) return false;
  return !String(path || '').startsWith('/auth/');
}
