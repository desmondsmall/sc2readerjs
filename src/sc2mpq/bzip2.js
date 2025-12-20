// @ts-check

/**
 * bzip2 decompression helper.
 *
 * Node does not ship a bzip2 decoder. To keep `sc2readerjs` runnable without `npm install`,
 * we shell out to `python3`'s stdlib `bz2` module when bzip2-compressed MPQ sectors appear.
 *
 * If you later decide to depend on a pure-JS bzip2 module, this file is the only integration point.
 */

const { spawn } = require("child_process");

/**
 * @param {Buffer} data
 * @returns {Promise<Buffer>}
 */
function bunzip2(data) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "python3",
      ["-c", "import sys,bz2; sys.stdout.buffer.write(bz2.decompress(sys.stdin.buffer.read()))"],
      { stdio: ["pipe", "pipe", "pipe"] }
    );

    const out = [];
    const err = [];

    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => err.push(c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `python3 bz2 decompress failed (code ${code}): ${Buffer.concat(err).toString("utf8")}`
          )
        );
        return;
      }
      resolve(Buffer.concat(out));
    });

    child.stdin.end(Buffer.isBuffer(data) ? data : Buffer.from(data));
  });
}

module.exports = { bunzip2 };
