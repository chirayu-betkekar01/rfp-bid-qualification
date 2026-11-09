import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LoginForm } from "@/components/login-form";
import { pool } from "@/lib/db";
import { MANAGER_ROLE } from "@/lib/people";
import { DEMO_PASSWORD, getActor, landingPage, listDemoAccounts } from "@/lib/reviewer";

/** Demo sign-in, with every account listed beside the form. */
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex w-full flex-1 justify-center px-4 py-10">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Login searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Login({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const raw = (await searchParams).next;
  const next = typeof raw === "string" ? raw : null;
  const [actor, accounts] = await Promise.all([getActor(), listDemoAccounts(pool())]);
  if (actor) redirect(landingPage(actor, next));       // already signed in
  return <LoginForm accounts={accounts} password={DEMO_PASSWORD} next={next} managerRole={MANAGER_ROLE} />;
}
