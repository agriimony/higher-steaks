'use client';

export function MiniAppProvider({ children }: { children: React.ReactNode }) {
  // MiniAppProvider just wraps children
  // ready() is called in the page component after content loads
  return <>{children}</>;
}

