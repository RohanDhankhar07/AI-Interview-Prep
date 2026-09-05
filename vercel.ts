import { type VercelConfig } from '@vercel/config/v1';

/**
 * Vercel project configuration.
 *
 * Function durations are not set here: the App Router's own `maxDuration` route
 * segment export is the framework-native way to do it, and duplicating the value
 * in two places is how they drift apart. See src/app/api/kits/[id]/advance.
 */
export const config: VercelConfig = {
  framework: 'nextjs',

  /**
   * Mumbai, to sit next to the database.
   *
   * The MongoDB Atlas cluster this project uses is in ap-south-1, and a request
   * here makes several round trips to it — read the kit, take the generation
   * lease, write the result. Running functions in the default us-east-1 would
   * put the Atlantic between every one of those. Change this if you move the
   * cluster: the rule is that functions belong beside the database, not beside
   * the user, because the database round trips outnumber everything else.
   */
  regions: ['bom1'],

  headers: [
    {
      // Applied to everything, including the pages.
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
        },
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ],
    },
    {
      /**
       * Every API response is specific to one signed-in user, so nothing on this
       * path may be stored by a CDN, a proxy, or the browser's back/forward cache.
       */
      source: '/api/(.*)',
      headers: [
        { key: 'Cache-Control', value: 'no-store, max-age=0' },
        { key: 'X-Robots-Tag', value: 'noindex' },
      ],
    },
  ],
};

export default config;
