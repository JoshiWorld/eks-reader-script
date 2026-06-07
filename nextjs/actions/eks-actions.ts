"use server";

import { listEksComPorts, readEksChipId, toChipIdDto, type EksChipIdDto, type EksComPortInfo } from "@/lib/eks/euchnerEks";

export type EksReadResult =
  | { ok: true; chipId: EksChipIdDto }
  | { ok: false; error: string };

export async function getEksComPorts(): Promise<EksComPortInfo[]> {
  return listEksComPorts();
}

export async function readEksChipIdFromPort(portPath: string): Promise<EksReadResult> {
  if (!portPath.trim()) {
    return { ok: false, error: "Bitte einen COM-Port auswählen." };
  }

  try {
    const result = await readEksChipId(portPath.trim());
    return { ok: true, chipId: toChipIdDto(result) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler beim Lesen.";
    return { ok: false, error: message };
  }
}
