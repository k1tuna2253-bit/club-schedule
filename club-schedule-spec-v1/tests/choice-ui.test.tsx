// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ChoiceGroup } from "../src/ChoiceGroup";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("accessible choice group", () => {
  it("supports arrow keys, Home/End, selection state and focus", () => {
    function Fixture() {
      const [choice, setChoice] = useState("omiya");
      return (
        <ChoiceGroup
          label="参加するキャンパス"
          value={choice}
          onChange={setChoice}
          options={[
            { value: "omiya", label: "大宮" },
            { value: "hirakata", label: "枚方" },
            { value: "common", label: "共通" },
          ]}
        />
      );
    }
    render(<Fixture />);
    const first = screen.getByRole("radio", { name: "大宮" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const second = screen.getByRole("radio", { name: "枚方" });
    expect(second.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "End" });
    expect(
      screen.getByRole("radio", { name: "共通" }).getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.keyDown(screen.getByRole("radio", { name: "共通" }), {
      key: "Home",
    });
    expect(first.getAttribute("aria-checked")).toBe("true");
  });
});
