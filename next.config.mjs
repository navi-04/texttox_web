/** @type {import('next').NextConfig} */
const nextConfig = {
  // The native sqlite build is only loaded for local `file:` databases; keep it out of the bundle.
  serverExternalPackages: ["@libsql/client", "libsql"],
  poweredByHeader: false,
  // The privacy policy lives at /privacy-policy; the shorter or misspelled addresses lead there too.
  async redirects() {
    return [
      { source: "/privacy", destination: "/privacy-policy", permanent: true },
      { source: "/privcy-policy", destination: "/privacy-policy", permanent: true },
      { source: "/privcy%20policy", destination: "/privacy-policy", permanent: true },
      { source: "/privacy%20policy", destination: "/privacy-policy", permanent: true },
    ];
  },
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
