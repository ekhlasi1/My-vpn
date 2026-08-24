/**
 * Environment configuration for the DoT server. Everything is read from
 * process.env (or a .env file loaded by whatever process manager you use —
 * this file intentionally does not depend on the `dotenv` package so it has
 * zero runtime deps beyond `dns-packet`).
 */

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

export const config = {
  /** Public hostname this DoT server answers as (must match your TLS cert's CN/SAN). */
  hostname: process.env.DOT_HOSTNAME || 'dns.example.com',

  /** TCP port to listen on. Android's Private DNS field always dials 853 — don't change unless you know the client supports a custom port. */
  port: Number(process.env.DOT_PORT || 853),

  /** Path to the TLS certificate + private key (e.g. from certbot / Let's Encrypt). */
  tlsCertPath: process.env.TLS_CERT_PATH || '/etc/letsencrypt/live/dns.example.com/fullchain.pem',
  tlsKeyPath: process.env.TLS_KEY_PATH || '/etc/letsencrypt/live/dns.example.com/privkey.pem',

  /**
   * The BNDMAX VPN worker's own base URL. The server polls
   * `${workerBaseUrl}/api/dns-rules` (public, no auth) for the domain/ip/cidr
   * list and the currently-best Cloudflare "clean" IP.
   */
  workerBaseUrl: process.env.WORKER_BASE_URL || required('WORKER_BASE_URL'),

  /** How often to re-fetch the rules list, in seconds. */
  rulesRefreshSeconds: Number(process.env.RULES_REFRESH_SECONDS || 60),

  /**
   * Fallback "clean" IP to use if the worker hasn't discovered a healthy one
   * yet (its clean_ips table starts empty on a fresh deploy). Leave unset to
   * fall back to answering matched domains with the upstream resolver's
   * normal (unmodified) answer instead of failing the query outright.
   */
  fallbackCleanIp: process.env.FALLBACK_CLEAN_IP || null,

  /** Upstream DoH resolver used for every query that isn't answered locally. */
  upstreamDohUrl: process.env.UPSTREAM_DOH_URL || 'https://1.1.1.1/dns-query',

  /** Answer TTL (seconds) used on synthetic/overridden A records. Keep short so rule-list changes propagate quickly. */
  overrideTtl: Number(process.env.OVERRIDE_TTL || 60),
}
