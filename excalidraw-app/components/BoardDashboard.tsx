import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import {
  LoadIcon,
  PlusIcon,
  TrashIcon,
} from "@excalidraw/excalidraw/components/icons";

import {
  createBoard,
  deleteBoard,
  getBoardHref,
  listBoards,
  updateBoard,
} from "../boardApi";

import type { BoardSummary } from "../boardApi";

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

export const BoardDashboard = () => {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  const refreshBoards = async () => {
    setError("");
    setBoards(await listBoards());
  };

  useEffect(() => {
    refreshBoards()
      .catch((error) => setError(error.message))
      .finally(() => setIsLoading(false));
  }, []);

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsCreating(true);
    setError("");
    try {
      const board = await createBoard(name || "Untitled drawing");
      window.location.assign(getBoardHref(board));
    } catch (error: any) {
      setError(error.message);
    } finally {
      setIsCreating(false);
    }
  };

  const onRename = async (board: BoardSummary) => {
    const nextName = editingName.trim();
    if (!nextName || nextName === board.name) {
      setEditingId(null);
      return;
    }
    setError("");
    try {
      await updateBoard(board.id, nextName);
      setEditingId(null);
      await refreshBoards();
    } catch (error: any) {
      setError(error.message);
    }
  };

  const onDelete = async (board: BoardSummary) => {
    if (!window.confirm(`Delete "${board.name}"?`)) {
      return;
    }
    setError("");
    try {
      await deleteBoard(board.id);
      await refreshBoards();
    } catch (error: any) {
      setError(error.message);
    }
  };

  return (
    <main className="board-dashboard">
      <section className="board-dashboard__inner">
        <div className="board-dashboard__header">
          <div>
            <h1>Drawings</h1>
            <p>Self-hosted boards with live collaboration and saved scenes.</p>
          </div>
          <form className="board-dashboard__new" onSubmit={onCreate}>
            <input
              aria-label="Drawing name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Drawing name"
              maxLength={80}
            />
            <button type="submit" disabled={isCreating}>
              {PlusIcon} New
            </button>
          </form>
        </div>

        {error && <div className="board-dashboard__error">{error}</div>}

        <div className="board-dashboard__list" aria-busy={isLoading}>
          {isLoading ? (
            <div className="board-dashboard__empty">Loading drawings...</div>
          ) : boards.length === 0 ? (
            <div className="board-dashboard__empty">No drawings yet.</div>
          ) : (
            boards.map((board) => (
              <article className="board-dashboard__row" key={board.id}>
                <div className="board-dashboard__row-main">
                  {editingId === board.id ? (
                    <form
                      className="board-dashboard__rename"
                      onSubmit={(event) => {
                        event.preventDefault();
                        onRename(board);
                      }}
                    >
                      <input
                        autoFocus
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        onBlur={() => onRename(board)}
                        maxLength={80}
                      />
                    </form>
                  ) : (
                    <button
                      className="board-dashboard__name"
                      type="button"
                      onClick={() =>
                        window.location.assign(getBoardHref(board))
                      }
                    >
                      {board.name}
                    </button>
                  )}
                  <div className="board-dashboard__meta">
                    {board.elementCount} elements | Updated{" "}
                    {formatDate(board.updatedAt)}
                  </div>
                </div>
                <div className="board-dashboard__actions">
                  <button
                    type="button"
                    title="Rename"
                    onClick={() => {
                      setEditingId(board.id);
                      setEditingName(board.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    title="Open drawing"
                    onClick={() => window.location.assign(getBoardHref(board))}
                  >
                    {LoadIcon} Open
                  </button>
                  <button
                    type="button"
                    title="Delete drawing"
                    className="board-dashboard__danger"
                    onClick={() => onDelete(board)}
                  >
                    {TrashIcon}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
};
