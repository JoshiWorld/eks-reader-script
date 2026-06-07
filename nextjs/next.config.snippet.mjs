/** @type {import('next').NextConfig} */
const nextConfig = {
  // serialport darf nicht ins Browser-Bundle – nur Server Actions / API Routes
  serverExternalPackages: ["serialport", "@serialport/bindings-cpp"],
};

export default nextConfig;
