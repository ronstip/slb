import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const label = this.props.label ?? 'unknown';
    console.error(`[ErrorBoundary:${label}]`, error, info.componentStack);
  }

  private handleReset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-sm font-medium text-foreground">Something went wrong.</div>
        <div className="max-w-md text-xs text-muted-foreground">{this.state.error.message}</div>
        <button
          onClick={this.handleReset}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted"
        >
          Try again
        </button>
      </div>
    );
  }
}
