import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { scopesWanted } from "@/lib/reelforge/grading/scopes";
import { ScopesPanel } from "./ScopesPanel";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("asks for scope frames only while open, and remembers mode and open state", () => {
  render(<ScopesPanel />);
  expect(scopesWanted()).toBe(true);
  fireEvent.click(screen.getByRole("tab", { name: "Vectorscope" }));
  expect(screen.getByRole("img", { name: /Vectorscope of the graded frame/ })).toBeTruthy();
  expect(screen.getByText(/Skin tones sit near the dashed line/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Scopes/ }));
  expect(scopesWanted()).toBe(false); // collapsed: the preview stops sampling
  expect(JSON.parse(localStorage.getItem("reelforge.scopes")!)).toEqual({
    open: false,
    mode: "vector",
  });
  cleanup();
  render(<ScopesPanel />);
  expect(screen.getByRole("button", { name: /Scopes/ }).getAttribute("aria-expanded")).toBe(
    "false",
  );
});
