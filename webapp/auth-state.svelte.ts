// Shared reactive auth state — imported by any component needing login status.

type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated' | 'no-server';

export const authState = $state({ status: 'unknown' as AuthStatus, username: '' });
