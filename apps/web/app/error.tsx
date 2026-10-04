"use client";
import { useApp } from "../src/ui/app-state.tsx";
import { PageError, useReloadOnChunkError } from "../src/ui/components/PageError.tsx";
import { GuestShell } from "../src/ui/components/Shell.tsx";

/** Last resort for an unexpected error on a screen. Drafts are on the server, so nothing is lost. */
export default function ErrorPage({ error }: { error: Error & { digest?: string } }) {
  const { t } = useApp();
  useReloadOnChunkError(error);
  return (
    <GuestShell>
      <div className="auth">
        <PageError t={t} />
      </div>
    </GuestShell>
  );
}
