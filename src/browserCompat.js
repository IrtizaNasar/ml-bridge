/**
 * Browser compatibility checks and polyfills for ML Bridge
 * Ensures the application works across different browsers
 */

/**
 * Checks if a browser feature is available
 * @param {string} feature - Feature name to check
 * @returns {boolean} True if feature is supported
 */
export const checkFeatureSupport = (feature) => {
    const features = {
        webgl: () => {
            try {
                const canvas = document.createElement('canvas');
                return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
            } catch (e) {
                return false;
            }
        },
        webworkers: () => typeof Worker !== 'undefined',
        websockets: () => typeof WebSocket !== 'undefined',
        localstorage: () => {
            try {
                const test = '__storage_test__';
                localStorage.setItem(test, test);
                localStorage.removeItem(test);
                return true;
            } catch (e) {
                return false;
            }
        },
        mediadevices: () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
        indexeddb: () => typeof indexedDB !== 'undefined'
    };

    return features[feature] ? features[feature]() : false;
};

/**
 * Gets browser compatibility report
 * @returns {Object} Compatibility status for all features
 */
export const getBrowserCompatibility = () => {
    return {
        webgl: checkFeatureSupport('webgl'),
        webworkers: checkFeatureSupport('webworkers'),
        websockets: checkFeatureSupport('websockets'),
        localstorage: checkFeatureSupport('localstorage'),
        mediadevices: checkFeatureSupport('mediadevices'),
        indexeddb: checkFeatureSupport('indexeddb')
    };
};

/**
 * Logs browser compatibility warnings
 */
export const logCompatibilityWarnings = () => {
    const compat = getBrowserCompatibility();

    if (!compat.webgl) {
        console.warn('[Compatibility] WebGL not supported - TensorFlow.js will use CPU backend (slower)');
    }

    if (!compat.webworkers) {
        console.warn('[Compatibility] Web Workers not supported - WebSocket may throttle when window is hidden');
    }

    if (!compat.websockets) {
        console.error('[Compatibility] WebSockets not supported - Serial Bridge connection will fail');
    }

    if (!compat.localstorage) {
        console.warn('[Compatibility] LocalStorage not available - Cannot save/load datasets');
    }

    if (!compat.mediadevices) {
        console.warn('[Compatibility] MediaDevices API not available - Webcam input will not work');
    }

    if (!compat.indexeddb) {
        console.warn('[Compatibility] IndexedDB not available - Large dataset storage may be limited');
    }
};

/**
 * Polyfill for Object.entries (IE11 support)
 */
if (!Object.entries) {
    Object.entries = function (obj) {
        const ownProps = Object.keys(obj);
        let i = ownProps.length;
        const resArray = new Array(i);
        while (i--) {
            resArray[i] = [ownProps[i], obj[ownProps[i]]];
        }
        return resArray;
    };
}

/**
 * Polyfill for Object.values (IE11 support)
 */
if (!Object.values) {
    Object.values = function (obj) {
        return Object.keys(obj).map(key => obj[key]);
    };
}

/**
 * Polyfill for Array.from (IE11 support)
 */
if (!Array.from) {
    Array.from = (function () {
        const toStr = Object.prototype.toString;
        const isCallable = function (fn) {
            return typeof fn === 'function' || toStr.call(fn) === '[object Function]';
        };
        const toInteger = function (value) {
            const number = Number(value);
            if (isNaN(number)) return 0;
            if (number === 0 || !isFinite(number)) return number;
            return (number > 0 ? 1 : -1) * Math.floor(Math.abs(number));
        };
        const maxSafeInteger = Math.pow(2, 53) - 1;
        const toLength = function (value) {
            const len = toInteger(value);
            return Math.min(Math.max(len, 0), maxSafeInteger);
        };

        return function from(arrayLike/*, mapFn, thisArg */) {
            const C = this;
            const items = Object(arrayLike);
            if (arrayLike == null) {
                throw new TypeError('Array.from requires an array-like object - not null or undefined');
            }
            const mapFn = arguments.length > 1 ? arguments[1] : void undefined;
            let T;
            if (typeof mapFn !== 'undefined') {
                if (!isCallable(mapFn)) {
                    throw new TypeError('Array.from: when provided, the second argument must be a function');
                }
                if (arguments.length > 2) {
                    T = arguments[2];
                }
            }
            const len = toLength(items.length);
            const A = isCallable(C) ? Object(new C(len)) : new Array(len);
            let k = 0;
            let kValue;
            while (k < len) {
                kValue = items[k];
                if (mapFn) {
                    A[k] = typeof T === 'undefined' ? mapFn(kValue, k) : mapFn.call(T, kValue, k);
                } else {
                    A[k] = kValue;
                }
                k += 1;
            }
            A.length = len;
            return A;
        };
    }());
}

/**
 * Polyfill for Promise (IE11 support)
 * Note: For production, consider using a more robust polyfill like core-js
 */
if (typeof Promise === 'undefined') {
    console.warn('[Compatibility] Promise not supported - some features may not work. Consider using a polyfill.');
}
