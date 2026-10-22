import { Component, type ReactNode } from "react";
import { recordDesktopError } from "../../lib/desktop/errorLog";

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    recordDesktopError("render_error");
  }
  render() {
    if (this.state.failed)
      return (
        <main className="empty-state" role="alert">
          <h2>页面暂时无法显示</h2>
          <button
            className="ghost-button"
            onClick={() => window.location.reload()}
            type="button"
          >
            重新加载
          </button>
        </main>
      );
    return this.props.children;
  }
}
