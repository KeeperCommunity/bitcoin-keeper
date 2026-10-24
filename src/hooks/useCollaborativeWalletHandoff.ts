import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

type Session = {
  signers: Record<string, unknown>;
  isComplete: boolean;
  lastSynced: number | null;
};
type Scope = { appId: string; network: string };
type Pending = Scope & {
  stage: 'add-hide' | 'session-hide' | 'reset';
  action?: 'continue' | 'new';
};

/** Only hand off after the native modal has hidden, within the originating account/network. */
export function useCollaborativeWalletHandoff({
  appId,
  network,
  session,
  resetSession,
  navigate,
}: Scope & { session: Session; resetSession: () => void; navigate: () => void }) {
  const [addVisible, setAddVisible] = useState(false);
  const [sessionVisible, setSessionVisible] = useState(false);
  const [stage, setStage] = useState<Pending['stage'] | null>(null);
  const scope = useRef<Scope | null>(null);
  const latestSession = useRef(session);
  const pending = useRef<Pending | null>(null);

  useLayoutEffect(() => {
    scope.current = { appId, network };
    pending.current = null;
    setStage(null);
    setAddVisible(false);
    setSessionVisible(false);
    return () => {
      scope.current = null;
      pending.current = null;
    };
  }, [appId, network]);

  useLayoutEffect(() => {
    latestSession.current = session;
  }, [session]);

  const isCurrent = useCallback(
    (request: Pending) =>
      !!scope.current?.appId &&
      scope.current.appId === request.appId &&
      scope.current.network === request.network,
    []
  );

  const beginReset = useCallback(
    (request: Pending) => {
      if (!isCurrent(request)) return;
      pending.current = { ...request, stage: 'reset' };
      setStage('reset');
      resetSession();
    },
    [isCurrent, resetSession]
  );

  useEffect(() => {
    const request = pending.current;
    if (
      stage === 'reset' &&
      request?.stage === 'reset' &&
      isCurrent(request) &&
      Object.keys(session.signers).length === 0 &&
      !session.isComplete &&
      session.lastSynced === null
    ) {
      pending.current = null;
      setStage(null);
      navigate();
    }
  }, [stage, isCurrent, navigate, session]);

  const cancel = useCallback(() => {
    pending.current = null;
    setStage(null);
  }, []);

  return {
    addVisible,
    sessionVisible,
    waitForAddHide: stage === 'add-hide',
    waitForSessionHide: stage === 'session-hide',
    openAdd: () => {
      if (!pending.current && !sessionVisible) setAddVisible(true);
    },
    closeAdd: () => {
      cancel();
      setAddVisible(false);
    },
    closeSession: () => {
      cancel();
      setSessionVisible(false);
    },
    selectCollaborative: () => {
      if (!addVisible || pending.current || !scope.current?.appId) return;
      pending.current = { ...scope.current, stage: 'add-hide' };
      setStage('add-hide');
      setAddVisible(false);
    },
    onAddHide: () => {
      const request = pending.current;
      if (request?.stage !== 'add-hide' || !isCurrent(request)) return;
      // Consume the hide once before opening another modal or dispatching a reset.
      pending.current = null;
      setStage(null);
      if (Object.keys(latestSession.current.signers).length > 0) {
        setSessionVisible(true);
      } else {
        beginReset(request);
      }
    },
    finishSession: (action: 'continue' | 'new') => {
      if (!sessionVisible || pending.current || !scope.current?.appId) return;
      pending.current = { ...scope.current, stage: 'session-hide', action };
      setStage('session-hide');
      setSessionVisible(false);
    },
    onSessionHide: () => {
      const request = pending.current;
      if (request?.stage !== 'session-hide' || !isCurrent(request)) return;
      pending.current = null;
      setStage(null);
      if (request.action === 'continue') {
        if (Object.keys(latestSession.current.signers).length > 0) navigate();
      } else {
        beginReset(request);
      }
    },
  };
}
