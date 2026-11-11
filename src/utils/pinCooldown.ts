import { PasswordTimeout } from './PasswordTimeout';

export const getRemainingPinCooldown = (
  failedAttempts: number,
  lastLoginFailedAt: number | null,
  now: number = Date.now()
): number => {
  if (failedAttempts < 1 || lastLoginFailedAt === null) return 0;
  const expiresAt = lastLoginFailedAt + PasswordTimeout(failedAttempts) * 1000;
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
};

export const formatPinCooldown = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
    : `${minutes}:${remainder}`;
};
