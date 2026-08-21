"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/session";

export type LoginState = { error: string | null };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  if (!verifyPassword(password)) {
    return { error: "Incorrect password." };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions());

  // Only allow same-origin relative paths, so `?next=` can't be used as an
  // open redirect.
  const destination = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  redirect(destination); // throws — must stay outside any try/catch
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
