"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";
import { CONTROL_BASE, PRESS } from "@/components/ui";

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
          className={`${CONTROL_BASE} h-10 border-border-strong px-3 focus:border-accent/60 focus:shadow-raised`}
          placeholder="Enter password"
        />
      </div>

      {state.error && (
        <p id="login-error" role="alert" className="fade-in text-sm text-heat-red">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className={`h-10 rounded-[var(--radius-control)] bg-accent px-4 text-sm font-medium text-on-accent shadow-card hover:bg-accent-hover hover:shadow-raised disabled:opacity-60 ${PRESS}`}
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
