/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The registry is the only writer (docs/01 §1.2), so nothing here is static.
  experimental: { typedRoutes: true },
};

export default nextConfig;
