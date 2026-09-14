import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import { Header } from "@/components/Header";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuantSwap",
  description: "A constant product DEX: contracts, indexer and interface.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="layout">
            <Header />
            <main className="container page">{children}</main>
            <footer className="footer">
              <div className="container">
                QuantSwap is a reference implementation on test networks only. Unaudited. Do not
                deploy it with real funds.
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
