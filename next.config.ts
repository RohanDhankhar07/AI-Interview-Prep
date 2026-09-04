import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next generates AGENTS.md/CLAUDE.md on dev by default; this repo does not want them.
  agentRules: false,
  // The pipeline runs on the Node runtime: it uses dns, crypto and streaming fetch.
  serverExternalPackages: ['mongodb', 'cheerio', 'bcryptjs'],
};

export default nextConfig;
