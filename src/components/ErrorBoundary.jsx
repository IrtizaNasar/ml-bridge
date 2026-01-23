import React from 'react';

export class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null
        };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        console.error('[ErrorBoundary] Caught error:', error);
        console.error('[ErrorBoundary] Error info:', errorInfo);

        this.setState({
            error,
            errorInfo
        });
    }

    handleReload = () => {
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex items-center justify-center min-h-screen bg-black p-8">
                    <div className="max-w-2xl w-full bg-red-500/10 border border-red-500/50 rounded-xl p-8">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                                <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-red-400">Something went wrong</h1>
                                <p className="text-white/60 text-sm mt-1">The application encountered an unexpected error</p>
                            </div>
                        </div>

                        {this.state.error && (
                            <div className="mb-6 p-4 bg-black/40 rounded-lg border border-white/5">
                                <p className="text-xs font-mono text-red-300 mb-2">Error:</p>
                                <p className="text-xs font-mono text-white/80">{this.state.error.toString()}</p>
                            </div>
                        )}

                        <div className="flex gap-3">
                            <button
                                onClick={this.handleReload}
                                className="flex-1 px-4 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                Reload Application
                            </button>
                        </div>

                        <p className="text-xs text-white/40 mt-6 text-center">
                            If this problem persists, please check the console for more details
                        </p>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
