import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Logo from "./logo";

describe("<Logo />", () => {
  it("renders the wordmark by default", () => {
    render(<Logo />);
    expect(screen.getByText(/panel/)).toBeInTheDocument();
    expect(screen.getByText(/arr/)).toBeInTheDocument();
  });

  it("hides the wordmark in size=sm", () => {
    render(<Logo size="sm" />);
    expect(screen.queryByText(/panel/)).not.toBeInTheDocument();
  });

  it("shows the tagline at size=lg", () => {
    render(<Logo size="lg" />);
    expect(screen.getByText(/homelab media control center/i)).toBeInTheDocument();
  });

  it("respects an explicit showTagline override", () => {
    render(<Logo size="md" showTagline />);
    expect(screen.getByText(/homelab media control center/i)).toBeInTheDocument();
  });
});
