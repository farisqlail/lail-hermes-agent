/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  outputFileTracing: false,
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  reactStrictMode: false,
};

export default nextConfig;
