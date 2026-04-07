const shapes = [
  // Rectangles
  { type: "rect", x: "5%", y: "10%", w: 120, h: 80, rotate: 15, color: "#36b7ad", delay: 0, duration: 18 },
  { type: "rect", x: "85%", y: "15%", w: 90, h: 60, rotate: -20, color: "#3ea3d3", delay: 2, duration: 22 },
  { type: "rect", x: "75%", y: "70%", w: 140, h: 50, rotate: 35, color: "#36b7ad", delay: 4, duration: 20 },
  { type: "rect", x: "10%", y: "75%", w: 100, h: 70, rotate: -10, color: "#3ea3d3", delay: 1, duration: 25 },
  { type: "rect", x: "50%", y: "5%", w: 80, h: 120, rotate: 45, color: "#36b7ad", delay: 3, duration: 19 },
  // Triangles
  { type: "tri", x: "20%", y: "30%", size: 80, rotate: 30, color: "#3ea3d3", delay: 5, duration: 24 },
  { type: "tri", x: "80%", y: "45%", size: 60, rotate: -15, color: "#36b7ad", delay: 2, duration: 21 },
  { type: "tri", x: "15%", y: "55%", size: 70, rotate: 60, color: "#3ea3d3", delay: 6, duration: 17 },
  { type: "tri", x: "65%", y: "85%", size: 90, rotate: -45, color: "#36b7ad", delay: 1, duration: 23 },
  // Lines
  { type: "line", x: "30%", y: "20%", length: 200, rotate: 25, color: "#3ea3d3", delay: 3, duration: 26 },
  { type: "line", x: "70%", y: "30%", length: 160, rotate: -35, color: "#36b7ad", delay: 0, duration: 20 },
  { type: "line", x: "40%", y: "80%", length: 180, rotate: 10, color: "#3ea3d3", delay: 4, duration: 22 },
  { type: "line", x: "90%", y: "60%", length: 140, rotate: -60, color: "#36b7ad", delay: 2, duration: 18 },
  { type: "line", x: "8%", y: "40%", length: 120, rotate: 50, color: "#3ea3d3", delay: 5, duration: 24 },
];

export function GeometricBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0" aria-hidden="true">
      <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <style>{`
            @keyframes geo-drift {
              0%, 100% { transform: translate(0, 0); }
              25% { transform: translate(12px, -18px); }
              50% { transform: translate(-8px, 14px); }
              75% { transform: translate(16px, 8px); }
            }
          `}</style>
        </defs>
        {shapes.map((s, i) => (
          <g
            key={i}
            style={{
              animation: `geo-drift ${s.duration}s ease-in-out ${s.delay}s infinite`,
            }}
          >
            {s.type === "rect" && (
              <rect
                x={s.x}
                y={s.y}
                width={s.w}
                height={s.h}
                rx={4}
                fill={s.color}
                opacity={0.05}
                transform={`rotate(${s.rotate})`}
                style={{ transformOrigin: `${s.x} ${s.y}` }}
              />
            )}
            {s.type === "tri" && (
              <polygon
                points={`0,${s.size!} ${s.size! / 2},0 ${s.size!},${s.size!}`}
                fill={s.color}
                opacity={0.05}
                transform={`translate(${parseFloat(s.x)}%, ${parseFloat(s.y)}%) rotate(${s.rotate})`}
                style={{
                  transform: `translate(${s.x}, ${s.y}) rotate(${s.rotate}deg)`,
                  transformOrigin: "center",
                }}
              />
            )}
            {s.type === "line" && (
              <line
                x1={s.x}
                y1={s.y}
                x2={s.x}
                y2={s.y}
                stroke={s.color}
                strokeWidth={1.5}
                opacity={0.05}
                style={{
                  transform: `rotate(${s.rotate}deg)`,
                  transformOrigin: `${s.x} ${s.y}`,
                }}
                strokeLinecap="round"
              >
                <animate
                  attributeName="x2"
                  from={s.x}
                  to={`calc(${s.x} + ${s.length}px)`}
                  dur="0s"
                  fill="freeze"
                />
              </line>
            )}
          </g>
        ))}
        {/* Grid-like subtle lines */}
        {[...Array(6)].map((_, i) => (
          <line
            key={`grid-h-${i}`}
            x1="0"
            y1={`${15 + i * 15}%`}
            x2="100%"
            y2={`${15 + i * 15}%`}
            stroke="#3ea3d3"
            strokeWidth={0.5}
            opacity={0.03}
          />
        ))}
        {[...Array(8)].map((_, i) => (
          <line
            key={`grid-v-${i}`}
            x1={`${10 + i * 12}%`}
            y1="0"
            x2={`${10 + i * 12}%`}
            y2="100%"
            stroke="#36b7ad"
            strokeWidth={0.5}
            opacity={0.03}
          />
        ))}
      </svg>
    </div>
  );
}
