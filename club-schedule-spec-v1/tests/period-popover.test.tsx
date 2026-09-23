// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { PeriodPopover } from "../src/PeriodPopover";

afterEach(cleanup);
const omiya = Array.from({ length: 6 }, (_, i) => ({
  campus_id: "omiya" as const,
  period_number: i + 1,
  start_time: "09:10",
  end_time: "10:50",
}));
const hirakata = Array.from({ length: 5 }, (_, i) => ({
  campus_id: "hirakata" as const,
  period_number: i + 1,
  start_time: "11:00",
  end_time: "12:40",
}));

describe("multiple period popover", () => {
  it("retains both periods when two selections arrive in one render batch", () => {
    function Fixture() {
      const [selected, setSelected] = useState<string[]>([]);
      return (
        <PeriodPopover
          periods={omiya}
          selected={selected}
          onChange={setSelected}
          common={false}
        />
      );
    }
    render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: /参加する時限未選択/ }));
    const options = screen.getAllByRole("menuitemcheckbox");
    act(() => {
      fireEvent.click(options[0]);
      fireEvent.click(options[2]);
    });
    expect(
      screen.getByRole("button", { name: /参加する時限1限、3限/ }),
    ).toBeTruthy();
  });
  it("keeps multiple selections, exposes campus-specific options, and supports keyboard and Escape", () => {
    function Fixture() {
      const [selected, setSelected] = useState<string[]>([]);
      const [scope, setScope] = useState<"omiya" | "hirakata" | "common">(
        "omiya",
      );
      return (
        <>
          <button onClick={() => setScope("hirakata")}>枚方へ</button>
          <button onClick={() => setScope("common")}>共通へ</button>
          <PeriodPopover
            periods={
              scope === "omiya"
                ? omiya
                : scope === "hirakata"
                  ? hirakata
                  : [...omiya, ...hirakata]
            }
            selected={selected}
            onChange={setSelected}
            common={scope === "common"}
          />
        </>
      );
    }
    render(<Fixture />);
    const trigger = screen.getByRole("button", { name: /参加する時限未選択/ });
    fireEvent.click(trigger);
    expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(6);
    fireEvent.keyDown(screen.getAllByRole("menuitemcheckbox")[0], {
      key: "ArrowDown",
    });
    expect(document.activeElement).toBe(
      screen.getAllByRole("menuitemcheckbox")[1],
    );
    fireEvent.keyDown(document.activeElement!, { key: " " });
    expect(
      screen.getAllByRole("menuitemcheckbox")[1].getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getAllByRole("menuitemcheckbox")[2]);
    expect(trigger.textContent).toContain("2限、3限");
    const parentEscape = vi.fn();
    document.addEventListener("keydown", parentEscape);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    document.removeEventListener("keydown", parentEscape);
    expect(parentEscape).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(screen.getByRole("button", { name: "枚方へ" }));
    fireEvent.click(trigger);
    expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(5);
    expect(screen.queryByRole("menuitemcheckbox", { name: /6限/ })).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "共通へ" }));
    fireEvent.click(trigger);
    expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(11);
    const hirakataFive = screen.getByRole("menuitemcheckbox", {
      name: /枚方 5限/,
    });
    fireEvent.click(hirakataFive);
    expect(trigger.textContent).toContain("大宮2限、大宮3限、枚方5限");
    expect(hirakataFive.getAttribute("aria-checked")).toBe("true");
  });
});
