/** @type {import('next').NextConfig} */
const nextConfig = {
  // The native sqlite build is only loaded for local `file:` databases; keep it out of the bundle.
  serverExternalPackages: ["@libsql/client", "libsql"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  agentRules: false, // stop `next dev` from writing AGENTS.md / CLAUDE.md into the repo
};

export default nextConfig;
