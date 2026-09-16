/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The registry is the only writer (docs/01 §1.2), so nothing here is static.
  experimental: {
    typedRoutes: true,
    // Keep Prisma out of the server bundle. The query engine is a native
    // binary, and bundling the client is how it goes missing from a serverless
    // function — the symptom is a runtime "engine not found", never a build
    // failure.
    serverComponentsExternalPackages: ['@prisma/client'],
  },
};

export default nextConfig;
