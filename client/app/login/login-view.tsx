"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, BookOpenCheck, Eye, EyeOff, IndianRupee, MessagesSquare, ShieldCheck, Sparkles } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ApiError } from "@/lib/api";
import { HOME_BY_ROLE, useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { Role } from "@/lib/types";

const DEMO_ACCOUNTS: { role: Role; name: string; email: string; password: string; note: string }[] = [
  { role: "admin", name: "BookLeaf Support", email: "admin@bookleaf.com", password: "Admin@123", note: "Ops team: ticket queue & AI drafts" },
  { role: "author", name: "Ananya Reddy", email: "ananya.reddy@email.com", password: "Author@123", note: "Royalty never paid · urgent ticket" },
  { role: "author", name: "Sneha Kulkarni", email: "sneha.kulkarni@email.com", password: "Author@123", note: "3 books · one still in Cover Design" },
  { role: "author", name: "Priya Sharma", email: "priya.sharma@email.com", password: "Author@123", note: "2 live books · royalty pending" },
  { role: "author", name: "Kavita Deshmukh", email: "kavita.deshmukh@email.com", password: "Author@123", note: "Pending below the ₹1,000 minimum" },
];

/** Only same-origin, in-app paths are allowed after login (no open redirects). */
const safeNext = (next: string | null, role: Role) =>
  next && next.startsWith(`/${role}`) && !next.startsWith("//") ? next : HOME_BY_ROLE[role];

export function LoginView() {
  const { status, user, login } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  // Already signed in (e.g. returned to /login): go straight to the portal.
  useEffect(() => {
    if (status === "authenticated" && user) router.replace(safeNext(next, user.role));
  }, [status, user, next, router]);

  const validate = () => {
    const found: typeof errors = {};
    if (!email.trim()) found.email = "Enter your email address";
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) found.email = "Enter a valid email address";
    if (!password) found.password = "Enter your password";
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const signedIn = await login(email.trim(), password);
      router.replace(safeNext(next, signedIn.role));
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      setErrors({ ...(apiError?.fieldErrors() ?? {}), form: apiError?.message ?? "Sign in failed. Please try again." });
      setSubmitting(false);
    }
  };

  const fillDemo = (account: (typeof DEMO_ACCOUNTS)[number]) => {
    setEmail(account.email);
    setPassword(account.password);
    setErrors({});
    emailRef.current?.focus();
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-brand-800 text-brand-50 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          aria-hidden
          style={{ backgroundImage: "radial-gradient(circle at 20% 20%, #4a9197 0, transparent 45%), radial-gradient(circle at 80% 90%, #2d757c 0, transparent 40%)" }}
        />
        <div className="relative">
          <span className="inline-flex items-center gap-2.5 rounded-xl bg-white/10 px-3 py-2 backdrop-blur">
            <Logo compact />
            <span className="font-display text-lg font-semibold text-white">BookLeaf Publishing</span>
          </span>
        </div>
        <div className="relative max-w-md">
          <h1 className="font-display text-4xl leading-tight font-semibold text-white">Your books, your royalties, and a team that answers.</h1>
          <ul className="mt-8 space-y-4 text-brand-100">
            {[
              { icon: <IndianRupee className="size-4" />, text: "See sales and royalty payouts for every title" },
              { icon: <BookOpenCheck className="size-4" />, text: "Follow your book through each production stage" },
              { icon: <MessagesSquare className="size-4" />, text: "Raise a ticket and get replies here, as they happen" },
            ].map((item) => (
              <li key={item.text} className="flex items-center gap-3">
                <span className="grid size-8 place-items-center rounded-lg bg-white/10" aria-hidden>
                  {item.icon}
                </span>
                {item.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-brand-200">India · United States · 22,000+ titles</p>
      </section>

      {/* Form */}
      <section className="flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h2 className="font-display text-3xl font-semibold tracking-tight text-ink">Welcome back</h2>
          <p className="mt-1.5 text-muted">Sign in to your BookLeaf account.</p>

          <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
            {errors.form && (
              <div role="alert" className="flex gap-2.5 rounded-lg border border-danger-600/30 bg-danger-50 px-3.5 py-3 text-sm text-danger-700">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {errors.form}
              </div>
            )}

            <Field label="Email" error={errors.email}>
              {({ id, describedBy, invalid }) => (
                <Input
                  ref={emailRef}
                  id={id}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-describedby={describedBy}
                  invalid={invalid}
                />
              )}
            </Field>

            <Field label="Password" error={errors.password}>
              {({ id, describedBy, invalid }) => (
                <div className="relative">
                  <Input
                    id={id}
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted hover:text-ink"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </button>
                </div>
              )}
            </Field>

            <Button type="submit" size="lg" className="w-full" loading={submitting}>
              {submitting ? "Signing in" : "Sign in"}
            </Button>
          </form>

          <Card className="mt-8 overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line bg-paper-2/60 px-4 py-3">
              <Sparkles className="size-4 text-brand-600" aria-hidden />
              <h3 className="text-sm font-semibold text-ink">Demo credentials</h3>
              <span className="ml-auto text-xs text-muted">Click to fill in</span>
            </div>
            <ul className="divide-y divide-line">
              {DEMO_ACCOUNTS.map((account) => {
                const selected = email === account.email;
                return (
                  <li key={account.email}>
                    <button
                      type="button"
                      onClick={() => fillDemo(account)}
                      aria-pressed={selected}
                      className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-paper-2/60", selected && "bg-brand-50")}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-ink">{account.name}</span>
                          <Badge tone={account.role === "admin" ? "brand" : "neutral"} icon={account.role === "admin" ? <ShieldCheck className="size-3" aria-hidden /> : undefined}>
                            {account.role === "admin" ? "Admin" : "Author"}
                          </Badge>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted">{account.note}</span>
                      </span>
                      <span className="hidden font-mono text-[11px] text-muted sm:block">{account.email}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
              All 10 seeded authors use <span className="font-mono text-ink-2">Author@123</span>.
            </p>
          </Card>
        </div>
      </section>
    </div>
  );
}
