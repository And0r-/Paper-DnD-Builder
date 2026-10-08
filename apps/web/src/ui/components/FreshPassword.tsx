"use client";
/**
 * A password just made, shown this once: after "Register", after the
 * login of an account from before, after a link back in, and after "New
 * password" in the settings. The server keeps only a check value, so it
 * cannot show it again. Nothing forces copying and nothing runs out; the
 * button is the player's own "I have it".
 *
 * The button sends a form the player does not see: the account's name as
 * the user name and the password as a new one (AND-241). Browsers and
 * phones take a sent form with a new password as the moment to offer
 * saving it. Firefox only does so when the form is really sent, not when a
 * script stops it, so the form goes to /form-sent: an empty answer that
 * leaves the page as it is. The fields have no `name`, so nothing of them
 * travels; the screen closes a moment later, once the form is on its way.
 *
 * Firefox also wants the player to have typed into the very form it sends.
 * "Register" therefore shows the password inside its own form, where the
 * name was typed (GetStarted), with `FreshPasswordContent` and
 * `PasswordToSave`; `FreshPassword` is the form of its own for the rest.
 *
 * `noMail`: the account has no mail address, so this password is the only
 * way back in; the screen says so plainly, before it is too late.
 */
import { useApp } from "../app-state.tsx";
import { Button } from "./Button.tsx";
import { CopyText } from "./CopyText.tsx";
import { Callout } from "./Feedback.tsx";

/** Where the forms with a password to save are sent, and what to do once they are. */
export const SAVE_FORM = { method: "get", action: "/form-sent" } as const;

/** Close the screen once the form is on its way: removing it before would cancel the sending. */
export const afterSending = (onDone: () => void) => setTimeout(onDone, 0);

/**
 * The fields the browser offers to save. Without `name`, so the request
 * carries none of them. `username: undefined` leaves the name to a field
 * of the form the player typed into.
 */
export function PasswordToSave({ username, secret }: { username?: string | undefined; secret: string }) {
  return (
    // Not read-only: a field nobody may edit is nothing to remember. Nobody reaches them anyway.
    <div className="visually-hidden" aria-hidden="true">
      {username !== undefined && (
        <input type="text" autoComplete="username" value={username} onChange={() => {}} tabIndex={-1} />
      )}
      <input type="password" autoComplete="new-password" value={secret} onChange={() => {}} tabIndex={-1} />
    </div>
  );
}

export function FreshPasswordContent({ secret, noMail }: { secret: string; noMail?: boolean | undefined }) {
  const { t } = useApp();
  return (
    <>
      <CopyText label={t("password.label")} value={secret} large />
      <p>{t("password.text")}</p>
      <p>{t("password.keep")}</p>
      {noMail && <Callout tone="warning">{t("password.noMail")}</Callout>}
      <Button type="submit" block icon="check">
        {t("password.done")}
      </Button>
    </>
  );
}

export function FreshPassword({
  secret,
  username,
  noMail,
  onDone,
}: {
  secret: string;
  /** What the account logs in with besides the password: its name. */
  username: string;
  noMail?: boolean;
  onDone: () => void;
}) {
  return (
    <form className="fresh-password" {...SAVE_FORM} onSubmit={() => afterSending(onDone)}>
      <PasswordToSave username={username} secret={secret} />
      <FreshPasswordContent secret={secret} noMail={noMail} />
    </form>
  );
}
