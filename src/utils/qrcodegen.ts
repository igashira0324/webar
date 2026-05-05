/* 
 * QR Code generator library (TypeScript)
 * 
 * Copyright (c) Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/qr-code-generator-library
 */

export type bit = number;

export class QrCode {
  public static encodeText(text: string, ecl: Ecc): QrCode {
    const segs: Array<QrSegment> = QrSegment.makeSegments(text);
    return QrCode.encodeSegments(segs, ecl);
  }

  public static encodeSegments(segs: Array<QrSegment>, ecl: Ecc, minVersion: number = 1, maxVersion: number = 40, mask: number = -1, boostEcl: boolean = true): QrCode {
    if (!(1 <= minVersion && minVersion <= maxVersion && maxVersion <= 40) || mask < -1 || mask > 7)
      throw new RangeError("Invalid value");

    let version: number;
    let dataUsedBits: number;
    for (version = minVersion; ; version++) {
      const dataCapacityBits: number = QrCode.getNumDataCodewords(version, ecl) * 8;
      const usedBits: number = QrSegment.getTotalBits(segs, version);
      if (usedBits <= dataCapacityBits) {
        dataUsedBits = usedBits;
        break;
      }
      if (version >= maxVersion)
        throw new RangeError("Data too long");
    }

    if (boostEcl) {
      for (const newEcl of [Ecc.MEDIUM, Ecc.QUARTILE, Ecc.HIGH]) {
        if (dataUsedBits <= QrCode.getNumDataCodewords(version, newEcl) * 8)
          ecl = newEcl;
      }
    }

    let bb: Array<bit> = [];
    for (const seg of segs) {
      QrCode.appendBits(seg.mode.modeBits, 4, bb);
      QrCode.appendBits(seg.numChars, seg.mode.numCharCountBits(version), bb);
      for (const b of seg.getData())
        bb.push(b);
    }

    const dataCapacityBits: number = QrCode.getNumDataCodewords(version, ecl) * 8;
    QrCode.appendBits(0, Math.min(4, dataCapacityBits - bb.length), bb);
    QrCode.appendBits(0, (8 - bb.length % 8) % 8, bb);

    for (let padByte = 0xEC; bb.length < dataCapacityBits; padByte ^= 0xEC ^ 0x11)
      QrCode.appendBits(padByte, 8, bb);

    let dataCodewords: Array<number> = [];
    while (dataCodewords.length * 8 < bb.length)
      dataCodewords.push(0);
    bb.forEach((b, i) => dataCodewords[i >>> 3] |= b << (7 - (i & 7)));

    return new QrCode(version, ecl, dataCodewords, mask);
  }

  public readonly version: number;
  public readonly errorCorrectionLevel: Ecc;
  public readonly size: number;
  public readonly modules: Array<Array<boolean>> = [];
  private isFunction: Array<Array<boolean>> = [];

  constructor(
    version: number,
    errorCorrectionLevel: Ecc,
    dataCodewords: Array<number>,
    msk: number
  ) {
    this.version = version;
    this.errorCorrectionLevel = errorCorrectionLevel;
    this.size = version * 4 + 17;
    const row: Array<boolean> = [];
    for (let i = 0; i < this.size; i++)
      row.push(false);
    for (let i = 0; i < this.size; i++) {
      this.modules.push(row.slice());
      this.isFunction.push(row.slice());
    }

    this.drawFunctionPatterns();
    const allCodewords: Array<number> = this.addEccAndInterleave(dataCodewords);
    this.drawData(allCodewords);

    if (msk === -1) {
      let minPenalty: number = 1000000000;
      for (let i = 0; i < 8; i++) {
        this.applyMask(i);
        this.drawFormatBits(i);
        const penalty: number = this.getPenaltyScore();
        if (penalty < minPenalty) {
          msk = i;
          minPenalty = penalty;
        }
        this.applyMask(i);
      }
    }
    this.applyMask(msk);
    this.drawFormatBits(msk);
    this.isFunction = [];
  }

  public getModule(x: number, y: number): boolean {
    return 0 <= x && x < this.size && 0 <= y && y < this.size && this.modules[y][x];
  }

  private drawFunctionPatterns(): void {
    for (let i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }

    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    const alignPatPos: Array<number> = this.getAlignmentPatternPositions();
    const numAlign: number = alignPatPos.length;
    for (let i = 0; i < numAlign; i++) {
      for (let j = 0; j < numAlign; j++) {
        if (!(i === 0 && j === 0 || i === 0 && j === numAlign - 1 || i === numAlign - 1 && j === 0))
          this.drawAlignmentPattern(alignPatPos[i], alignPatPos[j]);
      }
    }

    this.drawFormatBits(0);
    this.drawVersion();
  }

  private drawFormatBits(mask: number): void {
    const data: number = this.errorCorrectionLevel.formatBits << 3 | mask;
    let rem: number = data;
    for (let i = 0; i < 10; i++)
      rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits: number = (data << 10 | rem) ^ 0x5412;

    for (let i = 0; i <= 5; i++)
      this.setFunctionModule(8, i, QrCode.getBit(bits, i));
    this.setFunctionModule(8, 7, QrCode.getBit(bits, 6));
    this.setFunctionModule(8, 8, QrCode.getBit(bits, 7));
    this.setFunctionModule(7, 8, QrCode.getBit(bits, 8));
    for (let i = 9; i < 15; i++)
      this.setFunctionModule(14 - i, 8, QrCode.getBit(bits, i));

    for (let i = 0; i < 8; i++)
      this.setFunctionModule(this.size - 1 - i, 8, QrCode.getBit(bits, i));
    for (let i = 8; i < 15; i++)
      this.setFunctionModule(8, this.size - 15 + i, QrCode.getBit(bits, i));
    this.setFunctionModule(8, this.size - 8, true);
  }

  private drawVersion(): void {
    if (this.version < 7)
      return;

    let rem: number = this.version;
    for (let i = 0; i < 12; i++)
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const bits: number = this.version << 12 | rem;

    for (let i = 0; i < 18; i++) {
      const color: boolean = QrCode.getBit(bits, i);
      const a: number = this.size - 11 + i % 3;
      const b: number = Math.floor(i / 3);
      this.setFunctionModule(a, b, color);
      this.setFunctionModule(b, a, color);
    }
  }

  private drawFinderPattern(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist: number = Math.max(Math.abs(dx), Math.abs(dy));
        const xx: number = x + dx;
        const yy: number = y + dy;
        if (0 <= xx && xx < this.size && 0 <= yy && yy < this.size)
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  }

  private drawAlignmentPattern(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++)
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  private setFunctionModule(x: number, y: number, isDark: boolean): void {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  }

  private addEccAndInterleave(data: Array<number>): Array<number> {
    const ver: number = this.version;
    const ecl: Ecc = this.errorCorrectionLevel;
    if (data.length !== QrCode.getNumDataCodewords(ver, ecl))
      throw new RangeError("Invalid argument");

    const numBlocks: number = NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
    const blockEccLen: number = ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver];
    const rawCodewords: number = Math.floor(QrCode.getNumRawDataModules(ver) / 8);
    const numShortBlocks: number = numBlocks - rawCodewords % numBlocks;
    const shortBlockLen: number = Math.floor(rawCodewords / numBlocks);

    const blocks: Array<Array<number>> = [];
    const rsDiv: Array<number> = QrCode.reedSolomonComputeDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const dat: Array<number> = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      const ecc: Array<number> = QrCode.reedSolomonComputeRemainder(dat, rsDiv);
      if (i < numShortBlocks)
        dat.push(0);
      blocks.push(dat.concat(ecc));
    }

    const result: Array<number> = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((block, j) => {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks)
          result.push(block[i]);
      });
    }
    return result;
  }

  private drawData(data: Array<number>): void {
    let i: number = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right--;
      for (let j = 0; j < this.size; j++) {
        for (let k = 0; k < 2; k++) {
          const x: number = right - k;
          const upward: boolean = ((right + 1) & 2) === 0;
          const y: number = upward ? this.size - 1 - j : j;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = QrCode.getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  private applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = x * y % 2 + x * y % 3 === 0; break;
          case 6: invert = (x * y % 2 + x * y % 3) % 2 === 0; break;
          case 7: invert = ((x + y) % 2 + x * y % 3) % 2 === 0; break;
          default: throw new Error("Unreachable");
        }
        if (!this.isFunction[y][x] && invert)
          this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  private getPenaltyScore(): number {
    let result: number = 0;
    for (let y = 0; y < this.size; y++) {
      let runColor: boolean = false;
      let runX: number = 0;
      for (let x = 0; x < this.size; x++) {
        if (this.modules[y][x] === runColor) {
          runX++;
          if (runX === 5) result += 3;
          else if (runX > 5) result++;
        } else {
          runColor = this.modules[y][x];
          runX = 1;
        }
      }
    }
    for (let x = 0; x < this.size; x++) {
      let runColor: boolean = false;
      let runY: number = 0;
      for (let y = 0; y < this.size; y++) {
        if (this.modules[y][x] === runColor) {
          runY++;
          if (runY === 5) result += 3;
          else if (runY > 5) result++;
        } else {
          runColor = this.modules[y][x];
          runY = 1;
        }
      }
    }
    for (let y = 0; y < this.size - 1; y++) {
      for (let x = 0; x < this.size - 1; x++) {
        const color: boolean = this.modules[y][x];
        if (color === this.modules[y][x + 1] && color === this.modules[y + 1][x] && color === this.modules[y + 1][x + 1])
          result += 3;
      }
    }
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size - 10; x++) {
        if (QrCode.isFinderLike(this.modules[y][x], this.modules[y][x + 1], this.modules[y][x + 2], this.modules[y][x + 3], this.modules[y][x + 4], this.modules[y][x + 5], this.modules[y][x + 6], this.modules[y][x + 7], this.modules[y][x + 8], this.modules[y][x + 9], this.modules[y][x + 10]))
          result += 40;
      }
    }
    for (let x = 0; x < this.size; x++) {
      for (let y = 0; y < this.size - 10; y++) {
        if (QrCode.isFinderLike(this.modules[y][x], this.modules[y + 1][x], this.modules[y + 2][x], this.modules[y + 3][x], this.modules[y + 4][x], this.modules[y + 5][x], this.modules[y + 6][x], this.modules[y + 7][x], this.modules[y + 8][x], this.modules[y + 9][x], this.modules[y + 10][x]))
          result += 40;
      }
    }
    let dark: number = 0;
    for (const row of this.modules)
      row.forEach(color => { if (color) dark++; });
    const total: number = this.size * this.size;
    const k: number = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * 10;
    return result;
  }

  private getAlignmentPatternPositions(): Array<number> {
    if (this.version === 1) return [];
    const numAlign: number = Math.floor(this.version / 7) + 2;
    const step: number = (this.version === 32) ? 26 : Math.ceil((this.size - 13) / (numAlign * 2 - 2)) * 2;
    const result: Array<number> = [6];
    for (let pos = this.size - 7; result.length < numAlign; pos -= step)
      result.splice(1, 0, pos);
    return result;
  }

  public static getNumRawDataModules(ver: number): number {
    let result: number = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign: number = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  public static getNumDataCodewords(ver: number, ecl: Ecc): number {
    return Math.floor(QrCode.getNumRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
  }

  private static reedSolomonComputeDivisor(degree: number): Array<number> {
    const result: Array<number> = [];
    for (let i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    let root: number = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = QrCode.reedSolomonMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = QrCode.reedSolomonMultiply(root, 2);
    }
    return result;
  }

  private static reedSolomonComputeRemainder(data: Array<number>, divisor: Array<number>): Array<number> {
    const result: Array<number> = divisor.map(_ => 0);
    for (const b of data) {
      const factor: number = b ^ result.shift()!;
      result.push(0);
      divisor.forEach((coef, i) => result[i] ^= QrCode.reedSolomonMultiply(coef, factor));
    }
    return result;
  }

  private static reedSolomonMultiply(x: number, y: number): number {
    let z: number = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  private static isFinderLike(b0: boolean, b1: boolean, b2: boolean, b3: boolean, b4: boolean, b5: boolean, b6: boolean, b7: boolean, b8: boolean, b9: boolean, b10: boolean): boolean {
    const forbidden: boolean = b3 || b7 || b8 || b9 || b10;
    return b0 && !b1 && b2 && b2 && b4 && !b5 && b6 && !forbidden;
  }

  private static getBit(x: number, i: number): boolean {
    return ((x >>> i) & 1) !== 0;
  }

  public static appendBits(val: number, len: number, bb: Array<bit>): void {
    for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
  }
}

export class Ecc {
  public static readonly LOW = new Ecc(0, 1);
  public static readonly MEDIUM = new Ecc(1, 0);
  public static readonly QUARTILE = new Ecc(2, 3);
  public static readonly HIGH = new Ecc(3, 2);
  public readonly ordinal: number;
  public readonly formatBits: number;
  constructor(ordinal: number, formatBits: number) {
    this.ordinal = ordinal;
    this.formatBits = formatBits;
  }
}

export class Mode {
  public static readonly NUMERIC = new Mode(0x1, [10, 12, 14]);
  public static readonly ALPHANUMERIC = new Mode(0x2, [9, 11, 13]);
  public static readonly BYTE = new Mode(0x4, [8, 16, 16]);
  public static readonly KANJI = new Mode(0x8, [8, 10, 12]);
  public static readonly ECI = new Mode(0x7, [0, 0, 0]);
  public readonly modeBits: number;
  private readonly numBitsCharCount: Array<number>;
  constructor(modeBits: number, numBitsCharCount: Array<number>) {
    this.modeBits = modeBits;
    this.numBitsCharCount = numBitsCharCount;
  }
  public numCharCountBits(ver: number): number {
    return this.numBitsCharCount[Math.floor((ver + 7) / 17)];
  }
}

export class QrSegment {
  public static makeBytes(data: Array<number>): QrSegment {
    let bb: Array<bit> = [];
    for (const b of data)
      for (let i = 7; i >= 0; i--) bb.push((b >>> i) & 1);
    return new QrSegment(Mode.BYTE, data.length, bb);
  }

  public static makeSegments(text: string): Array<QrSegment> {
    const result: Array<QrSegment> = [];
    const data: Array<number> = [];
    for (let i = 0; i < text.length; i++) {
      const c: number = text.charCodeAt(i);
      if (c < 128) data.push(c);
      else if (c < 2048) { data.push(0xC0 | (c >>> 6)); data.push(0x80 | (c & 0x3F)); }
      else if (c < 65536) { data.push(0xE0 | (c >>> 12)); data.push(0x80 | ((c >>> 6) & 0x3F)); data.push(0x80 | (c & 0x3F)); }
      else { data.push(0xF0 | (c >>> 18)); data.push(0x80 | ((c >>> 12) & 0x3F)); data.push(0x80 | ((c >>> 6) & 0x3F)); data.push(0x80 | (c & 0x3F)); }
    }
    result.push(QrSegment.makeBytes(data));
    return result;
  }

  public static getTotalBits(segs: Array<QrSegment>, version: number): number {
    let result: number = 0;
    for (const seg of segs) {
      const ccbits: number = seg.mode.numCharCountBits(version);
      if (seg.numChars >= (1 << ccbits)) return 1000000000;
      result += 4 + ccbits + seg.getData().length;
    }
    return result;
  }

  public readonly mode: Mode;
  public readonly numChars: number;
  private readonly data: Array<bit>;

  constructor(
    mode: Mode,
    numChars: number,
    data: Array<bit>) {
    this.mode = mode;
    this.numChars = numChars;
    this.data = data;
    if (numChars < 0) throw new RangeError("Invalid value");
  }

  public getData(): Array<bit> {
    return this.data.slice();
  }
}

const ECC_CODEWORDS_PER_BLOCK: Array<Array<number>> = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 28, 22, 24, 28, 30, 28, 28, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

const NUM_ERROR_CORRECTION_BLOCKS: Array<Array<number>> = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];
