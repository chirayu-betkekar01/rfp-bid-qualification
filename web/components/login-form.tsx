"use client";

import { useActionState, useRef } from "react";

import { signIn, type SignInState } from "@/app/actions";
import { Avatar } from "@/components/assign-dialog";
import { inputClass } from "@/components/row-form";
import type { DemoAccount } from "@/lib/reviewer";

/** The sign-in form, with the fictional team's accounts beside it so the demo needs no notes. */
export function LoginForm({ accounts, password, next, managerRole }: {
  accounts: DemoAccount[]; password: string; next: string | null; managerRole: string;
}) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, { error: null, email: "" });
  const form = useRef<HTMLFormElement>(null);

  function use(account: DemoAccount, submit = false) {
    const f = form.current;
    if (!f) return;
    (f.elements.namedItem("email") as HTMLInputElement).value = account.email;
    (f.elements.namedItem("password") as HTMLInputElement).value = password;
    if (submit) f.requestSubmit();
  }

  return (
    <div className="grid w-full max-w-5xl grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-zinc-500">Tallyhouse RFP Review: route RFP line items to experts and decide whether to bid.</p>
        <form ref={form} action={action} className="mt-5 space-y-3">
          {next && <input type="hidden" name="next" value={next} />}
          <label className="block text-sm">
            <span className="font-medium">Email</span>
            <input name="email" type="email" required autoComplete="username" defaultValue={state.email}
                   placeholder="name@tallyhouse.demo" className={`${inputClass} mt-1 w-full`} />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Password</span>
            <input name="password" type="password" required autoComplete="current-password" className={`${inputClass} mt-1 w-full`} />
          </label>
          {state.error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{state.error}</p>}
          <button disabled={pending}
                  className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>

      <aside className="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-5 dark:border-amber-800 dark:bg-amber-950/20">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Demo accounts</h2>
          <p className="text-sm">
            Password for everyone: <code className="rounded bg-white px-1.5 py-0.5 font-mono text-sm font-semibold dark:bg-zinc-900">{password}</code>
          </p>
        </div>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          A fictional team, for the demo only. The proposal manager sees every RFP; everyone else lands on the line items
          waiting for them. Click a row to fill in the form, or Sign in to go straight in.
        </p>
        <ul className="mt-3 divide-y divide-amber-200/70 rounded-lg border border-amber-200/70 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2">
              <button type="button" onClick={() => use(a)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <Avatar name={a.name} size="md" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {a.name}
                    {a.role === managerRole && (
                      <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-normal text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200">
                        Start here
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-zinc-500">{a.role} · <span className="font-mono">{a.email}</span></span>
                </span>
              </button>
              <button type="button" disabled={pending} onClick={() => use(a, true)}
                      className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:border-indigo-400 disabled:opacity-50 dark:border-zinc-700">
                Sign in
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
