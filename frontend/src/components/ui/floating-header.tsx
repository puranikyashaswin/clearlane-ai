"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MapPin,
  BarChart3,
  MenuIcon,
  HelpCircle,
} from "lucide-react";
import { Sheet, SheetContent, SheetFooter } from "@/components/ui/sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Logo from "@/components/Logo";

const navLinks = [
  { label: "Map", href: "/", icon: MapPin },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
];

export function FloatingHeader() {
  const [open, setOpen] = React.useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const istTime = useMemo(
    () =>
      now
        ? new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          }).format(now)
        : "--:--:--",
    [now],
  );

  const istDate = useMemo(
    () =>
      now
        ? new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Kolkata",
            weekday: "short",
            day: "2-digit",
            month: "short",
            year: "numeric",
          }).format(now)
        : "---",
    [now],
  );

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <header
      className={cn(
        "fixed top-3 left-1/2 -translate-x-1/2 z-50",
        "w-[calc(100%-2rem)] max-w-5xl rounded-xl border border-zinc-800/60 shadow-2xl",
        "bg-zinc-950/30 supports-[backdrop-filter]:bg-zinc-950/20 backdrop-blur-2xl",
      )}
    >
      <nav className="mx-auto flex items-center justify-between px-2 py-1.5">
        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-2">
          <Link href="/" className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 transition hover:bg-zinc-800/50">
            <Logo />
            <span className="font-mono text-sm font-bold text-zinc-100">ClearLane</span>
          </Link>
          <span className="mx-1 h-5 w-px bg-zinc-800" />
          <div className="hidden items-center gap-0.5 lg:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={buttonVariants({
                  variant: isActive(link.href) ? "secondary" : "ghost",
                  size: "sm",
                  className: cn(
                    "text-xs font-medium transition",
                    isActive(link.href)
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:text-zinc-100",
                  ),
                })}
              >
                <link.icon className="mr-1.5 size-3.5" />
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Center: Clock */}
        <div className="hidden items-center gap-3 font-mono tabular-nums lg:flex">
          <span className="text-[10px] uppercase tracking-wider text-zinc-600">IST</span>
          <span className="text-sm font-medium text-zinc-100">{istTime}</span>
          <span className="text-zinc-700">·</span>
          <span className="text-[10px] text-zinc-500">{istDate}</span>
        </div>

        {/* Right: Status + Help + Mobile Menu */}
        <div className="flex items-center gap-2">
          {/* System status */}
          <div className="hidden items-center gap-2 lg:flex">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-cyan-500/40" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-500" />
            </span>
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">
              Live
            </span>
          </div>

          <Link
            href="/"
            aria-label="Help"
            className="grid h-7 w-7 place-items-center rounded-md border border-zinc-800 bg-zinc-900 text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-100"
          >
            <HelpCircle className="size-3.5" />
          </Link>

          {/* Mobile hamburger */}
          <Sheet open={open} onOpenChange={setOpen}>
            <Button
              size="icon"
              variant="outline"
              onClick={() => setOpen(!open)}
              className="lg:hidden border-zinc-700 bg-zinc-900"
            >
              <MenuIcon className="size-4" />
            </Button>
            <SheetContent
              className="bg-zinc-950/95 supports-[backdrop-filter]:bg-zinc-950/80 gap-0 border-zinc-800 backdrop-blur-xl"
              showClose={false}
              side="left"
            >
              <div className="flex flex-col gap-1 px-4 pt-12 pb-5">
                <div className="mb-4 flex items-center gap-2 px-2">
                  <Logo />
                  <span className="font-mono text-base font-bold text-zinc-100">ClearLane</span>
                </div>
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={buttonVariants({
                      variant: isActive(link.href) ? "secondary" : "ghost",
                      className: cn(
                        "justify-start text-sm",
                        isActive(link.href)
                          ? "bg-zinc-800 text-zinc-100"
                          : "text-zinc-400",
                      ),
                    })}
                  >
                    <link.icon className="mr-2 size-4" />
                    {link.label}
                  </Link>
                ))}
              </div>
              <SheetFooter>
                <div className="flex items-center gap-2 px-2 font-mono tabular-nums text-xs text-zinc-500">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-cyan-500/40" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-500" />
                  </span>
                  {istTime} IST
                </div>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
