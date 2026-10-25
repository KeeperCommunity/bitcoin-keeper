import React, { ReactElement, useEffect } from 'react';
import { Platform } from 'react-native';

export const STARTUP_BOUNDARY_STAGES = Object.freeze([
  'ENTRYPOINT_READY',
  'ENTRYPOINT_REGISTERED',
  'ROOT_WRAPPER_RENDERED',
  'APP_RENDERED',
  'APP_COMMITTED',
  'SAFE_AREA_CHILDREN_RENDERED',
  'SAFE_AREA_CHILDREN_COMMITTED',
  'HCE_WRAPPER_COMMITTED',
  'HCE_CHILDREN_RENDERED',
  'HCE_CHILDREN_COMMITTED',
  'NAVIGATOR_COMMITTED',
  'SPLASH_COMMITTED',
  'SPLASH_UNMOUNTED',
  'CREDENTIAL_PROBE_ENTERED',
  'CREDENTIAL_PROBE_RESOLVED',
  'CREDENTIAL_PROBE_REJECTED',
  'ROUTE_REPLACE_ENTERED',
  'ROUTE_REPLACE_RETURNED',
  'ROUTE_REPLACE_THROWN',
  'CREATE_PIN_COMMITTED',
] as const);

type StartupBoundaryStage = (typeof STARTUP_BOUNDARY_STAGES)[number];
const observed = new Set<StartupBoundaryStage>();

// Fixed development observations only. Never receive credentials, route data,
// errors, timings or native values; a missing marker always remains unknown.
export const observeStartupBoundary = (stage: StartupBoundaryStage) => {
  try {
    if (typeof __DEV__ === 'undefined' || !__DEV__ || Platform.OS !== 'android') return;
    if (
      typeof stage !== 'string' ||
      !STARTUP_BOUNDARY_STAGES.includes(stage) ||
      observed.has(stage)
    )
      return;
    const hook = (global as unknown as { nativeLoggingHook?: unknown }).nativeLoggingHook;
    if (typeof hook !== 'function') return;
    observed.add(stage);
    hook(`KEEPER_STARTUP_BOUNDARY|v1|${stage}`, 1);
  } catch {
    /* Optional observation cannot replace startup or native results. */
  }
};

function StartupBoundary({
  children,
  rendered,
  committed,
}: {
  children: ReactElement;
  rendered: StartupBoundaryStage;
  committed: StartupBoundaryStage;
}) {
  // Deliberate diagnostic render witness: unlike a committed effect, it still
  // records that a gate released children if a descendant subsequently throws.
  observeStartupBoundary(rendered);
  useEffect(() => {
    observeStartupBoundary(committed);
  }, [committed]);
  return children;
}

export const withStartupBoundary = (
  children: ReactElement,
  rendered: StartupBoundaryStage,
  committed: StartupBoundaryStage
) => {
  if (typeof __DEV__ === 'undefined' || !__DEV__ || Platform.OS !== 'android') return children;
  return (
    <StartupBoundary rendered={rendered} committed={committed}>
      {children}
    </StartupBoundary>
  );
};
