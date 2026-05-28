import React, { useCallback, useRef, useState } from 'react';

/**
 * Vertical drag handle (4 px wide) that reports horizontal mouse-motion
 * delta back to its owner.  Used by App.tsx to resize the right side
 * panel.  Lives outside the panel so the inner content doesn't need
 * any awareness of the resize logic.
 *
 * Single-source-of-truth convention: the handle does NOT own the width
 * state.  It just reports deltas; the parent clamps + persists.
 *
 * UX:
 *   - 4 px hit area, expanded to 8 px via the negative margin trick so
 *     it's easy to grab without making the visible gap thick.
 *   - `cursor: col-resize` while idle, active overlay while dragging.
 *   - Double-click resets to default — handler is supplied by the
 *     parent so it knows what default means.
 *   - Pointer Events instead of mouse so it works on touch devices /
 *     pen input without extra wiring.
 */
interface Props {
  /** Called with the horizontal delta in pixels (positive = mouse moved
   *  right) on every pointer move during a drag. */
  onResize: (deltaPx: number) => void;
  onDoubleClick?: () => void;
}

export function PanelResizeHandle({ onResize, onDoubleClick }: Props) {
  const [dragging, setDragging] = useState(false);
  const lastXRef = useRef<number | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return; // primary only
      e.preventDefault();
      lastXRef.current = e.clientX;
      setDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Older Electron may not support setPointerCapture; ignore.
      }
    },
    []
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (lastXRef.current === null) return;
      const delta = e.clientX - lastXRef.current;
      lastXRef.current = e.clientX;
      if (delta !== 0) onResize(delta);
    },
    [onResize]
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    lastXRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  return (
    <div
      role="separator"
      aria-label="Resize right panel"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      style={{
        width: 4,
        cursor: 'col-resize',
        background: dragging ? 'var(--accent, #8b5cf6)' : 'transparent',
        transition: dragging ? 'none' : 'background 120ms',
        position: 'relative',
        userSelect: 'none',
        touchAction: 'none',
        zIndex: 5,
      }}
      // Expand the hit area without making the visible bar thicker.
      // The pseudo-handle below renders into the 8 px around the
      // visible 4 px stroke so the user can grab it from either side.
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: -2,
          right: -2,
        }}
      />
    </div>
  );
}
