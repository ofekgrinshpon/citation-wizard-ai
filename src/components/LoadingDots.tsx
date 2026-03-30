export function LoadingDots() {
  return (
    <div className="flex items-start gap-2.5 mb-4" style={{ direction: "rtl" }}>
      <div className="avatar-assistant w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-base">
        🏛
      </div>
      <div className="chat-bubble-assistant px-4 py-3 flex gap-1.5 items-center">
        {[0, 0.2, 0.4].map((delay, i) => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-primary"
            style={{ animation: `pulse-dot 1.2s ease-in-out ${delay}s infinite` }}
          />
        ))}
      </div>
    </div>
  );
}
