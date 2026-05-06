/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Block crawlers/AI scrapers on every host EXCEPT the public
        // MerVare landing pages (mervare.app and mervare.io). Per-marina
        // subdomains (e.g. hara.mervare.app) and legacy hosts stay
        // noindex by default.
        source: "/:path*",
        missing: [
          { type: "host", value: "mervare\\.app" },
          { type: "host", value: "mervare\\.io" },
        ],
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
        ],
      },
    ];
  },
};

export default nextConfig;
