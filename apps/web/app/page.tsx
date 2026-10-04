"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "../src/ui/app-state.tsx";
import { ErrorState, Loading } from "../src/ui/components/Feedback.tsx";

/** The start address: to the characters when logged in, else to the login screen. */
export default function StartPage() {
  const { account, accountError, reloadAccount } = useApp();
  const router = useRouter();
  useEffect(() => {
    if (account) router.replace("/characters");
    else if (account === null) router.replace("/login");
  }, [account, router]);
  if (accountError) return <ErrorState onRetry={() => void reloadAccount().catch(() => {})} />;
  return (
    <div className="page-loading">
      <Loading shape="page" count={1} />
    </div>
  );
}
