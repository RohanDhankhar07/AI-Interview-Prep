export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      {children}
    </main>
  );
}
