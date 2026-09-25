/**
 * The rewrite below is the important part of this file.
 *
 * The API sets its access and refresh tokens as httpOnly cookies. On Railway the
 * web and api services have different hostnames, which makes every browser call
 * cross-site - and a SameSite=Lax cookie is not sent cross-site. The usual
 * workarounds are both worse: SameSite=None widens CSRF exposure, and moving
 * tokens into localStorage puts them where injected script can read them.
 *
 * Proxying instead keeps the browser on one origin. It calls /api/v1/... on the
 * web host, Next forwards it to the API, and Set-Cookie comes back scoped to the
 * web origin, so httpOnly + SameSite=Lax keeps working unchanged.
 */
const API_URL = process.env.API_URL ?? 'http://localhost:3001';

/**
 * Security headers.
 *
 * The API sends its own through helmet; nothing was sending any for the pages
 * themselves, which is OWASP A02:2025 (Security Misconfiguration) - the
 * category that moved up to second in the 2025 list.
 *
 * The CSP is the one that does real work here. This app holds an authenticated
 * session in an httpOnly cookie, so the damage an injected script could do is
 * bounded by where it is allowed to send what it reads.
 */
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // 'unsafe-inline' is required by Next's own inline bootstrap script.
      // Removing it needs a nonce through the whole render path, which is a
      // change worth making but not one to slip into a security pass.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      // Same-origin only: the browser never calls the API directly, it calls
      // this app and Next proxies it. An injected script therefore has nowhere
      // to send what it steals.
      "connect-src 'self'",
      "font-src 'self'",
      // No frames in, no frames out, and no plugins.
      "frame-ancestors 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      // A form cannot be pointed at another origin.
      "form-action 'self'",
      "base-uri 'self'",
      'upgrade-insecure-requests',
    ].join('; '),
  },
  // Belt and braces with frame-ancestors, for anything that predates CSP.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Referrers leak paths. A register URL should not travel to another site.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // None of these are used, and saying so stops a future dependency using them.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  // Two years, subdomains included. Railway serves HTTPS only.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The version is a fingerprint an attacker can match against advisories.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_URL}/api/v1/:path*` }];
  },
};

export default nextConfig;
