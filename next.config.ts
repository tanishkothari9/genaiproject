import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // unpdf ships an ESM build of pdf.js; mark it external so Next bundles it cleanly
  // for the Node server runtime used by our API route handlers.
  serverExternalPackages: ["unpdf"],
};

export default nextConfig;
