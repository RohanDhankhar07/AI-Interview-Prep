/**
 * A local stand-in for company websites, used by the tests and by
 * `npm run mocksite` to exercise the crawler without hitting the open internet.
 *
 *  /acme   — buries its hiring process at /acme/handbook/how-we-hire, reachable
 *            only through a relative footer link, so a hard-coded path list misses it.
 *  /quietco — a real company site with no hiring page anywhere on it.
 */
import { createServer, type Server } from 'node:http';



const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body>${body}</body></html>`;

const ACME_FOOTER = `<footer>
  <a href="../about">About</a>
  <a href="handbook/">Team handbook</a>
  <a href="/acme/privacy">Privacy</a>
</footer>`;

const routes: Record<string, string> = {
  '/acme/': page(
    'Acme Robotics',
    `<main><h1>Acme Robotics</h1>
     <p>Acme Robotics builds warehouse automation: autonomous mobile robots and the fleet
     orchestration software that routes them. Our customers are third-party logistics providers
     in Europe and North America.</p>
     <p>We sell a subscription platform priced per robot per month.</p>
     <a href="products">Products</a> <a href="careers">Open roles</a></main>
     <footer><a href="handbook/">Team handbook</a><a href="about">About us</a></footer>`,
  ),
  '/acme/about': page(
    'About — Acme Robotics',
    `<main><h1>About Acme</h1><p>Founded in 2018 in Rotterdam, Acme Robotics has 140 employees
     across engineering, operations and field support. We are backed by Series B funding and
     operate in eleven distribution centres.</p></main>${ACME_FOOTER}`,
  ),
  '/acme/products': page(
    'Products — Acme Robotics',
    `<main><h1>Products</h1><p>Fleet OS is our orchestration platform. Pathfinder is our
     on-robot navigation stack. Both integrate with common warehouse management systems.</p></main>${ACME_FOOTER}`,
  ),
  '/acme/careers': page(
    'Careers — Acme Robotics',
    `<main><h1>Open roles</h1><ul><li>Senior Backend Engineer</li><li>Field Operations Lead</li></ul>
     <p>Curious how we hire? It is written up in our <a href="handbook/how-we-hire">team handbook</a>.</p>
     </main>${ACME_FOOTER}`,
  ),
  '/acme/handbook/': page(
    'Handbook — Acme Robotics',
    `<main><h1>Team handbook</h1><ul>
      <li><a href="how-we-hire">How we hire</a></li>
      <li><a href="engineering-values">Engineering values</a></li></ul></main>`,
  ),
  '/acme/handbook/how-we-hire': page(
    'How we hire — Acme Robotics',
    `<main><h1>How we hire</h1>
     <p>Our interview process has four stages and takes about two weeks.</p>
     <ol>
       <li><strong>Intro call (30 minutes)</strong> with a recruiter covering your background and logistics.</li>
       <li><strong>Take-home exercise (3 hours, paid)</strong>: a small service that ingests robot telemetry.
           We ask for tests and a short README explaining trade-offs.</li>
       <li><strong>Technical deep dive (75 minutes)</strong>: we walk through your take-home, then a
           system design discussion about scaling fleet orchestration.</li>
       <li><strong>Values interview (45 minutes)</strong> with two engineers, focused on collaboration,
           incident ownership and mentoring.</li>
     </ol>
     <p>We do not ask algorithm puzzles. We give a decision within three working days.</p></main>`,
  ),
  '/acme/handbook/engineering-values': page(
    'Engineering values — Acme Robotics',
    `<main><h1>Engineering values</h1><p>We favour boring technology, small pull requests and
     blameless incident reviews.</p></main>`,
  ),
  '/acme/privacy': page('Privacy', '<main><h1>Privacy policy</h1><p>Boilerplate.</p></main>'),

  '/quietco/': page(
    'QuietCo',
    `<main><h1>QuietCo</h1><p>QuietCo makes accounting software for independent pharmacies in the UK.</p>
     <a href="product">Product</a> <a href="contact">Contact</a></main>`,
  ),
  '/quietco/product': page(
    'Product — QuietCo',
    `<main><h1>Product</h1><p>Stock control, dispensing reconciliation and NHS claim submission.</p></main>`,
  ),
  '/quietco/contact': page('Contact — QuietCo', '<main><h1>Contact</h1><p>hello@quietco.example</p></main>'),
};

/** The site as a server, so tests can bind it to an ephemeral port. */
export function createSiteServer(): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let path = url.pathname;

    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nDisallow: /acme/privacy\n');
      return;
    }
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page('Mock sites', '<ul><li><a href="/acme/">Acme</a></li><li><a href="/quietco/">QuietCo</a></li></ul>'));
      return;
    }
    // Directory-style URLs redirect to their trailing-slash form, exercising redirect handling.
    if (routes[`${path}/`] && !path.endsWith('/')) {
      res.writeHead(301, { location: `${path}/` });
      res.end();
      return;
    }

    const body = routes[path];
    if (!body) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page('Not found', '<h1>404</h1>'));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
});
}

export default createSiteServer;
