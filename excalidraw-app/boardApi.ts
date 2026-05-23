import type {
  ExcalidrawInitialDataState,
  BinaryFiles,
  AppState,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/element/types";

export type BoardSummary = {
  id: string;
  name: string;
  roomId: string;
  roomKey: string;
  createdAt: string;
  updatedAt: string;
  elementCount: number;
};

export type Board = BoardSummary & {
  scene: ExcalidrawInitialDataState;
};

export type BoardScenePayload = {
  elements: readonly OrderedExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Board API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
};

export const getBoardIdFromPath = () => {
  const match = window.location.pathname.match(/^\/b\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
};

export const getBoardHref = (
  board: Pick<BoardSummary, "id" | "roomId" | "roomKey">,
) => `/b/${encodeURIComponent(board.id)}#room=${board.roomId},${board.roomKey}`;

export const listBoards = () => request<BoardSummary[]>("/api/boards");

export const createBoard = (name: string) =>
  request<Board>("/api/boards", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

export const getBoard = (id: string) =>
  request<Board>(`/api/boards/${encodeURIComponent(id)}`);

export const updateBoard = (id: string, name: string) =>
  request<Board>(`/api/boards/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });

export const deleteBoard = (id: string) =>
  request<{ ok: true }>(`/api/boards/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

export const updateBoardScene = (id: string, scene: BoardScenePayload) =>
  request<Board>(`/api/boards/${encodeURIComponent(id)}/scene`, {
    method: "PUT",
    body: JSON.stringify(scene),
  });
