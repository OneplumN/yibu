import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AppErrorBoundary } from "../components/common/AppErrorBoundary";

test("shows a recovery action after a rendering failure", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  function Broken(): never {
    throw new Error("render test");
  }
  try {
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("页面暂时无法显示");
    expect(
      screen.getByRole("button", { name: "重新加载" }),
    ).toBeInTheDocument();
  } finally {
    error.mockRestore();
  }
});
