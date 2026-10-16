import { MiniscriptTypes } from 'src/services/wallets/enums';

/** Reject a lost duration before generating any replacement policy. */
export function resolveInitialTimelock(
  types: MiniscriptTypes[],
  selectedDuration: string | number | null | undefined,
  durationForLabel: (label: string) => number | undefined
): number {
  const required = types.includes(MiniscriptTypes.TIMELOCKED);
  const absent = selectedDuration == null || selectedDuration === '' || selectedDuration === 0;
  if (absent && !required) return 0;
  if (absent || typeof selectedDuration !== 'string') {
    throw new Error('Failed to determine initial timelock duration');
  }
  const duration = durationForLabel(selectedDuration);
  if (typeof duration !== 'number' || !Number.isSafeInteger(duration) || duration <= 0) {
    throw new Error('Failed to determine initial timelock duration');
  }
  return duration;
}
