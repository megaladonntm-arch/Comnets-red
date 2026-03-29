import { useEffect, useMemo, useRef, useState } from "react";

const COLORS = ["#f6c344", "#ff7a59", "#7dd3fc", "#8ce99a", "#f472b6"];
const TEXT_LIMIT = 160;

function drawBoardBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#fffaf2");
  gradient.addColorStop(1, "#f4ecde");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.strokeStyle = "rgba(26, 40, 61, 0.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStroke(ctx, stroke, width, height) {
  const points = stroke.points || [];
  if (!points.length) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.color || COLORS[0];
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

function drawTextItem(ctx, item, width, height) {
  const point = item.point;
  if (!point || !item.text) return;

  const fontSize = item.size || 24;
  const lines = item.text.split("\n");
  ctx.save();
  ctx.fillStyle = item.color || COLORS[0];
  ctx.font = `600 ${fontSize}px Manrope, system-ui, sans-serif`;
  ctx.textBaseline = "top";
  lines.forEach((line, index) => {
    ctx.fillText(line, point.x * width, point.y * height + index * (fontSize + 4));
  });
  ctx.restore();
}

function renderBoard(ctx, elements, width, height, withBackground = false) {
  if (withBackground) {
    drawBoardBackground(ctx, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }

  elements.forEach((element) => {
    if (element.kind === "text") {
      drawTextItem(ctx, element, width, height);
      return;
    }
    drawStroke(ctx, element, width, height);
  });
}

export default function WhiteboardCanvas({
  enabled,
  canDraw,
  isOwner,
  elements,
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
  const [tool, setTool] = useState("draw");
  const [textValue, setTextValue] = useState("");
  const [boardError, setBoardError] = useState("");

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
    renderBoard(ctx, elements, canvasSize.width, canvasSize.height, false);
  }, [canvasSize.height, canvasSize.width, elements]);

  const boardLabel = useMemo(() => {
    if (!enabled) return "Board disabled";
    if (tool === "text") return "Click any point on the board to place your text";
    if (canDraw) return "Everyone in the room can draw live";
    return "Live board is active";
  }, [canDraw, enabled, tool]);

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
    setBoardError("");

    if (tool === "text") {
      const content = textValue.trim();
      if (!content) {
        setBoardError("Enter text before placing it on the board.");
        return;
      }

      onDrawEvent({
        mode: "text",
        text: {
          kind: "text",
          id: `${clientId || "user"}-text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          author_id: clientId,
          color: brushColor,
          size: Math.max(16, brushSize * 6),
          point,
          text: content
        }
      });
      return;
    }

    const stroke = {
      kind: "stroke",
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
    if (tool !== "draw" || !drawingRef.current.active || !enabled || !canDraw) return;
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

  const handleSave = () => {
    if (!elements.length || !canvasSize.width || !canvasSize.height) return;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvasSize.width;
    exportCanvas.height = canvasSize.height;
    const ctx = exportCanvas.getContext("2d");
    renderBoard(ctx, elements, canvasSize.width, canvasSize.height, true);

    const link = document.createElement("a");
    link.href = exportCanvas.toDataURL("image/png");
    link.download = `whiteboard-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
    link.click();
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
          {elements.length > 0 && (
            <button className="secondary" onClick={handleSave} type="button">
              Save PNG
            </button>
          )}
          {isOwner && (
            <button className={enabled ? "secondary" : "primary"} onClick={onToggle} type="button">
              {enabled ? "Disable board" : "Enable board"}
            </button>
          )}
          {enabled && isOwner && (
            <button className="ghost" onClick={onClear} type="button">
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="board-toolbar">
        <div className="tool-row">
          <button
            className={tool === "draw" ? "toggle active" : "toggle"}
            onClick={() => setTool("draw")}
            type="button"
            disabled={!enabled}
          >
            Draw
          </button>
          <button
            className={tool === "text" ? "toggle active" : "toggle"}
            onClick={() => setTool("text")}
            type="button"
            disabled={!enabled}
          >
            Text
          </button>
        </div>

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
          {tool === "text" ? "Text size" : "Brush"}
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

      {tool === "text" && (
        <label className="board-text-input">
          Text content
          <textarea
            value={textValue}
            onChange={(event) => {
              setTextValue(event.target.value.slice(0, TEXT_LIMIT));
              if (boardError) setBoardError("");
            }}
            disabled={!enabled}
            rows={3}
            placeholder="Type text, then click on the board"
          />
          <span className="muted">{textValue.length}/{TEXT_LIMIT}</span>
        </label>
      )}

      {boardError && <p className="form-error">{boardError}</p>}

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
