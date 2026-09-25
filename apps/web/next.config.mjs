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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_URL}/api/v1/:path*` }];
  },
};

export default nextConfig;
