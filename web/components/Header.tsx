"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletButton } from "./WalletButton";
import { IndexerStatus } from "./IndexerStatus";

const LINKS = [
  { href: "/", label: "Swap" },
  { href: "/pools", label: "Pools" },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="header">
      <div className="container header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden />
          QuantSwap
        </Link>
        <nav className="nav">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={pathname === link.href ? "active" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="header-right">
          <IndexerStatus />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
