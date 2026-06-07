import { SerialPort } from "serialport";

import { EKS_SERIAL_OPTIONS, Protocol3964R } from "./protocol3964r.js";

const DEVICE_ADDRESS = 0x01;
const SERIAL_NUMBER_START_ADDRESS = 116;
const SERIAL_NUMBER_LENGTH = 8;

const STATUS_MESSAGES: Record<number, string> = {
  0x00: "Kein Fehler",
  0x02: "Electronic-Key nicht in Reichweite – bitte Chip einstecken",
  0x06: "Schreibvorgang unterbrochen",
};

export interface EksChipIdResult {
  rawBytes: Buffer;
  hex: string;
  decimal: string;
}

/** Für Client/Server-Actions serialisierbar (ohne Buffer). */
export interface EksChipIdDto {
  compact: string;
  hex: string;
  decimal: string;
}

export interface EksComPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
}

export function toChipIdDto(result: EksChipIdResult): EksChipIdDto {
  return {
    compact: result.rawBytes.toString("hex").toUpperCase(),
    hex: result.hex,
    decimal: result.decimal,
  };
}

export async function listEksComPorts(): Promise<EksComPortInfo[]> {
  const ports = await SerialPort.list();
  return ports.map((port) => ({
    path: port.path,
    manufacturer: port.manufacturer,
    serialNumber: port.serialNumber,
  }));
}

function buildReadCommand(startAddress: number, byteCount: number): Buffer {
  return Buffer.from([
    0x07,
    0x54, // 'T'
    0x4c, // 'L'
    DEVICE_ADDRESS,
    (startAddress >> 8) & 0xff,
    startAddress & 0xff,
    byteCount & 0xff,
  ]);
}

async function flushPort(port: SerialPort): Promise<void> {
  await new Promise<void>((resolve) => port.flush(() => resolve()));
}

async function preparePort(port: SerialPort): Promise<void> {
  await port.set({ dtr: true, rts: true });
  await flushPort(port);
  await new Promise<void>((resolve) => setTimeout(resolve, 400));
}

function parseReadResponse(response: Buffer): Buffer {
  if (response.length < 7) {
    throw new Error(`Unerwartete Antwortlänge: ${response.length} Bytes`);
  }

  const command = String.fromCharCode(response[1], response[2]);

  if (command === "RF") {
    const status = response[6] ?? 0xff;
    const message = STATUS_MESSAGES[status] ?? `Unbekannter Statuscode 0x${status.toString(16).padStart(2, "0")}`;
    throw new Error(message);
  }

  if (command !== "RL") {
    throw new Error(`Unerwartete Antwort '${command}'`);
  }

  const dataLength = response[6];
  const userData = response.subarray(7, 7 + dataLength);

  if (userData.length !== dataLength) {
    throw new Error("Antwort enthält weniger Nutzdaten als angegeben.");
  }

  return userData;
}

function formatChipId(bytes: Buffer): EksChipIdResult {
  return {
    rawBytes: bytes,
    hex: [...bytes].map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" "),
    decimal: [...bytes].join("."),
  };
}

export async function readEksChipId(portPath: string): Promise<EksChipIdResult> {
  const port = new SerialPort({
    path: portPath,
    ...EKS_SERIAL_OPTIONS,
    autoOpen: false,
  });

  await new Promise<void>((resolve, reject) => {
    port.open((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  try {
    await preparePort(port);

    const protocol = new Protocol3964R(port);
    const command = buildReadCommand(SERIAL_NUMBER_START_ADDRESS, SERIAL_NUMBER_LENGTH);
    const response = await protocol.exchange(command);
    const chipIdBytes = parseReadResponse(response);

    if (chipIdBytes.length !== SERIAL_NUMBER_LENGTH) {
      throw new Error(`Unerwartete Chip-ID-Länge: ${chipIdBytes.length} Bytes`);
    }

    return formatChipId(chipIdBytes);
  } finally {
    await new Promise<void>((resolve) => {
      port.close(() => resolve());
    });
  }
}
