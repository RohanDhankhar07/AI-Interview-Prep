import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth';

export default async function LandingPage() {
  if (await getCurrentUser()) redirect('/kits');

  const steps = [
    ['Paste the posting', 'Requirements are pulled out and marked must-have or nice-to-have, exactly as the posting words them.'],
    ['We research the company', 'The site is crawled for what they do and how they hire, and public discussion of their process is searched.'],
    ['A kit you can reshape', 'A brief, a question bank, flashcards and a day-by-day plan — all editable, and practisable in the app.'],
  ];

  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-20">
      <p className="text-sm font-medium text-brand">Interview Prep Kit</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance">
        A prep kit built from the posting in front of you, not a generic question list.
      </h1>
      <p className="mt-4 max-w-2xl text-muted">
        Paste a job description, give us the company&rsquo;s website and say how many days you have.
        You get a company brief, a question bank tied to the actual requirements, flashcards and a
        schedule that fits the time you have left.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/register"
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white dark:text-slate-900"
        >
          Create an account
        </Link>
        <Link href="/login" className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium">
          Sign in
        </Link>
      </div>

      <ol className="mt-14 grid gap-4 sm:grid-cols-3">
        {steps.map(([title, body], index) => (
          <li key={title} className="rounded-xl border border-line bg-surface p-4">
            <span className="text-xs font-semibold text-brand">Step {index + 1}</span>
            <h2 className="mt-1 font-medium">{title}</h2>
            <p className="mt-1 text-sm text-muted">{body}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
