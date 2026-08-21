"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const INITIAL: LoginState = { error: null };

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="text-sm font-medium text-text">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          aria-describedby={state.error ? "login-error" : undefined}
          className="h-10 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm text-text placeholder:text-text-muted"
          placeholder="Enter password"
        />
      </div>

      {state.error && (
        <p id="login-error" role="alert" className="text-sm text-heat-red">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-[var(--radius-control)] bg-accent px-4 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
