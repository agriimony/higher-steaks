import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { MiniAppProvider } from "@/components/MiniAppProvider";
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '@/lib/wagmi-config';

const inter = Inter({ subsets: ["latin"] });

// Create a client for React Query
const queryClient = new QueryClient();

export const metadata: Metadata = {
  title: "Higher Steaks",
  description: "Staking interface for higher network discovery",
  openGraph: {
    title: "Higher Steaks",
    description: "Staking interface for higher network discovery",
    images: ["/embed.png"],
  },
  other: {
    "fc:miniapp": JSON.stringify({
      version: "1",
      imageUrl: "https://higher-steaks.vercel.app/embed.png",
      button: {
        title: "See what's cooking 👀",
        action: {
          type: "launch_frame",
          url: "https://higher-steaks.vercel.app/",
          name: "Higher Steaks",
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
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            <MiniAppProvider>{children}</MiniAppProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </body>
    </html>
  );
}