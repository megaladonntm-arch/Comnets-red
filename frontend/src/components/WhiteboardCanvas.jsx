import { useEffect, useMemo, useRef, useState } from "react";

const COLORS = ["#f6c344", "#ff7a59", "#7dd3fc", "#8ce99a", "#f472b6"];

function drawStroke(ctx, stroke, width, height) {
  const points = stroke.points || [];
  if (!points.length) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.color || "#f6c344";
  ctx.lineWidth = stroke.width || 3;
  ctx.beginPath();
  ctx.moveTo(points[0].x * width, points[0].y * height);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x * width, points[index].y * height);
  }
  if (points.length === 1) {
    ctx.lineTo(points[0].x * width + 0.01, points[0].y * height + 0.01);
  }
  ctx.stroke();
  ctx.restore();
}

export default function WhiteboardCanvas({
  enabled,
  canDraw,
  isOwner,
  strokes,
  clientId,
  onToggle,
  onClear,
  onDrawEvent
}) {
  const wrapperRef = useRef(null);
  const canvasRef = useRef(null);
  const drawingRef = useRef({ active: false, strokeId: null, lastPoint: null });
  const [brushColor, setBrushColor] = useState(COLORS[0]);
  const [brushSize, setBrushSize] = useState(3);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!wrapperRef.current) return undefined;

    const node = wrapperRef.current;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setCanvasSize({
        width: Math.max(320, Math.floor(rect.width)),
        height: Math.max(260, Math.floor(rect.height))
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvasSize.width || !canvasSize.height) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvasSize.width * dpr);
    canvas.height = Math.floor(canvasSize.height * dpr);
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

    strokes.forEach((stroke) => drawStroke(ctx, stroke, canvasSize.width, canvasSize.height));
  }, [canvasSize.height, canvasSize.width, strokes]);

  const boardLabel = useMemo(() => {
    if (!enabled) return "Board disabled";
    if (canDraw) return "Everyone in the room can draw live";
    return "Live board is active";
  }, [canDraw, enabled]);

  const resolvePoint = (event) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const finishStroke = () => {
    if (!drawingRef.current.active) return;
    onDrawEvent({ mode: "end", stroke_id: drawingRef.current.strokeId });
    drawingRef.current = { active: false, strokeId: null, lastPoint: null };
  };

  const handlePointerDown = (event) => {
    if (!enabled || !canDraw) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const point = resolvePoint(event);
    if (!point) return;

    const stroke = {
      id: `${clientId || "user"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      author_id: clientId,
      color: brushColor,
      width: brushSize,
      points: [point]
    };

    drawingRef.current = {
      active: true,
      strokeId: stroke.id,
      lastPoint: point
    };

    canvasRef.current?.setPointerCapture?.(event.pointerId);
    onDrawEvent({ mode: "start", stroke });
  };

  const handlePointerMove = (event) => {
    if (!drawingRef.current.active || !enabled || !canDraw) return;
    const point = resolvePoint(event);
    if (!point) return;

    const previous = drawingRef.current.lastPoint;
    const distance = previous
      ? Math.hypot(point.x - previous.x, point.y - previous.y)
      : Number.POSITIVE_INFINITY;
    if (distance < 0.0035) return;

    drawingRef.current.lastPoint = point;
    onDrawEvent({
      mode: "point",
      stroke_id: drawingRef.current.strokeId,
      point
    });
  };

  return (
    <section className="whiteboard-panel card">
      <div className="whiteboard-header">
        <div>
          <p className="eyebrow">Whiteboard</p>
          <h3>Shared work board</h3>
          <p className="muted">{boardLabel}</p>
        </div>
        <div className="whiteboard-actions">
          {isOwner && (
            <button className={enabled ? "secondary" : "primary"} onClick={onToggle}>
              {enabled ? "Disable board" : "Enable board"}
            </button>
          )}
          {enabled && isOwner && (
            <button className="ghost" onClick={onClear}>
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="board-toolbar">
        <div className="color-row">
          {COLORS.map((color) => (
            <button
              key={color}
              className={`color-swatch${brushColor === color ? " active" : ""}`}
              style={{ background: color }}
              onClick={() => setBrushColor(color)}
              type="button"
              disabled={!enabled}
              aria-label={`Brush ${color}`}
            />
          ))}
        </div>
        <label className="board-size">
          Brush
          <input
            type="range"
            min="2"
            max="10"
            step="1"
            value={brushSize}
            disabled={!enabled}
            onChange={(event) => setBrushSize(Number(event.target.value))}
          />
        </label>
      </div>

      <div className={`whiteboard-shell${enabled ? "" : " disabled"}`} ref={wrapperRef}>
        <canvas
          ref={canvasRef}
          className="whiteboard-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerLeave={finishStroke}
          onPointerCancel={finishStroke}
        />
        {!enabled && (
          <div className="whiteboard-overlay">
            <strong>Board is off</strong>
            <span>Owner can enable it for the whole room.</span>
          </div>
        )}
      </div>
    </section>
  );
}
