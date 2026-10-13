import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "../ui/Button";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Top-level error boundary.
 *
 * A render-time crash in any route would otherwise leave the user on a blank
 * page. This shows a recoverable screen instead. The error is reported to the
 * console only, because the browser bundle has nowhere safe to send it and
 * `AGENTS.md` forbids leaking internals to the user: the message shown is
 * generic and a reload is offered as the recovery path.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept as a console report; there is no error-tracking service configured.
    console.error("[JibonJori] Unhandled UI error", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="mx-auto flex min-h-screen w-full max-w-lg flex-col items-center justify-center gap-4 px-4 text-center"
      >
        <p className="text-5xl font-bold text-slate-300">Oops</p>
        <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
        <p className="text-sm text-slate-500">
          The page could not be displayed. Reloading usually fixes it. If it keeps happening, the
          problem has been recorded in the browser console.
        </p>
        <div className="flex gap-3">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button
            variant="secondary"
            onClick={() => {
              window.location.assign("/");
            }}
          >
            Back to home
          </Button>
        </div>
      </div>
    );
  }
}
