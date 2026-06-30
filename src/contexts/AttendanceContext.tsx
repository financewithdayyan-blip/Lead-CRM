import { type ReactNode } from 'react';

// Attendance is now tracked inside CallSessionPage directly, so this
// provider is a plain pass-through kept only to avoid touching App.tsx.
export function AttendanceProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
