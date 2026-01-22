import React from 'react';

export class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        console.error('[ErrorBoundary] Caught an error:', error, errorInfo);
        this.setState({
            error: error,
            errorInfo: errorInfo
        });
    }

    handleReset() {
        this.setState({ hasError: false, error: null, errorInfo: null });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="h-full w-full bg-[#050505] flex items-center justify-center p-8">
                    <div className="max-w-lg w-full bg-[#0A0A0A] border border-red-500/50 rounded-xl p-8 shadow-2xl">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center border border-red-500/30">
                                <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-white mb-1">Something went wrong</h2>
                                <p className="text-sm text-zinc-400">The application encountered an unexpected error</p>
                            </div>
                        </div>

                        {this.state.error && (
                            <div className="bg-black/50 border border-zinc-800 rounded-lg p-4 mb-6">
                                <p className="text-xs font-mono text-red-400 mb-2">{this.state.error.toString()}</p>
                                {this.state.errorInfo && this.state.errorInfo.componentStack && (
                                    <details className="text-[10px] font-mono text-zinc-500">
                                        <summary className="cursor-pointer hover:text-zinc-400 mb-2">View component stack</summary>
                                        <pre className="whitespace-pre-wrap break-all">{this.state.errorInfo.componentStack}</pre>
                                    </details>
                                )}
                            </div>
                        )}

                        <div className="space-y-3">
                            <button
                                onClick={this.handleReset}
                                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-lg transition-all"
                            >
                                Try Again
                            </button>
                            <button
                                onClick={() => window.location.reload()}
                                className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-sm rounded-lg transition-all"
                            >
                                Reload Application
                            </button>
                        </div>

                        <p className="text-xs text-zinc-600 mt-6 text-center">
                            Error details have been logged to the console
                        </p>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
