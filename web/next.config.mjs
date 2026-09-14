/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    // The indexer API. Falls back to the local one so `npm run dev` works with no setup.
    NEXT_PUBLIC_INDEXER_URL: process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://127.0.0.1:4000",
  },
};

export default nextConfig;
