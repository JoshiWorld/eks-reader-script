# Problemanalyse: EKS Chip-ID Lesen

Dieses Dokument beschreibt die Fehler, die beim Auslesen der Euchner EKS Chip-ID über den COM-Port aufgetreten sind, und wie sie behoben wurden.

## Symptome

| Symptom | Beschreibung |
|---------|--------------|
| Falsche ID | Ausgabe `A55AA55AA55AA55A` statt `0241CB5342001032` |
| Timeout | `Timeout beim Warten auf STX vom EKS-Gerät` |
| TC funktioniert | Euchner Transponder Coding Software las die ID korrekt |

Das Lesegerät und der COM-Port waren in Ordnung — die Fehler lagen in der eigenen 3964R-Protokoll-Implementierung.

---

## Problem 1: Falsche Startadresse (erste Version)

### Ursache

Im Euchner-TL-Lesebefehl wird die Startadresse als **16-Bit Big-Endian** übertragen (zuerst Hi-Byte, dann Lo-Byte).

In der ersten Version wurde Little-Endian verwendet:

```
Falsch:  74 00 08   → liest Userblock-Ende
Richtig: 00 74 08   → liest ROM-Seriennummer ab Byte 116
```

### Folge

Es wurden die letzten 8 Bytes des **programmierbaren Userblocks** gelesen (dort stand `A5 5A A5 5A …`), nicht die feste **ROM-Seriennummer** an den Bytes 116–123.

### Fix

In `src/euchnerEks.ts` wird die Adresse jetzt Big-Endian kodiert:

```typescript
(startAddress >> 8) & 0xff,  // Hi-Byte
startAddress & 0xff,         // Lo-Byte
```

---

## Problem 2: BCC-Prüfsumme bei DLE im Nutzdatenstrom (Hauptursache für Timeout)

### Ursache

Die Chip-ID `0241CB5342001032` enthält an Position 6 das Byte **`0x10`**. Im 3964R-Protokoll ist `0x10` das Steuerzeichen **DLE** (Data Link Escape).

Beim Senden/Empfangen wird jedes `0x10` im Nutzdatenstrom **verdoppelt**, damit es nicht mit dem echten DLE verwechselt wird:

```
Nutzdaten (dekodiert):  02 41 CB 53 42 00 10 32
Auf der Leitung:        02 41 CB 53 42 00 10 10 32  →  dann DLE ETX BCC
                                              ^^
                                         Verdopplung
```

Die **BCC-Prüfsumme** (Block Check Character) wird laut 3964R über den **kodierten** Stream berechnet — also **mit** der DLE-Verdopplung, nicht über die dekodierten Nutzdaten.

### Was der Code falsch gemacht hat

```typescript
// FALSCH: BCC über dekodierte Daten
const messageCore = decodeMessageCore(encoded);
const expectedBcc = xorBcc([...messageCore, DLE, ETX]);
```

Für diese Chip-ID ergab das `0xC4`, das Gerät sendete aber `0xD4` (berechnet über den kodierten Stream inkl. `10 10`).

### Folge

1. Empfang der Antwort schien zu klappen
2. BCC-Prüfung schlug fehl
3. Es wurde **NAK** gesendet statt **DLE**
4. Das Gerät sendete keine neue Antwort
5. Timeout beim Warten auf **STX**

Deshalb funktionierte die Transponder Coding Software (korrekte BCC-Logik), während unser Script scheiterte — **nur bei Chip-IDs, die `0x10` enthalten**.

### Fix

In `src/protocol3964r.ts` wird die BCC jetzt über den **kodierten** Puffer geprüft:

```typescript
const encodedCore = Buffer.from(encoded);
const expectedBcc = xorBcc([...encodedCore, DLE, ETX]);

if (bcc === expectedBcc) {
  return decodeMessageCore(encodedCore);
}
```

---

## Problem 3: Empfangspuffer zu früh geleert (Nebenursache)

### Ursache

Direkt nach dem Senden bestätigt das Gerät mit `DLE` und startet die Antwort fast sofort mit `STX`. Dieses `STX` kann schon im Empfangspuffer liegen, wenn die Empfangslogik startet.

Ein blindes `reader.clear()` zu Beginn des Empfangs hat dieses `STX` verworfen.

### Fix

Der Puffer wird vor dem **ersten** Empfangsversuch nicht mehr geleert. Nur bei Wiederholungsversuchen nach einem Fehler.

---

## Korrekte Lesekonfiguration (Endstand)

| Parameter | Wert |
|-----------|------|
| Protokoll | 3964R |
| Baudrate | 9600 |
| Datenbits | 8 |
| Parität | gerade (even) |
| Stoppbits | 1 |
| Befehl | `TL` (Read Electronic-Key) |
| Startadresse | 116 (0x0074, Big-Endian) |
| Anzahl Bytes | 8 |
| Speicherbereich | Bytes 116–123 = feste ROM-Seriennummer |

---

## Zusammenfassung

| # | Problem | Symptom | Fix |
|---|---------|---------|-----|
| 1 | Little-Endian statt Big-Endian | Falsche ID aus Userblock | Adress-Bytes tauschen |
| 2 | BCC über dekodierte statt kodierte Daten | Timeout bei IDs mit `0x10` | BCC über `encoded`-Puffer |
| 3 | Empfangspuffer geleert | Intermittierender STX-Timeout | `clear()` nur bei Retries |

Das entscheidende Problem war **Nr. 2**: Die Bytefolge `…42 00 10 32` in der Chip-ID enthält ein DLE-Zeichen, das die fehlerhafte BCC-Prüfung ausgelöst hat.
