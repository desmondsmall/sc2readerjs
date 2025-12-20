// @ts-check

/**
 * SC2 MPQ archive reader specialized for `.SC2Replay`.
 *
 * StarCraft II replay files use an MPQ "user data header" at the start of the file:
 * - offset 0: `MPQ\x1B` user data header
 * - later: `MPQ\x1A` MPQ archive header (often at 0x400)
 *
 * This module:
 * - locates the MPQ header via the user data header
 * - reads and decrypts the hash/block tables (Storm MPQ algorithm)
 * - reads individual files by name (e.g. `replay.details`, `replay.initData`, etc.)
 *
 * The `readReplayHeaderBytes()` helper returns the user-data "content" bytes that
 * s2protocol decodes as the replay header structure.
 */

const fs = require("fs/promises");
const { inflateMaybe } = require("./zlib");
const { hashString, decryptTable, decryptBytes } = require("./storm");

const MPQ_USER_DATA_MAGIC = Buffer.from("MPQ\x1B", "binary");
const MPQ_HEADER_MAGIC = Buffer.from("MPQ\x1A", "binary");

const FileFlag = Object.freeze({
  FileImplode: 0x00000100,
  FileCompress: 0x00000200,
  FileEncrypted: 0x00010000,
  FileFixKey: 0x00020000,
  FilePatchFile: 0x00100000,
  FileSingleUnit: 0x01000000,
  FileDeleteMarker: 0x02000000,
  FileSectorCrc: 0x04000000,
  FileExists: 0x80000000,
});

class SC2MPQArchive {
  constructor(filePath, fileHandle, archiveOffset, header, userDataHeaderContent) {
    this.filePath = filePath;
    this.fileHandle = fileHandle;
    this.archiveOffset = archiveOffset;
    this.header = header;
    this.userDataHeaderContent = userDataHeaderContent;
    this.hashTable = [];
    this.blockTable = [];
  }

  static async open(filePath) {
    const fh = await fs.open(filePath, "r");
    try {
      const { archiveOffset, userDataHeaderContent } =
        await SC2MPQArchive.#readUserDataHeader(fh);
      const header = await SC2MPQArchive.#readMPQHeader(fh, archiveOffset);

      const archive = new SC2MPQArchive(
        filePath,
        fh,
        archiveOffset,
        header,
        userDataHeaderContent
      );
      await archive.#readTables();
      return archive;
    } catch (error) {
      await fh.close();
      throw error;
    }
  }

  async close() {
    await this.fileHandle.close();
  }

  async readReplayHeaderBytes() {
    return this.userDataHeaderContent;
  }

  async readFile(fileName) {
    const entry = this.#findHashEntry(fileName);
    if (!entry) throw new Error(`MPQ file not found: ${fileName}`);
    const block = this.blockTable[entry.blockIndex];
    if (!block) throw new Error(`Invalid MPQ block index for: ${fileName}`);
    if ((block.flags & FileFlag.FilePatchFile) !== 0) {
      throw new Error("MPQ patch files are not supported");
    }

    const sectorSize = (0x200 << this.header.blockSize) >>> 0;
    const fileOffset = this.archiveOffset + block.filePosition;

    if ((block.flags & FileFlag.FileSingleUnit) !== 0) {
      const compressed = await SC2MPQArchive.#readAt(
        this.fileHandle,
        fileOffset,
        block.compressedSize
      );
      const decrypted = await this.#maybeDecryptFileData(
        compressed,
        fileName,
        block,
        0
      );
      if (
        (block.flags & (FileFlag.FileCompress | FileFlag.FileImplode)) !== 0 &&
        block.compressedSize !== block.uncompressedSize
      ) {
        return inflateMaybe(decrypted);
      }
      return decrypted;
    }

    const sectorCount =
      Math.floor((block.uncompressedSize + sectorSize - 1) / sectorSize) + 1;

    let sectorOffsets = null;
    if ((block.flags & (FileFlag.FileCompress | FileFlag.FileImplode)) !== 0) {
      const sectorTableBytes = sectorCount * 4;
      const raw = await SC2MPQArchive.#readAt(
        this.fileHandle,
        fileOffset,
        sectorTableBytes
      );
      const buf = Buffer.from(raw);
      if ((block.flags & FileFlag.FileEncrypted) !== 0) {
        const seed = this.#encryptionSeedForFile(fileName, block);
        decryptBytes(buf, (seed - 1) >>> 0);
      }
      sectorOffsets = new Uint32Array(
        buf.buffer,
        buf.byteOffset,
        sectorCount
      );
    }

    const out = Buffer.alloc(block.uncompressedSize);
    let outPos = 0;

    for (let sectorIndex = 0; sectorIndex < sectorCount - 1; sectorIndex++) {
      const expected = Math.min(
        sectorSize,
        block.uncompressedSize - sectorIndex * sectorSize
      );
      if (expected <= 0) break;

      let sectorData;
      if (sectorOffsets) {
        const start = sectorOffsets[sectorIndex] >>> 0;
        const end = sectorOffsets[sectorIndex + 1] >>> 0;
        const len = (end - start) >>> 0;
        sectorData = await SC2MPQArchive.#readAt(
          this.fileHandle,
          fileOffset + start,
          len
        );
        sectorData = await this.#maybeDecryptFileData(
          sectorData,
          fileName,
          block,
          sectorIndex
        );
        if (len !== expected) sectorData = await inflateMaybe(sectorData);
      } else {
        sectorData = await SC2MPQArchive.#readAt(
          this.fileHandle,
          fileOffset + sectorIndex * sectorSize,
          expected
        );
      }

      sectorData.copy(out, outPos, 0, expected);
      outPos += expected;
    }

    return out;
  }

  async #readTables() {
    const hashTableOffsetAbs = this.archiveOffset + this.header.hashTableOffset;
    const blockTableOffsetAbs = this.archiveOffset + this.header.blockTableOffset;

    const hashData = await decryptTable(
      this.fileHandle,
      this.header.hashTableEntries,
      "(hash table)",
      hashTableOffsetAbs
    );
    this.hashTable = [];
    for (let i = 0, n = 0; i < this.header.hashTableEntries; i++, n += 4) {
      const a = hashData[n] >>> 0;
      const b = hashData[n + 1] >>> 0;
      const combined = hashData[n + 2] >>> 0;
      const locale = (combined >>> 16) & 0xffff;
      const platform = combined & 0xffff;
      const blockIndex = hashData[n + 3] >>> 0;
      this.hashTable.push({ a, b, locale, platform, blockIndex });
    }

    const blockData = await decryptTable(
      this.fileHandle,
      this.header.blockTableEntries,
      "(block table)",
      blockTableOffsetAbs
    );
    this.blockTable = [];
    for (let i = 0, n = 0; i < this.header.blockTableEntries; i++, n += 4) {
      this.blockTable.push({
        filePosition: blockData[n] >>> 0,
        compressedSize: blockData[n + 1] >>> 0,
        uncompressedSize: blockData[n + 2] >>> 0,
        flags: blockData[n + 3] >>> 0,
      });
    }
  }

  #findHashEntry(fileName) {
    const name = fileName.replace(/\\/g, "/");
    const hashA = hashString(name, 1);
    const hashB = hashString(name, 2);
    const hashStart = hashString(name, 0) % this.hashTable.length;

    for (let i = 0; i < this.hashTable.length; i++) {
      const idx = (hashStart + i) % this.hashTable.length;
      const entry = this.hashTable[idx];
      if (!entry) return null;
      if (entry.blockIndex === 0xffffffff) return null;
      if (entry.blockIndex === 0xfffffffe) continue;
      if (entry.a === hashA && entry.b === hashB) {
        return { ...entry, blockIndex: entry.blockIndex };
      }
    }
    return null;
  }

  async #maybeDecryptFileData(buffer, fileName, block, sectorIndex) {
    if ((block.flags & FileFlag.FileEncrypted) === 0) return buffer;
    if (block.uncompressedSize <= 3) return buffer;
    const seed = this.#encryptionSeedForFile(fileName, block);
    const buf = Buffer.from(buffer);
    decryptBytes(buf, (seed + sectorIndex) >>> 0);
    return buf;
  }

  #encryptionSeedForFile(fileName, block) {
    const base = fileName.split(/[\\/]/).pop() || fileName;
    const seed = hashString(base, 3);
    return (((seed + block.filePosition) ^ block.uncompressedSize) >>> 0);
  }

  static async #readUserDataHeader(fileHandle) {
    const head = await SC2MPQArchive.#readAt(fileHandle, 0, 16);
    const magic = head.subarray(0, 4);
    if (!magic.equals(MPQ_USER_DATA_MAGIC)) {
      throw new Error(
        `Expected SC2 replay to start with MPQ user data header (MPQ\\x1B), got ${magic.toString(
          "hex"
        )}`
      );
    }

    const userDataSize = head.readUInt32LE(4);
    const archiveOffset = head.readUInt32LE(8);
    const userDataHeaderSize = head.readUInt32LE(12);

    const userDataHeaderContent = await SC2MPQArchive.#readAt(
      fileHandle,
      16,
      userDataHeaderSize
    );

    return { archiveOffset, userDataSize, userDataHeaderSize, userDataHeaderContent };
  }

  static async #readMPQHeader(fileHandle, archiveOffset) {
    const fixed = await SC2MPQArchive.#readAt(fileHandle, archiveOffset, 32);
    if (!fixed.subarray(0, 4).equals(MPQ_HEADER_MAGIC)) {
      throw new Error("MPQ header not found at expected offset");
    }

    const headerSize = fixed.readUInt32LE(4);
    const archiveSize = fixed.readUInt32LE(8);
    const formatVersion = fixed.readUInt16LE(12);
    const blockSize = fixed.readUInt16LE(14);
    const hashTableOffset = fixed.readUInt32LE(16);
    const blockTableOffset = fixed.readUInt32LE(20);
    const hashTableEntries = fixed.readUInt32LE(24);
    const blockTableEntries = fixed.readUInt32LE(28);

    return {
      headerSize,
      archiveSize,
      formatVersion,
      blockSize,
      hashTableOffset,
      blockTableOffset,
      hashTableEntries,
      blockTableEntries,
    };
  }

  static async #readAt(fileHandle, position, length) {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fileHandle.read(buf, 0, length, position);
    if (bytesRead !== length) {
      throw new Error(`Unexpected EOF reading at ${position} (${bytesRead}/${length})`);
    }
    return buf;
  }
}

module.exports = { SC2MPQArchive, FileFlag };
