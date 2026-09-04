import { describe, expect, it } from 'vitest';
import { scoreLink, isSameSite, registrableHost } from '../src/core/steps/crawlCompany';
import { hiringSignalScore } from '../src/core/steps/findHiringProcess';
import { extractFromHtml, resolveLink } from '../src/core/net/extract';
import { parseRobots, isAllowedBy } from '../src/core/net/robots';

const seed = new URL('https://acme.example/');

describe('scoreLink', () => {
  it('ranks a hiring-process page above a generic about page', () => {
    const hiring = scoreLink('https://acme.example/handbook/how-we-hire', 'How we hire', seed, 1);
    const about = scoreLink('https://acme.example/about', 'About us', seed, 1);
    expect(hiring).toBeGreaterThan(about);
  });

  it('ranks an about page above a privacy policy', () => {
    expect(scoreLink('https://acme.example/about', 'About', seed, 1)).toBeGreaterThan(
      scoreLink('https://acme.example/privacy', 'Privacy', seed, 1),
    );
  });

  it('refuses to leave the site', () => {
    expect(scoreLink('https://unrelated.example/careers', 'Careers', seed, 1)).toBe(-Infinity);
  });

  it('follows the company onto its applicant tracking system', () => {
    expect(scoreLink('https://boards.greenhouse.io/acme', 'Open roles', seed, 1)).toBeGreaterThan(0);
  });

  it('accepts subdomains of the same registrable domain', () => {
    expect(isSameSite(new URL('https://careers.acme.example/'), seed)).toBe(true);
    expect(registrableHost('careers.acme.example')).toBe('acme.example');
  });

  it('treats a localhost origin as one site, so batch cases on a local host crawl', () => {
    const local = new URL('http://localhost:8099/acme/');
    expect(isSameSite(new URL('http://localhost:8099/acme/careers'), local)).toBe(true);
    expect(scoreLink('http://localhost:8099/acme/careers', 'Careers', local, 1)).toBeGreaterThan(0);
  });

  it('discards assets and login pages', () => {
    expect(scoreLink('https://acme.example/careers/brochure.pdf', 'Brochure', seed, 1)).toBeLessThan(0);
    expect(scoreLink('https://acme.example/login/', 'Sign in', seed, 1)).toBeLessThan(0);
  });

  it('prefers shallower links', () => {
    expect(scoreLink('https://acme.example/careers', 'Careers', seed, 1)).toBeGreaterThan(
      scoreLink('https://acme.example/a/b/c/careers', 'Careers', seed, 2),
    );
  });
});

describe('extractFromHtml', () => {
  const html = `<html><head><title>Acme</title></head><body>
    <nav><a href="/careers">Careers</a></nav>
    <main><h1>Acme</h1><p>We build robots.</p><script>alert(1)</script></main>
    <footer><a href="handbook/how-we-hire">How we hire</a></footer></body></html>`;

  it('keeps main text and drops scripts', () => {
    const page = extractFromHtml(html, 'https://acme.example/about');
    expect(page.text).toContain('We build robots.');
    expect(page.text).not.toContain('alert(1)');
  });

  it('keeps navigation and footer links, where careers pages usually hide', () => {
    const page = extractFromHtml(html, 'https://acme.example/about');
    const urls = page.links.map((l) => l.url);
    expect(urls).toContain('https://acme.example/careers');
    expect(urls).toContain('https://acme.example/handbook/how-we-hire');
  });

  it('resolves relative links against the page, including on a local host', () => {
    expect(resolveLink('handbook/how-we-hire', 'http://localhost:8099/acme/careers')).toBe(
      'http://localhost:8099/acme/handbook/how-we-hire',
    );
    expect(resolveLink('../about', 'http://localhost:8099/acme/handbook/')).toBe(
      'http://localhost:8099/acme/about',
    );
  });

  it('drops non-http schemes', () => {
    expect(resolveLink('mailto:a@b.c', 'https://acme.example/')).toBeNull();
    expect(resolveLink('javascript:alert(1)', 'https://acme.example/')).toBeNull();
  });
});

describe('hiringSignalScore', () => {
  it('scores a described process above a list of vacancies', () => {
    const process = hiringSignalScore({
      url: 'https://acme.example/handbook/how-we-hire',
      title: 'How we hire',
      text: 'Our interview process has four stages: an intro call, a take-home exercise, a technical deep dive and a values interview. What to expect at each stage.',
    });
    const listing = hiringSignalScore({
      url: 'https://acme.example/careers',
      title: 'Careers',
      text: 'Open roles. Senior Backend Engineer. Apply now. View all open positions.',
    });
    expect(process).toBeGreaterThan(listing);
    expect(process).toBeGreaterThanOrEqual(12);
  });
});

describe('robots.txt', () => {
  it('honours a disallow for all agents', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /private\n');
    expect(isAllowedBy(robots, '/private/page')).toBe(false);
    expect(isAllowedBy(robots, '/careers')).toBe(true);
  });

  it('lets a longer allow override a broad disallow', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /\nAllow: /careers\n');
    expect(isAllowedBy(robots, '/careers/engineer')).toBe(true);
    expect(isAllowedBy(robots, '/anything-else')).toBe(false);
  });

  it('prefers a group naming our agent over the wildcard group', () => {
    const robots = parseRobots(
      'User-agent: *\nDisallow: /\n\nUser-agent: interviewprepkit\nDisallow: /secret\n',
    );
    expect(isAllowedBy(robots, '/careers')).toBe(true);
    expect(isAllowedBy(robots, '/secret/x')).toBe(false);
  });

  it('supports wildcards and end anchors', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /*.pdf$\n');
    expect(isAllowedBy(robots, '/files/report.pdf')).toBe(false);
    expect(isAllowedBy(robots, '/files/report.html')).toBe(true);
  });
});

describe('a local host serving several companies', () => {
  // Batch fixtures often live at localhost:8099/acme/ and localhost:8099/quietco/.
  const acme = new URL('http://localhost:8099/acme/');

  it('stays inside the company it was pointed at', () => {
    expect(isSameSite(new URL('http://localhost:8099/acme/careers'), acme)).toBe(true);
    expect(isSameSite(new URL('http://localhost:8099/acme/handbook/how-we-hire'), acme)).toBe(true);
    expect(isSameSite(new URL('http://localhost:8099/quietco/'), acme)).toBe(false);
    expect(scoreLink('http://localhost:8099/quietco/careers', 'Careers', acme, 1)).toBe(-Infinity);
  });

  it('does not restrict a crawl seeded at a local root', () => {
    const root = new URL('http://localhost:8099/');
    expect(isSameSite(new URL('http://localhost:8099/acme/careers'), root)).toBe(true);
  });

  it('still treats a real site by its registrable domain', () => {
    const site = new URL('https://acme.example/careers');
    expect(isSameSite(new URL('https://careers.acme.example/engineer'), site)).toBe(true);
    expect(isSameSite(new URL('https://acme.example/about'), site)).toBe(true);
  });
});
