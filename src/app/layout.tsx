import "@/styles/globals.css";

import { type Metadata } from "next";
import { Geist, Geist_Mono, Manrope } from "next/font/google";

import { TRPCReactProvider } from "@/trpc/react";

export const metadata: Metadata = {
  title: "XDream Cloud",
  description: "XDream Cloud control plane for multi-agent operations on Kubernetes",
  icons: {
    icon: [{ url: "/xdream-cloud-mark.svg", type: "image/svg+xml" }],
    shortcut: ["/xdream-cloud-mark.svg"],
  },
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="zh-CN"
      className={`${geist.variable} ${geistMono.variable} ${manrope.variable}`}
    >
      <body>
        <TRPCReactProvider>{children}</TRPCReactProvider>
      </body>
    </html>
  );
}
