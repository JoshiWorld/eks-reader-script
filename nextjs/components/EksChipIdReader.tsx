"use client";

import { useCallback, useEffect, useState } from "react";

import { getEksComPorts, readEksChipIdFromPort, type EksReadResult } from "@/actions/eks-actions";
import type { EksComPortInfo } from "@/lib/eks/euchnerEks";

const DEFAULT_PORT = "COM3";

export function EksChipIdReader() {
  const [ports, setPorts] = useState<EksComPortInfo[]>([]);
  const [selectedPort, setSelectedPort] = useState(DEFAULT_PORT);
  const [chipId, setChipId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingPorts, setIsLoadingPorts] = useState(false);
  const [isReading, setIsReading] = useState(false);

  const loadPorts = useCallback(async () => {
    setIsLoadingPorts(true);
    setError(null);

    try {
      const available = await getEksComPorts();
      setPorts(available);

      if (available.length > 0) {
        const hasSelected = available.some((port) => port.path === selectedPort);
        if (!hasSelected) {
          setSelectedPort(available[0].path);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "COM-Ports konnten nicht geladen werden.";
      setError(message);
    } finally {
      setIsLoadingPorts(false);
    }
  }, [selectedPort]);

  useEffect(() => {
    void loadPorts();
  }, [loadPorts]);

  async function handleRead() {
    setIsReading(true);
    setError(null);
    setChipId(null);

    const result: EksReadResult = await readEksChipIdFromPort(selectedPort);

    if (result.ok) {
      setChipId(result.chipId.compact);
    } else {
      setError(result.error);
    }

    setIsReading(false);
  }

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        maxWidth: "28rem",
        padding: "1.5rem",
        border: "1px solid #e5e7eb",
        borderRadius: "0.75rem",
      }}
    >
      <header>
        <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Euchner EKS Chip-ID</h2>
        <p style={{ margin: "0.5rem 0 0", color: "#6b7280", fontSize: "0.875rem" }}>
          Electronic-Key muss im Lesegerät stecken. Transponder Coding Software vorher schließen.
        </p>
      </header>

      <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
        <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>COM-Port</span>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <select
            value={selectedPort}
            onChange={(event) => setSelectedPort(event.target.value)}
            disabled={isLoadingPorts || isReading || ports.length === 0}
            style={{ flex: 1, padding: "0.5rem 0.75rem", borderRadius: "0.5rem", border: "1px solid #d1d5db" }}
          >
            {ports.length === 0 ? (
              <option value="">Kein Port gefunden</option>
            ) : (
              ports.map((port) => (
                <option key={port.path} value={port.path}>
                  {port.path}
                  {port.manufacturer ? ` — ${port.manufacturer}` : ""}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            onClick={() => void loadPorts()}
            disabled={isLoadingPorts || isReading}
            style={{ padding: "0.5rem 0.75rem", borderRadius: "0.5rem", border: "1px solid #d1d5db", background: "#fff" }}
          >
            {isLoadingPorts ? "…" : "Aktualisieren"}
          </button>
        </div>
      </label>

      <button
        type="button"
        onClick={() => void handleRead()}
        disabled={isReading || !selectedPort}
        style={{
          padding: "0.625rem 1rem",
          borderRadius: "0.5rem",
          border: "none",
          background: isReading ? "#9ca3af" : "#111827",
          color: "#fff",
          fontWeight: 600,
          cursor: isReading ? "not-allowed" : "pointer",
        }}
      >
        {isReading ? "Lese Chip-ID …" : "Chip-ID auslesen"}
      </button>

      {chipId && (
        <output
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "0.5rem",
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            fontFamily: "monospace",
            fontSize: "1.125rem",
            letterSpacing: "0.05em",
          }}
        >
          {chipId}
        </output>
      )}

      {error && (
        <p role="alert" style={{ margin: 0, color: "#b91c1c", fontSize: "0.875rem" }}>
          {error}
        </p>
      )}
    </section>
  );
}
