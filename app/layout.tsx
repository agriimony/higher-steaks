import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { MiniAppProvider } from "@/components/MiniAppProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Higher Steaks",
  description: "Staking interface for higher network discovery",
  openGraph: {
    title: "Higher Steaks",
    description: "Staking interface for higher network discovery",
    images: ["/og-image.svg"],
  },
  other: {
    "fc:miniapp": JSON.stringify({
      version: "1",
      imageUrl: "http://localhost:3000/og-image.svg",
      button: {
        title: "Higher Steaks",
        action: {
          type: "launch",
          url: "/",
        },
      },
    }),
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://auth.farcaster.xyz" />
      </head>
      <body className={inter.className}>
        <MiniAppProvider>{children}</MiniAppProvider>
      </body>
    </html>
  );
}

