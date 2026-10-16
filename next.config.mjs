/** @type {import('next').NextConfig} */
const nextConfig = {
  // The punch engine and device puller are CommonJS and use Node-only modules
  // (raw TCP sockets, bcrypt). Keep them out of the bundler.
  experimental: {
    serverComponentsExternalPackages: ['node-zklib', 'bcryptjs'],
    optimizePackageImports: ['lucide-react'],
    // Attendance data changes every few minutes; never serve a stale client cache.
    staleTimes: { dynamic: 0 },
    // Excel files are uploaded to the import page through a server action (4 MB is enforced in lib/import.js).
    serverActions: { bodySizeLimit: '5mb' },
  },
  compress: true,
  poweredByHeader: false,
}

export default nextConfig
