import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("./SequencePreview", () => ({ SequencePreview: () => <div>Program monitor</div> }));
vi.mock("@/lib/sequence/media", () => ({
  probe: vi.fn(async (file: File) => ({
    id: file.name,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    kind: "video",
    duration: 2,
    origin: 0,
    width: 16,
    height: 9,
    hasAudio: true,
    peaks: [0.5],
  })),
  download: vi.fn(),
  exportSequence: vi.fn(),
}));
import SequenceStudio from "./SequenceStudio";
import { fresh } from "@/lib/sequence/model";
beforeEach(() => {
  localStorage.clear();
  URL.createObjectURL = vi.fn(() => "blob:media");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);
describe("sequence workspace", () => {
  it("saves enhancement presets, supports compare/reset and selects UHD export", async () => {
    render(<SequenceStudio />);
    expect(screen.getByLabelText("Export resolution")).toHaveValue("2160");
    fireEvent.click(screen.getByText("Balanced"));
    expect(screen.getByLabelText("Contrast (%)")).toHaveValue(108);
    expect(JSON.parse(localStorage.getItem("reelcraft-sequence-v1")!).enhancement.enabled).toBe(
      true,
    );
    fireEvent.click(screen.getByText("Enhancement on · Compare original"));
    expect(screen.getByLabelText("Contrast (%)")).toBeDisabled();
    fireEvent.click(screen.getByText("Enable enhancement"));
    expect(screen.getByLabelText("Contrast (%)")).toHaveValue(108);
    fireEvent.click(screen.getByText("Reset enhancement"));
    expect(screen.getByLabelText("Contrast (%)")).toHaveValue(100);
  });
  it("imports multiple files and supports append, undo, redo and track locks", async () => {
    const { container } = render(<SequenceStudio />);
    const input = container.querySelector("input[multiple]")!;
    fireEvent.change(input, {
      target: {
        files: [
          new File(["1"], "one.mp4", { type: "video/mp4" }),
          new File(["2"], "two.mp4", { type: "video/mp4" }),
        ],
      },
    });
    await waitFor(() => expect(screen.getAllByText("+ V1")).toHaveLength(2));
    fireEvent.click(screen.getAllByText("+ V1")[0]!);
    expect(container.querySelectorAll(".seq-clip")).toHaveLength(1);
    fireEvent.click(screen.getByText("↶ Undo"));
    expect(container.querySelectorAll(".seq-clip")).toHaveLength(0);
    fireEvent.click(screen.getByText("↷ Redo"));
    expect(container.querySelectorAll(".seq-clip")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("Lock V1"));
    expect(screen.getByLabelText("Unlock V1")).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".seq-clip")).toHaveAttribute("draggable", "false");
  });
  it("restores metadata with missing-source relink guidance", async () => {
    const s = fresh();
    s.assets = [
      {
        id: "missing",
        name: "original.mp4",
        kind: "video",
        size: 123,
        lastModified: 1,
        duration: 3,
        origin: 0,
        width: 16,
        height: 9,
        hasAudio: false,
        peaks: [],
      },
    ];
    localStorage.setItem("reelcraft-sequence-v1", JSON.stringify(s));
    render(<SequenceStudio />);
    expect(await screen.findByText("Relink source")).toBeInTheDocument();
    expect(screen.getByText(/1 source file need relinking/)).toBeInTheDocument();
  });
});
