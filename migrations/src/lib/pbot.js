// PBot GraphQL access, shared by the pbot-* steps and the runner so they agree on
// one rule. pbot-refs and pbot-schemas read anonymously (public records only)
// unless --pbot-include-private is given, when they send PBOT_TOKEN and also see
// the private records it can. pbot-persons always sends the token: PBot hides
// person emails from anonymous requests. Steps that disagreed on which records
// exist failed on 2026-11-10. process.env is read at call time, after .env loads.

export const PBOT_GRAPHQL_URL = 'https://pbot.paleobiodb.org/graphql';

export const PBOT_INCLUDE_PRIVATE_FLAG = '--pbot-include-private';

export function includePrivateRequested(argv = process.argv.slice(2)) {
  return argv.includes(PBOT_INCLUDE_PRIVATE_FLAG);
}

export function pbotToken() {
  const token = process.env.PBOT_TOKEN?.trim();
  return token ? token : null;
}

export function pbotHeaders(useToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (!useToken) return headers;
  const token = pbotToken();
  if (!token) throw new Error('Missing required .env variable: PBOT_TOKEN');
  headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function pbotAccessLabel(includePrivate) {
  return includePrivate ? 'token, including private records' : 'anonymous, public records only';
}
