"use client";

import { useSync } from "@/lib/local-db/sync-provider";
import { WifiOff, Wifi, RefreshCw, AlertCircle, CheckCircle } from "lucide-react";
import { useState } from "react";

export function OfflineIndicator() {
  const { isOnline, status, lastSynced, sync } = useSync();
  const [showDetails, setShowDetails] = useState(false);

  if (isOnline && status === "idle") {
    return null;
  }

  const formatLastSynced = (timestamp: number | null) => {
    if (!timestamp) return "Never";
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 1000,
        maxWidth: 320,
      }}
    >
      <div
        style={{
          background: isOnline
            ? status === "syncing"              ? "#fef3c7"              : status === "error"              ? "#fef2f2"              : "#f0fdf4"            : "#fffbeb",          border: `1px solid ${
            isOnline              ? status === "syncing"                ? "#fcd34d"                : status === "error"                ? "#fecaca"                : "#86efac"              : "#fcd34d"          }`,          borderRadius: 12,          padding: 12,          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",          animation: "slideIn 0.3s ease-out",        }}
      >
        <style jsx>{`
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .spin {
            animation: spin 1s linear infinite;
          }
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",              background: isOnline                ? status === "syncing"                  ? "#fef3c7"                  : status === "error"                  ? "#fef2f2"                  : "#f0fdf4"                : "#fffbeb",              flexShrink: 0,            }}          >            {isOnline ? (              status === "syncing" ? (                <RefreshCw className="spin" size={18} color="#f59e0b" />              ) : status === "error" ? (                <AlertCircle size={18} color="#ef4444" />              ) : (                <CheckCircle size={18} color="#22c55e" />              )            ) : (              <WifiOff size={18} color="#f59e0b" />            )}          </div>
          <div style={{ flex: 1, minWidth: 0 }}>            {!isOnline && (              <>                <div style={{ fontWeight: 600, fontSize: 14, color: "#92400e" }}>                  You're Offline                </div>                <div style={{ fontSize: 12, color: "#b45309", marginTop: 2 }}>                  Changes saved locally. Will sync when online.                </div>              </>            )}
            {isOnline && status === "syncing" && (              <>                <div style={{ fontWeight: 600, fontSize: 14, color: "#92400e" }}>                  Syncing...                </div>                <div style={{ fontSize: 12, color: "#b45309", marginTop: 2 }}>                  Updating your data across devices                </div>              </>            )}
            {isOnline && status === "error" && (              <>                <div style={{ fontWeight: 600, fontSize: 14, color: "#991b1b" }}>                  Sync Failed                </div>                <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 2 }}>                  Click to retry                </div>              </>            )}
            {isOnline && status === "idle" && lastSynced && (              <>                <div style={{ fontWeight: 600, fontSize: 14, color: "#166534" }}>                  Synced {formatLastSynced(lastSynced)}                </div>              </>            )}          </div>
          <button            onClick={() => setShowDetails(!showDetails)}            style={{              background: "transparent",              border: "none",              cursor: "pointer",              padding: 4,              color: "#6b7280",              display: "flex",              alignItems: "center",              justifyContent: "center",            }}          >            {showDetails ? <Wifi size={16} /> : <Wifi size={16} />}          </button>        </div>
        {showDetails && (          <div            style={{              marginTop: 12,              paddingTop: 12,              borderTop: `1px solid ${                isOnline                  ? status === "syncing"                    ? "#fcd34d"                    : status === "error"                    ? "#fecaca"                    : "#86efac"                  : "#fcd34d"              }`,            }}          >            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>              <button                onClick={sync}                disabled={status === "syncing"}                style={{                  padding: "6px 12px",                  borderRadius: 6,                  border: "none",                  background: "#6366f1",                  color: "white",                  fontSize: 12,                  cursor: status === "syncing" ? "not-allowed" : "pointer",                  opacity: status === "syncing" ? 0.6 : 1,                }}              >                {status === "syncing" ? "Syncing..." : "Sync Now"}              </button>
              {!isOnline && (                <span                  style={{                    padding: "6px 12px",                    borderRadius: 6,                    background: "#fffbeb",                    border: "1px solid #fcd34d",                    color: "#92400e",                    fontSize: 12,                    display: "flex",                    alignItems: "center",                  }}                >                  <WifiOff size={12} style={{ marginRight: 4 }} />                  Offline                </span>              )}
              {lastSynced && (                <span                  style={{                    padding: "6px 12px",                    borderRadius: 6,                    background: isOnline ? "#f0fdf4" : "#fffbeb",                    border: `1px solid ${isOnline ? "#86efac" : "#fcd34d"}`,                    color: isOnline ? "#166534" : "#92400e",                    fontSize: 12,                    display: "flex",                    alignItems: "center",                  }}                >                  <CheckCircle size={12} style={{ marginRight: 4 }} />                  Last: {formatLastSynced(lastSynced)}                </span>              )}            </div>          </div>        )}      </div>    </div>  );
}
