import { useState, useRef, useCallback } from 'react';

const EXPIRE_MS = 20_000;

export function useUndoHistory() {
  const [mode, setMode] = useState(null); // null | 'undo' | 'redo'
  const [label, setLabel] = useState('');
  const actionRef = useRef(null);
  const timerRef = useRef(null);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    actionRef.current = null;
    setMode(null);
    setLabel('');
  }, []);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(clear, EXPIRE_MS);
  }, [clear]);

  const pushUndo = useCallback((lbl, fn) => {
    actionRef.current = fn;
    setMode('undo');
    setLabel(lbl);
    schedule();
  }, [schedule]);

  const pushRedo = useCallback((fn) => {
    actionRef.current = fn;
    setMode('redo');
    schedule();
  }, [schedule]);

  const execute = useCallback(async () => {
    const fn = actionRef.current;
    if (!fn) return;
    actionRef.current = null;
    clearTimeout(timerRef.current);
    setMode(null);
    await fn();
  }, []);

  return { mode, label, pushUndo, pushRedo, execute };
}
