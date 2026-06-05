import { SessionProvider } from "@/components/SessionProvider";
import { AppRoot } from "@/components/AppRoot";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-1 flex-col bg-surface-sunken">
      <SessionProvider>
        <AppRoot />
      </SessionProvider>
    </main>
  );
}
