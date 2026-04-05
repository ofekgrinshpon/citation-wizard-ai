import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { hasError: boolean; error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, textAlign: "center", fontFamily: "Heebo, sans-serif", direction: "rtl" }}>
          <h2 style={{ marginBottom: 8 }}>משהו השתבש</h2>
          <p style={{ color: "#666", fontSize: 14 }}>{this.state.error?.message}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16,
              padding: "8px 20px",
              border: "1px solid #ccc",
              borderRadius: 8,
              background: "#fff",
              cursor: "pointer",
            }}
          >
            רענן את הדף
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
