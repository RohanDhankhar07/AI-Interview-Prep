'use client';

import type { Kit } from '@/core/types';
import { Badge, Card } from '@/components/ui/primitives';

/**
 * What the research actually found, including what it did not. A kit that is
 * quietly thin is worse than one that says where it is thin.
 */
export function ResearchSection({ kit }: { kit: Kit }) {
  const research = kit.research;
  if (!research) return null;

  return (
    <section id="research" aria-labelledby="research-heading" className="scroll-mt-20 space-y-3">
      <h2 id="research-heading" className="text-lg font-semibold tracking-tight">
        What the research found
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium">Their hiring process</h3>
            <Badge tone={research.hiring_process_found ? 'good' : 'warn'}>
              {research.hiring_process_found ? 'Found' : 'Not published'}
            </Badge>
          </div>
          {research.hiring_process_found ? (
            <>
              <p className="text-sm">{research.hiring_process_summary}</p>
              <ul className="space-y-1 text-xs">
                {research.hiring_process_urls.map((url) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand underline">
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted">
              Nothing on this company&rsquo;s site describes their interview process, so no format has
              been assumed. The questions are shaped by the posting alone.
            </p>
          )}
        </Card>

        <Card className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium">Public discussion</h3>
            <Badge tone={research.public_discussion_found ? 'good' : 'warn'}>
              {research.public_discussion_found ? 'Found' : 'None found'}
            </Badge>
          </div>
          {research.public_discussion_found ? (
            <>
              <p className="text-sm">{research.public_discussion_summary}</p>
              <ul className="space-y-1 text-xs">
                {research.public_discussion_urls.map((url) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand underline">
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted">
              No candidate-reported detail about interviewing here turned up. Nothing was inferred to
              fill the gap.
            </p>
          )}
        </Card>
      </div>

      {research.notes.length > 0 ? (
        <Card className="p-4">
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Notes</h3>
          <ul className="list-inside list-disc space-y-1 text-sm">
            {research.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {research.skipped_sources.length > 0 ? (
        <Card className="p-4">
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
            Sources we could not read ({research.skipped_sources.length})
          </h3>
          <ul className="space-y-1 text-xs text-muted">
            {research.skipped_sources.map((source, index) => (
              <li key={`${source.url}-${index}`} className="break-all">
                <span className="text-ink">{source.url}</span> — {source.reason}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="p-4">
        <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Pages used</h3>
        <p className="text-xs text-muted">
          {kit.source.pages_used.length} page{kit.source.pages_used.length === 1 ? '' : 's'} retrieved ·
          job description {kit.source.jd_chars} characters · researched{' '}
          {new Date(kit.source.researched_at).toLocaleString()}
        </p>
        <ul className="mt-2 space-y-1 text-xs">
          {kit.source.pages_used.map((url) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand underline">
                {url}
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
