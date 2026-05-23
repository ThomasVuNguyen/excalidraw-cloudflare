import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/data";
const DATA_FILE = path.join(DATA_DIR, "boards.json");
const PORT = Number(process.env.PORT || 8787);
const MAX_BODY_BYTES = 25 * 1024 * 1024;

const emptyStore = () => ({ boards: [] });

const now = () => new Date().toISOString();

const makeRoomKey = () => randomBytes(16).toString("base64url").slice(0, 22);
const makeRoomId = () => randomBytes(10).toString("hex");

const send = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
};

const notFound = (res) => send(res, 404, { error: "not_found" });

const readStore = async () => {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    return JSON.parse(await readFile(DATA_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return emptyStore();
    }
    throw error;
  }
};

const writeStore = async (store) => {
  await mkdir(DATA_DIR, { recursive: true });
  const tempFile = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFile, JSON.stringify(store, null, 2));
  await rename(tempFile, DATA_FILE);
};

const readBody = async (req) =>
  new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("request_body_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });

const sanitizeName = (value) => {
  const name = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return name || "Untitled drawing";
};

const publicBoard = (board) => ({
  id: board.id,
  name: board.name,
  roomId: board.roomId,
  roomKey: board.roomKey,
  createdAt: board.createdAt,
  updatedAt: board.updatedAt,
  elementCount: Array.isArray(board.scene?.elements)
    ? board.scene.elements.length
    : 0,
});

const getBoard = (store, id) => store.boards.find((board) => board.id === id);

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET" && url.pathname === "/health") {
      send(res, 200, { ok: true });
      return;
    }

    if (parts[0] !== "api" || parts[1] !== "boards") {
      notFound(res);
      return;
    }

    const store = await readStore();

    if (req.method === "GET" && parts.length === 2) {
      send(
        res,
        200,
        store.boards
          .slice()
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map(publicBoard),
      );
      return;
    }

    if (req.method === "POST" && parts.length === 2) {
      const body = await readBody(req);
      const timestamp = now();
      const board = {
        id: randomUUID(),
        name: sanitizeName(body.name),
        roomId: makeRoomId(),
        roomKey: makeRoomKey(),
        createdAt: timestamp,
        updatedAt: timestamp,
        scene: {
          type: "excalidraw",
          version: 2,
          source: "https://draw.comfyspace.tech",
          elements: [],
          appState: {},
          files: {},
        },
      };
      store.boards.push(board);
      await writeStore(store);
      send(res, 201, board);
      return;
    }

    if (parts.length < 3) {
      notFound(res);
      return;
    }

    const board = getBoard(store, parts[2]);
    if (!board) {
      notFound(res);
      return;
    }

    if (req.method === "GET" && parts.length === 3) {
      send(res, 200, board);
      return;
    }

    if (req.method === "PATCH" && parts.length === 3) {
      const body = await readBody(req);
      board.name = sanitizeName(body.name ?? board.name);
      board.updatedAt = now();
      await writeStore(store);
      send(res, 200, board);
      return;
    }

    if (req.method === "DELETE" && parts.length === 3) {
      store.boards = store.boards.filter((item) => item.id !== board.id);
      await writeStore(store);
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "PUT" && parts.length === 4 && parts[3] === "scene") {
      const body = await readBody(req);
      board.scene = {
        type: "excalidraw",
        version: 2,
        source: "https://draw.comfyspace.tech",
        elements: Array.isArray(body.elements) ? body.elements : [],
        appState:
          body.appState && typeof body.appState === "object"
            ? body.appState
            : {},
        files: body.files && typeof body.files === "object" ? body.files : {},
      };
      board.updatedAt = now();
      await writeStore(store);
      send(res, 200, board);
      return;
    }

    notFound(res);
  } catch (error) {
    const status =
      error.message === "invalid_json" ||
      error.message === "request_body_too_large"
        ? 400
        : 500;
    send(res, status, { error: error.message || "internal_error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`board-api listening on ${PORT}`);
});
