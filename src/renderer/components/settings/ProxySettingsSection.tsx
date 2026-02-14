// === FILE PURPOSE ===
// Proxy settings section for the Settings page.
// Lets the user configure an HTTP proxy for AI API calls in enterprise networks.
// Supports system proxy detection (env vars) and manual proxy URL entry.

// === DEPENDENCIES ===
// React, lucide-react icons

import { useEffect, useState } from 'react';
import { Globe, Loader2, Check, AlertCircle } from 'lucide-react';

/** Settings keys for proxy configuration */
const PROXY_URL_KEY = 'proxy:url';
const PROXY_NO_PROXY_KEY = 'proxy:noProxy';
const PROXY_USE_SYSTEM_KEY = 'proxy:useSystem';

type FeedbackState = { type: 'success' | 'error'; message: string } | null;

export default function ProxySettingsSection() {
  const [proxyUrl, setProxyUrl] = useState('');
  const [noProxy, setNoProxy] = useState('');
  const [useSystem, setUseSystem] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [systemProxy, setSystemProxy] = useState<string | null>(null);

  // Load saved settings on mount
  useEffect(() => {
    async function load() {
      try {
        const [savedUrl, savedNoProxy, savedUseSystem, currentProxy] =
          await Promise.all([
            window.electronAPI.getSetting(PROXY_URL_KEY),
            window.electronAPI.getSetting(PROXY_NO_PROXY_KEY),
            window.electronAPI.getSetting(PROXY_USE_SYSTEM_KEY),
            window.electronAPI.getProxy(),
          ]);

        // Detect if a system proxy is active (from env vars)
        // If getProxy returns a value but no savedUrl is in DB, it came from env
        if (currentProxy && !savedUrl) {
          setSystemProxy(currentProxy.url);
        }

        setProxyUrl(savedUrl ?? '');
        setNoProxy(savedNoProxy ?? '');
        setUseSystem(savedUseSystem !== 'false');
      } catch (err) {
        console.error('Failed to load proxy settings:', err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  // Clear feedback after 4 seconds
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(timer);
  }, [feedback]);

  /** Validate a proxy URL (must start with http:// or https://) */
  function isValidProxyUrl(url: string): boolean {
    if (!url.trim()) return true; // empty is valid (means "no proxy")
    return /^https?:\/\/.+/.test(url.trim());
  }

  const handleSave = async () => {
    const trimmedUrl = proxyUrl.trim();

    if (trimmedUrl && !isValidProxyUrl(trimmedUrl)) {
      setFeedback({
        type: 'error',
        message: 'Proxy URL must start with http:// or https://',
      });
      return;
    }

    setSaving(true);
    setFeedback(null);

    try {
      // Save use-system preference
      await window.electronAPI.setSetting(
        PROXY_USE_SYSTEM_KEY,
        String(useSystem),
      );

      if (useSystem) {
        // Clear manual proxy settings when using system proxy
        await window.electronAPI.deleteSetting(PROXY_URL_KEY);
        await window.electronAPI.deleteSetting(PROXY_NO_PROXY_KEY);
      } else {
        // Save manual proxy settings
        if (trimmedUrl) {
          await window.electronAPI.setSetting(PROXY_URL_KEY, trimmedUrl);
        } else {
          await window.electronAPI.deleteSetting(PROXY_URL_KEY);
        }

        const trimmedNoProxy = noProxy.trim();
        if (trimmedNoProxy) {
          await window.electronAPI.setSetting(
            PROXY_NO_PROXY_KEY,
            trimmedNoProxy,
          );
        } else {
          await window.electronAPI.deleteSetting(PROXY_NO_PROXY_KEY);
        }
      }

      // Re-apply proxy with new settings
      await window.electronAPI.applyProxy();

      setFeedback({ type: 'success', message: 'Proxy settings saved' });
    } catch (err) {
      console.error('Failed to save proxy settings:', err);
      setFeedback({
        type: 'error',
        message: 'Failed to save proxy settings',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="mb-10">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-surface-100">
            Network Proxy
          </h2>
        </div>
        <div className="flex items-center justify-center py-6 text-surface-500">
          <Loader2 size={20} className="animate-spin" />
        </div>
      </section>
    );
  }

  return (
    <section className="mb-10">
      {/* Section header */}
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <Globe size={18} className="text-primary-400" />
          <h2 className="text-lg font-semibold text-surface-100">
            Network Proxy
          </h2>
        </div>
        <p className="text-sm text-surface-500 mt-1">
          Configure an HTTP proxy for AI API calls in enterprise networks.
        </p>
      </div>

      <div className="p-4 bg-surface-800 border border-surface-700 rounded-lg space-y-4">
        {/* Use system proxy toggle */}
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={useSystem}
            onChange={(e) => setUseSystem(e.target.checked)}
            className="w-4 h-4 rounded border-surface-600 bg-surface-700 text-primary-500 focus:ring-primary-500 focus:ring-offset-0"
          />
          <div>
            <span className="text-sm font-medium text-surface-200">
              Use system proxy
            </span>
            <p className="text-xs text-surface-500">
              {systemProxy
                ? `Detected: ${systemProxy}`
                : 'Reads from HTTPS_PROXY / HTTP_PROXY environment variables'}
            </p>
          </div>
        </label>

        {/* Manual proxy fields (shown when system proxy is off) */}
        {!useSystem && (
          <div className="space-y-3 pt-2 border-t border-surface-700">
            <div>
              <label className="block text-sm font-medium text-surface-200 mb-1.5">
                Proxy URL
              </label>
              <input
                type="text"
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                placeholder="http://proxy.corp.com:8080"
                className="w-full text-sm text-surface-200 bg-surface-900 px-3 py-2 rounded border border-surface-700 focus:border-primary-500 focus:outline-none placeholder-surface-600"
              />
              <p className="text-xs text-surface-500 mt-1">
                Must start with http:// or https://
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-200 mb-1.5">
                No-proxy list
              </label>
              <input
                type="text"
                value={noProxy}
                onChange={(e) => setNoProxy(e.target.value)}
                placeholder="localhost, 127.0.0.1, .internal.corp.com"
                className="w-full text-sm text-surface-200 bg-surface-900 px-3 py-2 rounded border border-surface-700 focus:border-primary-500 focus:outline-none placeholder-surface-600"
              />
              <p className="text-xs text-surface-500 mt-1">
                Comma-separated domains that bypass the proxy
              </p>
            </div>
          </div>
        )}

        {/* Save button and feedback */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary-600 hover:bg-primary-500 disabled:bg-surface-700 disabled:text-surface-500 text-white rounded-lg transition-colors"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : null}
            {saving ? 'Saving...' : 'Save'}
          </button>

          {feedback && (
            <span
              className={`flex items-center gap-1.5 text-sm ${
                feedback.type === 'success'
                  ? 'text-emerald-400'
                  : 'text-red-400'
              }`}
            >
              {feedback.type === 'success' ? (
                <Check size={14} />
              ) : (
                <AlertCircle size={14} />
              )}
              {feedback.message}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
