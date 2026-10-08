"use client";
/**
 * The link back in from the mail (AND-236): uses the link once, on
 * opening, and shows the new password like after "Register". It is the
 * account's only password from then on (AND-241). A link that is unknown,
 * used or older than 30 minutes says so and offers a new one. When the
 * server could not be reached, or asked to wait, the link still works:
 * the page says so and tries again.
 *
 * The link is used by the page's script, not by opening the address, so a
 * mail program that looks at links in advance does not use it up.
 */
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../../../../src/ui/app-state.tsx";
import { api, ApiError, type Account, type FreshPasswordInfo } from "../../../../src/ui/api.ts";
import { Button, ButtonLink } from "../../../../src/ui/components/Button.tsx";
import { Callout } from "../../../../src/ui/components/Feedback.tsx";
import { FreshPassword } from "../../../../src/ui/components/FreshPassword.tsx";
import { GuestShell } from "../../../../src/ui/components/Shell.tsx";
import { usePageTitle } from "../../../../src/ui/flow/frame.tsx";

type State =
  | { kind: "checking" }
  | { kind: "fresh"; account: Account; secret: string }
  | { kind: "invalid" }
  | { kind: "failed"; message: string };

export default function ResetLinkPage() {
  const app = useApp();
  const { t } = app;
  const router = useRouter();
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ kind: "checking" });
  // Once per attempt: a second call (React's double run while developing) would find the link used.
  const [attempt, setAttempt] = useState(0);
  const used = useRef(-1);
  const headingRef = useRef<HTMLHeadingElement>(null);

  usePageTitle([
    state.kind === "fresh"
      ? t("password.title")
      : state.kind === "checking"
        ? t("reset.checking")
        : state.kind === "failed"
          ? t("reset.failedTitle")
          : t("reset.invalidTitle"),
  ]);

  useEffect(() => {
    if (used.current === attempt) return;
    used.current = attempt;
    api<{ account: Account; password: FreshPasswordInfo }>("POST", "/api/auth/reset/use", { token })
      .then((r) => setState({ kind: "fresh", account: r.account, secret: r.password.secret }))
      .catch((error: unknown) => {
        const e = error instanceof ApiError ? error : new ApiError(0, "network");
        if (e.status === 404 || e.status === 400) setState({ kind: "invalid" });
        else if (e.status === 429)
          setState({
            kind: "failed",
            message: app.tc("login.tooMany", Math.max(1, Math.ceil((e.retryAfter ?? 300) / 60))),
          });
        else setState({ kind: "failed", message: e.isNetwork ? t("common.offline") : t("common.loadError") });
      })
      .finally(() => requestAnimationFrame(() => headingRef.current?.focus()));
  }, [token, app, t, attempt]);

  return (
    <GuestShell>
      <div className="auth">
        <section className="auth__card" aria-labelledby="reset-title" aria-busy={state.kind === "checking"}>
          {state.kind === "checking" ? (
            <h1 className="auth__title" id="reset-title" tabIndex={-1} ref={headingRef}>
              {t("reset.checking")}
            </h1>
          ) : state.kind === "fresh" ? (
            <>
              <h1 className="auth__title" id="reset-title" tabIndex={-1} ref={headingRef}>
                {t("password.welcomeBack", { name: state.account.name })}
              </h1>
              <p className="auth__intro">{t("reset.oldGone")}</p>
              <FreshPassword
                secret={state.secret}
                username={state.account.name}
                onDone={() => {
                  app.setAccount(state.account);
                  router.replace("/characters");
                }}
              />
            </>
          ) : state.kind === "failed" ? (
            <>
              <h1 className="auth__title" id="reset-title" tabIndex={-1} ref={headingRef}>
                {t("reset.failedTitle")}
              </h1>
              <Callout tone="danger" role="alert">
                {state.message}
              </Callout>
              <Button
                block
                onClick={() => {
                  setState({ kind: "checking" });
                  setAttempt((n) => n + 1);
                }}
              >
                {t("common.retry")}
              </Button>
            </>
          ) : (
            <>
              <h1 className="auth__title" id="reset-title" tabIndex={-1} ref={headingRef}>
                {t("reset.invalidTitle")}
              </h1>
              <p className="auth__intro">{t("reset.invalid")}</p>
              <ButtonLink href="/login?lost" block>
                {t("reset.again")}
              </ButtonLink>
            </>
          )}
        </section>
      </div>
    </GuestShell>
  );
}
