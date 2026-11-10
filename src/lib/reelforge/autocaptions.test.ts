import { describe, expect, it } from "vitest";
import { explainError } from "./autocaptions";

describe("explainError", () => {
  it("explains rate limits, outages, network and memory failures", () => {
    expect(
      explainError('Error (429) occurred while trying to load file: "https://huggingface.co/x"'),
    ).toMatch(/rate-limiting/);
    expect(
      explainError('Error (503) occurred while trying to load file: "https://huggingface.co/x"'),
    ).toMatch(/temporary problem/);
    expect(explainError("TypeError: Failed to fetch")).toMatch(/Couldn't download/);
    expect(explainError("RangeError: Array buffer allocation failed")).toMatch(/memory/);
  });
  it("passes other messages through unchanged", () => {
    expect(explainError("This video has no audio track, so there is nothing to transcribe.")).toBe(
      "This video has no audio track, so there is nothing to transcribe.",
    );
  });
});
