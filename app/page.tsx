import { SessionProvider } from "@/components/SessionProvider";
import { AppRoot } from "@/components/AppRoot";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-1 flex-col bg-amber-50 dark:bg-neutral-950">
      <SessionProvider>
        <AppRoot />
      </SessionProvider>
    </main>
  );
}
