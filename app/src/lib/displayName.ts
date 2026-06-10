import { useUser } from '@clerk/clerk-expo';

import type { Session } from './storage';

/**
 * Human name for the active session. Internal identifiers such as
 * client_user_id must never render in UI. Signed-in accounts resolve
 * through the Clerk profile (first name, else the email local part);
 * anonymous and signed-out sessions read as Guest.
 */
export function useDisplayName(session: Session | null): string {
  const { user } = useUser();
  if (session?.auth === 'clerk' && user) {
    if (user.firstName) return user.firstName;
    const email =
      user.primaryEmailAddress?.emailAddress ??
      user.emailAddresses[0]?.emailAddress;
    const local = email?.split('@')[0];
    if (local) return local;
  }
  return 'Guest';
}
