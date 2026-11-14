// A leeching BitTorrent client, small enough to read, with no dependencies.
//
// It asks an HTTP tracker for peers, speaks the peer wire protocol over TCP,
// and hands back only pieces whose SHA-1 equals the hash the torrent's infohash
// committed to. A peer that sends anything else is dropped and its piece is
// requeued, so a hostile peer costs time and never bytes.
//
// What it does not do, deliberately:
//
//   - It does not seed. The hub witnesses and redirects; it is not a host.
//   - It does not use BEP-19 web seeds. Measured 2026-11-14, Pirate Face's web
//     seed for `Qwen/Qwen3.8-27B` answers `302` to a volunteer which answers
//     `302` to huggingface.co. A web seed is therefore not an independent copy
//     of the bytes, and using one would make a failover path that quietly ends
//     at the host it was failing away from.
//   - It does not speak UDP trackers or the DHT, so a torrent whose only
//     tracker is `udp://` finds no peers here and the runner says so.
import net from "node:net";
import { createHash } from "node:crypto";
import { decode } from "./bencode.mjs";
import { pieceSize } from "./torrent.mjs";

const PROTOCOL = Buffer.from("BitTorrent protocol");
const BLOCK = 16384;
const CHOKE = 0;
const UNCHOKE = 1;
const INTERESTED = 2;
const HAVE = 4;
const BITFIELD = 5;
const REQUEST = 6;
const PIECE = 7;

export function peerId() {
  // BEP-20, with a client identity of our own so a tracker operator can tell
  // what is connecting to them.
  return Buffer.concat([Buffer.from("-HH0001-"), createHash("sha1").update(String(Math.random())).digest().subarray(0, 12)]);
}

const urlencodeBytes = (bytes) => [...bytes].map((b) =>
  (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x2d || b === 0x2e || b === 0x5f || b === 0x7e
    ? String.fromCharCode(b)
    : `%${b.toString(16).padStart(2, "0")}`).join("");

// Asks one HTTP tracker who is in the swarm. A compact answer is six bytes a
// peer, four of address and two of port.
export async function announce({ tracker, infohashBytes, id, left, timeoutMs = 15000 }) {
  if (!/^https?:\/\//.test(tracker)) throw new Error(`${tracker} is not an HTTP tracker`);
  const query = `info_hash=${urlencodeBytes(infohashBytes)}&peer_id=${urlencodeBytes(id)}`
    + `&port=6881&uploaded=0&downloaded=0&left=${left}&compact=1&numwant=80&event=started`;
  const url = `${tracker}${tracker.includes("?") ? "&" : "?"}${query}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`tracker ${tracker} answered ${response.status}`);
  const body = decode(Buffer.from(await response.arrayBuffer()));
  if (body["failure reason"]) throw new Error(`tracker ${tracker}: ${body["failure reason"].toString("utf8")}`);
  const peers = body.peers;
  const out = [];
  if (Buffer.isBuffer(peers)) {
    for (let at = 0; at + 6 <= peers.length; at += 6) {
      out.push({ host: `${peers[at]}.${peers[at + 1]}.${peers[at + 2]}.${peers[at + 3]}`, port: peers.readUInt16BE(at + 4) });
    }
  } else if (Array.isArray(peers)) {
    for (const peer of peers) out.push({ host: peer.ip.toString("utf8"), port: peer.port });
  }
  return out;
}

// One peer connection, for as long as it keeps being useful.
class Peer {
  constructor(address, torrent, id) {
    this.address = address;
    this.torrent = torrent;
    this.id = id;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.has = new Set();
    this.choked = true;
    this.waiters = [];
    this.closed = false;
  }

  connect(timeoutMs) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: this.address.host, port: this.address.port });
      this.socket = socket;
      // `setTimeout` on a socket is an inactivity timeout and does not cover a
      // connection that never establishes; an unreachable peer would otherwise
      // sit here until the operating system gave up, minutes later, holding
      // the whole download open.
      socket.setTimeout(timeoutMs);
      const deadline = setTimeout(() => fail(new Error("took too long to answer")), timeoutMs);
      const settle = (run) => (value) => { clearTimeout(deadline); run(value); };
      resolve = settle(resolve);
      const fail = settle((error) => { this.destroy(); reject(error); });
      socket.once("error", fail);
      socket.once("timeout", () => fail(new Error("timed out")));
      // A peer that closes before it has shaken hands has not connected.
      socket.once("close", () => fail(new Error("closed before the handshake")));
      socket.once("connect", () => {
        socket.write(Buffer.concat([
          Buffer.from([PROTOCOL.length]), PROTOCOL, Buffer.alloc(8), this.torrent.infohashBytes, this.id,
        ]));
      });
      socket.on("data", (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        try {
          this.consume(resolve, fail);
        } catch (error) {
          fail(error);
        }
      });
      socket.once("close", () => {
        this.closed = true;
        for (const waiter of this.waiters.splice(0)) waiter.reject(new Error("the peer closed the connection"));
      });
    });
  }

  // The handshake first, then length-prefixed messages.
  consume(onReady, onFail) {
    if (!this.shook) {
      if (this.buffer.length < 68) return;
      const length = this.buffer[0];
      if (length !== PROTOCOL.length || !this.buffer.subarray(1, 20).equals(PROTOCOL)) {
        onFail(new Error("the peer did not speak the BitTorrent protocol"));
        return;
      }
      if (!this.buffer.subarray(28, 48).equals(this.torrent.infohashBytes)) {
        onFail(new Error("the peer is in a different swarm"));
        return;
      }
      this.buffer = this.buffer.subarray(68);
      this.shook = true;
      // The connect timeout must not go on to kill a peer that is simply
      // between blocks; each request carries its own deadline.
      this.socket.setTimeout(0);
      this.send(INTERESTED);
      onReady(this);
    }
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + length) return;
      const message = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      if (length > 0) this.message(message[0], message.subarray(1));
    }
  }

  message(id, payload) {
    if (id === CHOKE) this.choked = true;
    else if (id === UNCHOKE) this.choked = false;
    else if (id === HAVE) this.has.add(payload.readUInt32BE(0));
    else if (id === BITFIELD) {
      for (let index = 0; index < this.torrent.pieceCount; index += 1) {
        if ((payload[index >> 3] >> (7 - (index & 7))) & 1) this.has.add(index);
      }
    } else if (id === PIECE) {
      const index = payload.readUInt32BE(0);
      const begin = payload.readUInt32BE(4);
      const block = payload.subarray(8);
      const waiter = this.waiters.find((w) => w.index === index && w.begin === begin);
      if (waiter) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(block);
      }
    }
  }

  send(id, payload = Buffer.alloc(0)) {
    if (this.closed || !this.socket) return;
    const message = Buffer.alloc(5 + payload.length);
    message.writeUInt32BE(1 + payload.length, 0);
    message[4] = id;
    payload.copy(message, 5);
    this.socket.write(message);
  }

  block(index, begin, length, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const at = this.waiters.findIndex((w) => w.index === index && w.begin === begin);
        if (at >= 0) this.waiters.splice(at, 1);
        reject(new Error(`block ${index}:${begin} timed out`));
      }, timeoutMs);
      this.waiters.push({
        index, begin,
        resolve: (block) => { clearTimeout(timer); resolve(block); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      const payload = Buffer.alloc(12);
      payload.writeUInt32BE(index, 0);
      payload.writeUInt32BE(begin, 4);
      payload.writeUInt32BE(length, 8);
      this.send(REQUEST, payload);
    });
  }

  // One whole piece, checked against the hash the infohash committed to. A
  // piece that does not match is never returned, so no caller can be handed
  // unverified bytes by mistake.
  async piece(index, { blockTimeoutMs = 30000, pipeline = 5 } = {}) {
    const size = pieceSize(this.torrent, index);
    const parts = [];
    for (let begin = 0; begin < size; begin += BLOCK) parts.push([begin, Math.min(BLOCK, size - begin)]);
    const bytes = Buffer.alloc(size);
    for (let at = 0; at < parts.length; at += pipeline) {
      const batch = parts.slice(at, at + pipeline);
      const blocks = await Promise.all(batch.map(([begin, length]) => this.block(index, begin, length, blockTimeoutMs)));
      blocks.forEach((block, i) => block.copy(bytes, batch[i][0]));
    }
    const digest = createHash("sha1").update(bytes).digest();
    if (!digest.equals(this.torrent.pieceHash(index))) {
      throw new Error(`piece ${index} hashes to ${digest.toString("hex")}, which the infohash does not commit to`);
    }
    return bytes;
  }

  async ready(timeoutMs) {
    const until = Date.now() + timeoutMs;
    while (this.choked && !this.closed && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (this.choked || this.closed) throw new Error("the peer never unchoked us");
  }

  destroy() {
    this.closed = true;
    this.socket?.destroy();
  }
}

// Downloads exactly the pieces asked for, from whoever will serve them, and
// calls `onPiece` with bytes that have already been checked against the
// torrent's commitment. Returns when every piece has been delivered or the
// deadline passes.
export async function fetchPieces(torrent, indices, peers, {
  id = peerId(), onPiece, connectTimeoutMs = 10000, blockTimeoutMs = 30000,
  parallelPeers = 8, deadlineMs = 30 * 60000, onNote = () => {},
} = {}) {
  const queue = [...indices];
  const outstanding = new Set();
  const done = new Set();
  const deadline = Date.now() + deadlineMs;
  const candidates = [...peers];
  let live = 0;

  async function work(address) {
    const peer = new Peer(address, torrent, id);
    try {
      await peer.connect(connectTimeoutMs);
      await peer.ready(connectTimeoutMs);
      while (Date.now() < deadline) {
        const at = queue.findIndex((index) => peer.has.has(index));
        if (at < 0) break;
        const [index] = queue.splice(at, 1);
        outstanding.add(index);
        try {
          const bytes = await peer.piece(index, { blockTimeoutMs });
          outstanding.delete(index);
          done.add(index);
          await onPiece(index, bytes);
        } catch (error) {
          outstanding.delete(index);
          queue.unshift(index);
          onNote(`peer ${address.host}:${address.port} failed piece ${index}: ${error.message}`);
          throw error;
        }
      }
    } finally {
      peer.destroy();
      live -= 1;
    }
  }

  const running = new Set();
  while ((queue.length || outstanding.size) && Date.now() < deadline) {
    while (live < parallelPeers && candidates.length && queue.length) {
      const address = candidates.shift();
      live += 1;
      const task = work(address).catch(() => {}).finally(() => running.delete(task));
      running.add(task);
    }
    if (!running.size) break;
    await Promise.race([...running, new Promise((r) => setTimeout(r, 500))]);
  }
  await Promise.allSettled([...running]);
  if (done.size !== indices.length) {
    throw new Error(`the swarm delivered ${done.size} of ${indices.length} pieces before the deadline`);
  }
}
