import type { NextConfig } from "next";

type RemotePattern = NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]>[number];

/**
 * RetailERP image hosts — keep in sync with isAllowedImageUrl() in src/lib/erp-images.ts:
 *  - ERP_IMAGE_SPACES_HOSTS: the DigitalOcean Spaces bucket(s) the ERP uploads product photos to
 *    (exact hosts, never a wildcard: /_next/image is public and would proxy any bucket)
 *  - ERP_IMAGE_BASE: the deployed RetailERP web app that serves relative paths like /august_8A_images/…
 */
function erpImagePatterns(): RemotePattern[] {
  const spacesHosts = (process.env.ERP_IMAGE_SPACES_HOSTS ?? "templeimg.blr1.digitaloceanspaces.com")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const patterns: RemotePattern[] = spacesHosts.map((hostname) => ({ protocol: "https", hostname, pathname: "/**" }));
  const base = process.env.ERP_IMAGE_BASE?.trim();
  if (base) {
    try {
      const u = new URL(base);
      patterns.push({ protocol: u.protocol.replace(":", "") as "http" | "https", hostname: u.hostname, ...(u.port ? { port: u.port } : {}), pathname: "/**" });
    } catch {
      console.warn("[next.config] ERP_IMAGE_BASE is not a valid URL; relative ERP images will not load");
    }
  }
  return patterns;
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["mongoose"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "picsum.photos" }, ...erpImagePatterns()],
  },
};

export default nextConfig;
