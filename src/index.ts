import { SerialPort } from "serialport";

import { readEksChipId } from "./euchnerEks.js";

const DEFAULT_PORT = "COM3";

function getPortFromArgs(): string {
  const portFlagIndex = process.argv.findIndex((arg) => arg === "--port" || arg === "-p");
  if (portFlagIndex >= 0 && process.argv[portFlagIndex + 1]) {
    return process.argv[portFlagIndex + 1];
  }

  return process.env.EKS_PORT ?? DEFAULT_PORT;
}

async function listAvailablePorts(): Promise<void> {
  const ports = await SerialPort.list();
  if (ports.length === 0) {
    console.log("Keine COM-Ports gefunden.");
    return;
  }

  console.log("Verfügbare COM-Ports:");
  for (const port of ports) {
    const details = [port.path, port.manufacturer, port.serialNumber].filter(Boolean).join(" | ");
    console.log(`  - ${details}`);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--list-ports")) {
    await listAvailablePorts();
    return;
  }

  const portPath = getPortFromArgs();

  console.log("Euchner EKS Chip-ID Reader");
  console.log("Gerät: EKS-A-IUX-G01-ST01 (092750)");
  console.log(`COM-Port: ${portPath}`);
  console.log("Lese 8-Byte-Chip-ID (ROM-Seriennummer) ab Adresse 116 ...\n");

  try {
    const result = await readEksChipId(portPath);

    console.log("EKS Chip-ID erfolgreich gelesen:");
    console.log(`  Hex:      ${result.hex}`);
    console.log(`  Dezimal:  ${result.decimal}`);
    console.log(`  Kompakt:  ${result.rawBytes.toString("hex").toUpperCase()}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Fehler: ${message}`);
    console.error("\nHinweise:");
    console.error("  - Ist die Euchner Transponder Coding Software geschlossen? (COM-Port-Freigabe)");
    console.error("  - Ist der Electronic-Key im Lesegerät eingesteckt?");
    console.error("  - Ist das Lesegerät per USB verbunden und als COM-Port sichtbar?");
    console.error("  - Stimmt der COM-Port? Andere Ports mit: npm start -- --port COMx");
    console.error("  - Verfügbare Ports anzeigen: npm start -- --list-ports");
    process.exitCode = 1;
  }
}

main();
