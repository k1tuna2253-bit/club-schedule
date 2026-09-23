// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { AutoGrowTextarea } from "../src/AutoGrowTextarea";
import { readFileSync } from "node:fs";
const styles = readFileSync("src/style.css", "utf8");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("memo textarea", () => {
  it("grows on input and initial values, caps height with internal scroll, and disables manual resize", () => {
    vi.spyOn(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
      "get",
    ).mockImplementation(function (this: HTMLTextAreaElement) {
      return this.value.length > 40 ? 400 : this.value.includes("\n") ? 70 : 44;
    });
    function Fixture() {
      const [privateValue, setPrivate] = useState("existing\nnote");
      const [sharedValue, setShared] = useState("");
      return (
        <>
          <label>
            メモ（自分にだけ表示）
            <AutoGrowTextarea value={privateValue} onChange={setPrivate} />
          </label>
          <label>
            メモ（共有）
            <AutoGrowTextarea value={sharedValue} onChange={setShared} />
          </label>
        </>
      );
    }
    render(<Fixture />);
    const privateField = screen.getByRole("textbox", {
      name: "メモ（自分にだけ表示）",
    }) as HTMLTextAreaElement;
    const sharedField = screen.getByRole("textbox", {
      name: "メモ（共有）",
    }) as HTMLTextAreaElement;
    expect(privateField.style.height).toBe("70px");
    expect(sharedField.style.height).toBe("44px");
    expect(privateField.rows).toBe(1);
    expect(sharedField.rows).toBe(1);
    fireEvent.change(sharedField, { target: { value: "one line" } });
    expect(sharedField.style.height).toBe("44px");
    fireEvent.change(sharedField, { target: { value: "one\ntwo" } });
    expect(sharedField.style.height).toBe("70px");
    fireEvent.change(sharedField, {
      target: { value: "many lines of memo text\n".repeat(4) },
    });
    expect(sharedField.style.height).toBe("320px");
    expect(sharedField.style.overflowY).toBe("auto");
    expect(styles).toMatch(/\.modal-card textarea\s*\{[^}]*resize:\s*none/s);
    expect(styles).toMatch(/\.modal-card textarea\s*\{[^}]*max-width:\s*100%/s);
  });
});
