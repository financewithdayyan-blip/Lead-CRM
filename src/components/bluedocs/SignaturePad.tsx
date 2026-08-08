import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  toDataUrl: () => string;
}

/**
 * A plain <canvas> signature pad using pointer events — covers mouse, touch,
 * and pen with one code path, so no separate touch-event handling is needed.
 * Hand-rolled rather than a signature_pad dependency: the whole thing is a
 * few dozen lines, and the rest of this codebase's convention is to keep
 * small self-contained helpers rather than pull in a library for them.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, { onChange?: (hasInk: boolean) => void }>(
  function SignaturePad({ onChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef(false);
    const hasInkRef = useRef(false);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);

    // Backing store sized for the device pixel ratio so strokes stay crisp
    // on a retina phone screen, not just the CSS box size.
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2.4;
    }, []);

    function point(e: React.PointerEvent<HTMLCanvasElement>) {
      const rect = canvasRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function handleDown(e: React.PointerEvent<HTMLCanvasElement>) {
      e.currentTarget.setPointerCapture(e.pointerId);
      drawingRef.current = true;
      lastPointRef.current = point(e);
    }

    function handleMove(e: React.PointerEvent<HTMLCanvasElement>) {
      if (!drawingRef.current) return;
      const ctx = canvasRef.current?.getContext('2d');
      const p = point(e);
      const last = lastPointRef.current;
      if (ctx && last) {
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      lastPointRef.current = p;
      if (!hasInkRef.current) {
        hasInkRef.current = true;
        onChange?.(true);
      }
    }

    function handleUp() {
      drawingRef.current = false;
      lastPointRef.current = null;
    }

    useImperativeHandle(ref, () => ({
      clear() {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasInkRef.current = false;
        onChange?.(false);
      },
      isEmpty() {
        return !hasInkRef.current;
      },
      toDataUrl() {
        return canvasRef.current?.toDataURL('image/png') ?? '';
      },
    }));

    return (
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerLeave={handleUp}
      />
    );
  },
);
