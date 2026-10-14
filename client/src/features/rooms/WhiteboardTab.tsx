import React from 'react';
import { PenLine, RotateCcw, Download } from 'lucide-react';

interface WhiteboardTabProps {
  roomId: string;
}

/**
 * WhiteboardTab — canvas placeholder for collaborative whiteboard.
 * Real-time drawing sync via Socket.IO will be added in a future story.
 */
export const WhiteboardTab: React.FC<WhiteboardTabProps> = () => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = React.useState(false);
  const [tool] = React.useState<'pen' | 'eraser'>('pen');
  const lastPos = React.useRef<{ x: number; y: number } | null>(null);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setDrawing(true);
    lastPos.current = getPos(e);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing || !canvasRef.current || !lastPos.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = tool === 'eraser' ? '#080c14' : '#6366f1';
    ctx.lineWidth = tool === 'eraser' ? 20 : 2.5;
    ctx.lineCap = 'round';
    ctx.stroke();
    lastPos.current = pos;
  };

  const stopDraw = () => {
    setDrawing(false);
    lastPos.current = null;
  };

  const clearCanvas = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const downloadCanvas = () => {
    const link = document.createElement('a');
    link.download = 'whiteboard.png';
    link.href = canvasRef.current?.toDataURL() || '';
    link.click();
  };

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-1">
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-400 text-xs font-semibold">
          <PenLine className="w-3.5 h-3.5" />
          <span>Whiteboard</span>
        </div>
        <div className="flex-1" />
        <button
          id="whiteboard-clear"
          onClick={clearCanvas}
          title="Clear canvas"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-all"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Clear
        </button>
        <button
          id="whiteboard-download"
          onClick={downloadCanvas}
          title="Download as PNG"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          Save
        </button>
      </div>

      {/* Canvas */}
      <div className="flex-1 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-inner">
        <canvas
          ref={canvasRef}
          width={1200}
          height={700}
          id="room-whiteboard-canvas"
          className="w-full h-full cursor-crosshair touch-none"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
        />
      </div>
      <p className="text-xs text-center text-slate-400 dark:text-slate-600">
        Local drawing only — real-time sync coming in a future sprint.
      </p>
    </div>
  );
};
