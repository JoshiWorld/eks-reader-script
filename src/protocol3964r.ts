import { SerialPort } from "serialport";

const STX = 0x02;
const ETX = 0x03;
const DLE = 0x10;
const NAK = 0x15;

const MAX_RETRIES = 6;
const ADT_MS = 2000;
const CDT_MS = 500;

export const EKS_SERIAL_OPTIONS = {
  baudRate: 9600,
  dataBits: 8 as const,
  parity: "even" as const,
  stopBits: 1 as const,
};

function xorBcc(bytes: readonly number[]): number {
  return bytes.reduce((bcc, byte) => bcc ^ byte, 0);
}

function withDleDuplication(messageCore: Buffer): Buffer {
  const encoded: number[] = [];

  for (const byte of messageCore) {
    encoded.push(byte);
    if (byte === DLE) {
      encoded.push(DLE);
    }
  }

  return Buffer.from(encoded);
}

function decodeMessageCore(encoded: Buffer): Buffer {
  const decoded: number[] = [];

  for (let index = 0; index < encoded.length; index += 1) {
    const byte = encoded[index];
    if (byte === DLE && index + 1 < encoded.length && encoded[index + 1] === DLE) {
      decoded.push(DLE);
      index += 1;
      continue;
    }

    decoded.push(byte);
  }

  return Buffer.from(decoded);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class SerialByteReader {
  private buffer: number[] = [];
  private resolvers: Array<(byte: number) => void> = [];

  constructor(private readonly port: SerialPort) {
    this.port.on("data", (chunk: Buffer) => {
      for (const byte of chunk) {
        if (this.resolvers.length > 0) {
          const resolve = this.resolvers.shift();
          resolve?.(byte);
        } else {
          this.buffer.push(byte);
        }
      }
    });
  }

  async readByte(timeoutMs: number): Promise<number | null> {
    if (this.buffer.length > 0) {
      return this.buffer.shift() ?? null;
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const index = this.resolvers.indexOf(onByte);
        if (index >= 0) {
          this.resolvers.splice(index, 1);
        }
        resolve(null);
      }, timeoutMs);

      const onByte = (byte: number) => {
        clearTimeout(timer);
        resolve(byte);
      };

      this.resolvers.push(onByte);
    });
  }

  clear(): void {
    this.buffer = [];
    this.resolvers = [];
  }
}

export class Protocol3964R {
  private readonly reader: SerialByteReader;

  constructor(private readonly port: SerialPort) {
    this.reader = new SerialByteReader(port);
  }

  private async writeByte(byte: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.port.write(Buffer.from([byte]), (error) => {
        if (error) {
          reject(error);
          return;
        }

        this.port.drain((drainError) => {
          if (drainError) {
            reject(drainError);
            return;
          }

          resolve();
        });
      });
    });
  }

  private async writeBytes(bytes: Buffer): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.port.write(bytes, (error) => {
        if (error) {
          reject(error);
          return;
        }

        this.port.drain((drainError) => {
          if (drainError) {
            reject(drainError);
            return;
          }

          resolve();
        });
      });
    });
  }

  private async expectByte(expected: number, timeoutMs = ADT_MS): Promise<boolean> {
    const byte = await this.reader.readByte(timeoutMs);
    return byte === expected;
  }

  private async sendConnectionSetup(): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      this.reader.clear();
      await this.writeByte(STX);

      if (await this.expectByte(DLE)) {
        return true;
      }

      await delay(50);
    }

    return false;
  }

  private async sendMessageCore(messageCore: Buffer): Promise<boolean> {
    const payload = withDleDuplication(messageCore);
    const bcc = xorBcc([...messageCore, DLE, ETX]);
    const frame = Buffer.concat([payload, Buffer.from([DLE, ETX, bcc])]);

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      if (!(await this.sendConnectionSetup())) {
        continue;
      }

      await this.writeBytes(frame);

      if (await this.expectByte(DLE)) {
        return true;
      }
    }

    return false;
  }

  private async waitForStx(): Promise<boolean> {
    while (true) {
      const byte = await this.reader.readByte(ADT_MS);
      if (byte === STX) {
        return true;
      }

      if (byte === null) {
        return false;
      }
    }
  }

  private async receiveMessageCore(): Promise<Buffer> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      if (attempt > 0) {
        this.reader.clear();
      }

      if (!(await this.waitForStx())) {
        continue;
      }

      await this.writeByte(DLE);

      const encoded: number[] = [];
      let aborted = false;

      while (!aborted) {
        const byte = await this.reader.readByte(CDT_MS);
        if (byte === null) {
          aborted = true;
          break;
        }

        if (byte !== DLE) {
          encoded.push(byte);
          continue;
        }

        const next = await this.reader.readByte(CDT_MS);
        if (next === null) {
          aborted = true;
          break;
        }

        if (next === ETX) {
          const bcc = await this.reader.readByte(CDT_MS);
          if (bcc === null) {
            aborted = true;
            break;
          }

          const encodedCore = Buffer.from(encoded);
          const expectedBcc = xorBcc([...encodedCore, DLE, ETX]);

          if (bcc === expectedBcc) {
            await this.writeByte(DLE);
            return decodeMessageCore(encodedCore);
          }

          await this.writeByte(NAK);
          aborted = true;
          break;
        }

        encoded.push(DLE);
        encoded.push(next);
      }
    }

    throw new Error(
      "Timeout beim Warten auf STX vom EKS-Gerät. Bitte Chip prüfen oder Lesegerät kurz neu verbinden.",
    );
  }

  async exchange(messageCore: Buffer): Promise<Buffer> {
    const sent = await this.sendMessageCore(messageCore);
    if (!sent) {
      throw new Error("Befehl konnte nicht an das EKS-Gerät gesendet werden.");
    }

    return this.receiveMessageCore();
  }
}
