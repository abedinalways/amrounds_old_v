/**
 * useCurrentUser - Get current user from Redux store
 * 
 * The user data is fetched once in AuthProvider via useMeQuery
 * and stored in Redux. This hook reads from Redux to avoid
 * duplicate API calls across components.
 */

'use client';

import { useAppSelector } from '@/app/redux/hook';

export function useCurrentUser() {
  const user = useAppSelector(state => state.auth.user);
  return user;
}